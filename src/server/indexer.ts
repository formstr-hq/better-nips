import { count, eq, inArray, sql } from "drizzle-orm";
import pLimit from "p-limit";
import type { Database } from "./db";
import {
  indexRuns,
  indexedNips,
  lazyIndexRequests,
  nipDeletionRequests,
  nipDeletionTargets,
  nipVersions,
  relaySyncs,
} from "./db/schema";
import { NostrQueryClient } from "./nostr-query";
import type { RelayDefinition } from "./relays";
import {
  applyNip09,
  DEFAULT_INDEX_CAP,
  latestNip01,
  nipCoordinateSchema,
  parseNipCoordinate,
  type EffectiveDeletion,
  type NipCoordinate,
} from "./types";
import { parseVerifiedDeletion, parseVerifiedNip } from "./validation";

const CAP_LOCK_ID = 3_081_700_009;
const INSERT_BATCH_SIZE = 500;

function batches<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += INSERT_BATCH_SIZE) {
    result.push(values.slice(offset, offset + INSERT_BATCH_SIZE));
  }
  return result;
}

export interface IndexResult {
  runId: number;
  status: "succeeded" | "partial";
  discoveredCount: number;
  admittedCount: number;
  versionCount: number;
  deletionCount: number;
  invalidCount: number;
  capRejectedCount: number;
}

type IngestResult = Omit<IndexResult, "runId" | "status" | "discoveredCount">;

export interface NipIndexerOptions {
  cap?: number;
  coordinateConcurrency?: number;
  lazyCooldownMinutes?: number;
  queryClient?: NostrQueryClient;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyTotals(): Omit<IndexResult, "runId" | "status"> {
  return {
    discoveredCount: 0,
    admittedCount: 0,
    versionCount: 0,
    deletionCount: 0,
    invalidCount: 0,
    capRejectedCount: 0,
  };
}

export class NipIndexer {
  private readonly cap: number;
  private readonly coordinateConcurrency: number;
  private readonly lazyCooldownMinutes: number;
  private readonly queryClient: NostrQueryClient;

  constructor(
    private readonly db: Database,
    private readonly relays: readonly RelayDefinition[],
    options: NipIndexerOptions = {},
  ) {
    this.cap = options.cap ?? DEFAULT_INDEX_CAP;
    if (!Number.isSafeInteger(this.cap) || this.cap < 1) {
      throw new Error("The NIP index cap must be a positive integer");
    }
    this.coordinateConcurrency = options.coordinateConcurrency ?? 4;
    this.lazyCooldownMinutes = options.lazyCooldownMinutes ?? 1_440;
    if (!Number.isSafeInteger(this.lazyCooldownMinutes) || this.lazyCooldownMinutes < 1) {
      throw new Error("The lazy index cooldown must be a positive integer");
    }
    this.queryClient = options.queryClient ?? new NostrQueryClient();
  }

  private async startRun(trigger: "on_demand" | "nightly", coordinate?: string) {
    const [run] = await this.db
      .insert(indexRuns)
      .values({ trigger, coordinate })
      .returning({ id: indexRuns.id });
    if (!run) throw new Error("Failed to create index run");
    return run.id;
  }

  private async queryRelay(
    runId: number,
    relay: RelayDefinition,
    queryType: "exact" | "discovery",
    query: () => Promise<unknown[]>,
    coordinate?: string,
  ): Promise<{ events: unknown[]; failed: boolean }> {
    const [sync] = await this.db
      .insert(relaySyncs)
      .values({
        runId,
        relayKey: relay.key,
        relayUrl: relay.url,
        queryType,
        coordinate,
      })
      .returning({ id: relaySyncs.id });
    if (!sync) throw new Error("Failed to create relay sync record");

    try {
      const events = await query();
      await this.db
        .update(relaySyncs)
        .set({ status: "succeeded", eventCount: events.length, finishedAt: new Date() })
        .where(eq(relaySyncs.id, sync.id));
      return { events, failed: false };
    } catch (error) {
      await this.db
        .update(relaySyncs)
        .set({ status: "failed", error: errorMessage(error), finishedAt: new Date() })
        .where(eq(relaySyncs.id, sync.id));
      return { events: [], failed: true };
    }
  }

  private async ingest(inputs: readonly unknown[]): Promise<IngestResult> {
    const byId = new Map<string, unknown>();
    for (const input of inputs) {
      if (input && typeof input === "object" && "id" in input) {
        byId.set(String(input.id), input);
      }
    }

    const nips = [...byId.values()].map(parseVerifiedNip).filter((value) => value !== null);
    const deletions = [...byId.values()]
      .map(parseVerifiedDeletion)
      .filter((value) => value !== null);
    const validIds = new Set([
      ...nips.map((nip) => nip.event.id),
      ...deletions.map((deletion) => deletion.event.id),
    ]);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${CAP_LOCK_ID})`);

      const candidateCoordinates = [...new Set(nips.map((nip) => nip.coordinate))].sort();
      const existing: Array<{
        coordinate: string;
        currentEventId: string | null;
        deleted: boolean;
      }> = [];
      for (const batch of batches(candidateCoordinates)) {
        existing.push(
          ...(await tx
            .select({
              coordinate: indexedNips.coordinate,
              currentEventId: indexedNips.currentEventId,
              deleted: indexedNips.deleted,
            })
            .from(indexedNips)
            .where(inArray(indexedNips.coordinate, batch))),
        );
      }
      const existingSet = new Set(existing.map((row) => row.coordinate));
      const [{ value: indexedCount }] = await tx.select({ value: count() }).from(indexedNips);
      const available = Math.max(0, this.cap - indexedCount);
      const toAdmit = candidateCoordinates
        .filter((coordinate) => !existingSet.has(coordinate))
        .slice(0, available);
      const admittedSet = new Set([...existingSet, ...toAdmit]);
      const admittedNips = nips.filter(
        (nip) => admittedSet.has(nip.coordinate),
      );

      const admissionRows = toAdmit.map((coordinate) => {
        const parsed = parseNipCoordinate(coordinate);
        if (!parsed) throw new Error(`Invalid admitted coordinate: ${coordinate}`);
        return parsed;
      });
      const insertedAdmissions: Array<{ coordinate: string }> = [];
      for (const batch of batches(admissionRows)) {
        insertedAdmissions.push(
          ...(await tx
            .insert(indexedNips)
            .values(batch)
            .onConflictDoNothing()
            .returning({ coordinate: indexedNips.coordinate })),
        );
      }

      const versionRows = admittedNips.map((nip) => ({
        eventId: nip.event.id,
        coordinate: nip.coordinate,
        pubkey: nip.pubkey,
        createdAt: nip.event.created_at,
        title: nip.title,
        summary: nip.summary,
        content: nip.event.content,
        tags: nip.event.tags,
        definedKinds: nip.definedKinds,
        signature: nip.event.sig,
        rawEvent: nip.event,
      }));
      const insertedVersions: Array<{ eventId: string }> = [];
      for (const batch of batches(versionRows)) {
        insertedVersions.push(
          ...(await tx
             .insert(nipVersions)
            .values(batch)
            .onConflictDoNothing()
            .returning({ eventId: nipVersions.eventId })),
        );
      }

      const eventReferences = deletions.flatMap((deletion) =>
        deletion.references
          .filter((reference) => reference.type === "event")
          .map((reference) => reference.value),
      );
      const referencedVersions: Array<{
        eventId: string;
        coordinate: string;
        pubkey: string;
      }> = [];
      for (const batch of batches([...new Set(eventReferences)])) {
        referencedVersions.push(
          ...(await tx
            .select({
              eventId: nipVersions.eventId,
              coordinate: nipVersions.coordinate,
              pubkey: nipVersions.pubkey,
            })
            .from(nipVersions)
            .where(inArray(nipVersions.eventId, batch))),
        );
      }
      const versionById = new Map(referencedVersions.map((version) => [version.eventId, version]));
      const coordinateReferences = [
        ...new Set(
          deletions.flatMap((deletion) =>
            deletion.references
              .filter((reference) => reference.type === "coordinate")
              .map((reference) => reference.value),
          ),
        ),
      ];
      const referencedCoordinates: Array<{ coordinate: string }> = [];
      for (const batch of batches(coordinateReferences)) {
        referencedCoordinates.push(
          ...(await tx
            .select({ coordinate: indexedNips.coordinate })
            .from(indexedNips)
            .where(inArray(indexedNips.coordinate, batch))),
        );
      }
      const admittedCoordinates = new Set([
        ...existingSet,
        ...insertedAdmissions.map((row) => row.coordinate),
        ...referencedCoordinates.map((row) => row.coordinate),
      ]);

      const effective = deletions.flatMap((deletion) => {
        const targets = deletion.references.filter((reference) => {
          if (reference.type === "coordinate") {
            const coordinate = parseNipCoordinate(reference.value);
            return (
              coordinate?.pubkey === deletion.event.pubkey &&
              admittedCoordinates.has(reference.value)
            );
          }
          return versionById.get(reference.value)?.pubkey === deletion.event.pubkey;
        });
        return targets.length ? [{ deletion, targets }] : [];
      });

      const deletionRowsToInsert = effective.map(({ deletion }) => ({
        eventId: deletion.event.id,
        pubkey: deletion.event.pubkey,
        createdAt: deletion.event.created_at,
        content: deletion.event.content,
        tags: deletion.event.tags,
        signature: deletion.event.sig,
        rawEvent: deletion.event,
      }));
      const insertedDeletions: Array<{ eventId: string }> = [];
      for (const batch of batches(deletionRowsToInsert)) {
        insertedDeletions.push(
          ...(await tx
             .insert(nipDeletionRequests)
            .values(batch)
            .onConflictDoNothing()
            .returning({ eventId: nipDeletionRequests.eventId })),
        );
      }
      const targetRows = effective.flatMap(({ deletion, targets }) =>
        targets.map((target) => ({
          deletionEventId: deletion.event.id,
          targetType: target.type,
          targetValue: target.value,
        })),
      );
      for (const batch of batches(targetRows)) {
        await tx.insert(nipDeletionTargets).values(batch).onConflictDoNothing();
      }

      const affectedCoordinates = new Set(admittedNips.map((nip) => nip.coordinate));
      for (const { targets } of effective) {
        for (const target of targets) {
          if (target.type === "coordinate") affectedCoordinates.add(target.value);
          else {
            const coordinate = versionById.get(target.value)?.coordinate;
            if (coordinate) affectedCoordinates.add(coordinate);
          }
        }
      }

      if (affectedCoordinates.size) {
        const materialized: Array<{
          coordinate: string;
          currentEventId: string | null;
          deleted: boolean;
        }> = [];
        for (const batch of batches([...affectedCoordinates])) {
          materialized.push(
            ...(await tx
              .select({
                coordinate: indexedNips.coordinate,
                currentEventId: indexedNips.currentEventId,
                deleted: indexedNips.deleted,
              })
              .from(indexedNips)
              .where(inArray(indexedNips.coordinate, batch))),
          );
        }
        const materializedByCoordinate = new Map(
          materialized.map((row) => [row.coordinate, row]),
        );
        const versions: Array<typeof nipVersions.$inferSelect> = [];
        for (const batch of batches([...affectedCoordinates])) {
          versions.push(
            ...(await tx
              .select()
              .from(nipVersions)
              .where(inArray(nipVersions.coordinate, batch))),
          );
        }
        const versionIds = versions.map((version) => version.eventId);
        const targetValues = [...affectedCoordinates, ...versionIds];
        const deletionRows: Array<{
          id: string;
          pubkey: string;
          created_at: number;
          targetType: string;
          targetValue: string;
        }> = [];
        for (const batch of batches(targetValues)) {
          deletionRows.push(
            ...(await tx
              .select({
                id: nipDeletionRequests.eventId,
                pubkey: nipDeletionRequests.pubkey,
                created_at: nipDeletionRequests.createdAt,
                targetType: nipDeletionTargets.targetType,
                targetValue: nipDeletionTargets.targetValue,
              })
              .from(nipDeletionTargets)
              .innerJoin(
                nipDeletionRequests,
                eq(nipDeletionRequests.eventId, nipDeletionTargets.deletionEventId),
              )
              .where(inArray(nipDeletionTargets.targetValue, batch))),
          );
        }
        const deletionStates: EffectiveDeletion[] = deletionRows.map((row) => ({
          id: row.id,
          pubkey: row.pubkey,
          created_at: row.created_at,
          targetEventId: row.targetType === "event" ? row.targetValue : undefined,
          targetCoordinate: row.targetType === "coordinate" ? row.targetValue : undefined,
        }));

        for (const coordinate of affectedCoordinates) {
          const coordinateVersions = versions
            .filter((version) => version.coordinate === coordinate)
            .map((version) => ({
              ...version,
              id: version.eventId,
              created_at: version.createdAt,
            }));
          const states = applyNip09(coordinateVersions, deletionStates);
          for (const state of states) {
            await tx
              .update(nipVersions)
              .set({
                isDeleted: state.deletedBy !== null,
                deletedByEventId: state.deletedBy,
              })
              .where(eq(nipVersions.eventId, state.version.eventId));
          }
          const current = latestNip01(
            states.filter((state) => state.deletedBy === null).map((state) => state.version),
          );
          const previous = materializedByCoordinate.get(coordinate);
          const nextDeleted = current === null;
          const changed =
            previous?.currentEventId !== (current?.eventId ?? null) ||
            previous?.deleted !== nextDeleted;
          await tx
            .update(indexedNips)
            .set({
              currentEventId: current?.eventId ?? null,
              currentCreatedAt: current?.createdAt ?? null,
              deleted: nextDeleted,
              ...(changed ? { updatedAt: new Date() } : {}),
            })
            .where(eq(indexedNips.coordinate, coordinate));
        }
      }

      return {
        admittedCount: insertedAdmissions.length,
        versionCount: insertedVersions.length,
        deletionCount: insertedDeletions.length,
        invalidCount: byId.size - validIds.size,
        capRejectedCount: Math.max(0, candidateCoordinates.length - existingSet.size - toAdmit.length),
      };
    });
  }

  private async exactEvents(runId: number, coordinate: NipCoordinate) {
    const known = await this.db
      .select({ eventId: nipVersions.eventId })
      .from(nipVersions)
      .where(eq(nipVersions.coordinate, coordinate.coordinate));
    const exactRelays = this.relays.filter((relay) => relay.exact);
    const nipResults = await Promise.all(
      exactRelays.map((relay) =>
        this.queryRelay(
          runId,
          relay,
          "exact",
          () => this.queryClient.exactNips(relay.url, coordinate),
          coordinate.coordinate,
        ),
      ),
    );
    const eventIds = [
      ...new Set([
        ...known.map((row) => row.eventId),
        ...nipResults.flatMap((result) =>
          result.events.flatMap((event) =>
            event && typeof event === "object" && "id" in event ? [String(event.id)] : [],
          ),
        ),
      ]),
    ];
    const deletionResults = await Promise.all(
      exactRelays.map((relay) =>
        this.queryRelay(
          runId,
          relay,
          "exact",
          () => this.queryClient.deletions(relay.url, coordinate, eventIds),
          coordinate.coordinate,
        ),
      ),
    );
    const results = [...nipResults, ...deletionResults];
    return {
      events: results.flatMap((result) => result.events),
      failed: results.some((result) => result.failed),
    };
  }

  private async finishRun(
    runId: number,
    totals: Omit<IndexResult, "runId" | "status">,
    failedRelay: boolean,
  ): Promise<IndexResult> {
    const status = failedRelay ? "partial" : "succeeded";
    await this.db
      .update(indexRuns)
      .set({ ...totals, status, finishedAt: new Date() })
      .where(eq(indexRuns.id, runId));
    return { runId, status, ...totals };
  }

  private async failRun(runId: number, error: unknown): Promise<never> {
    await this.db
      .update(indexRuns)
      .set({ status: "failed", error: errorMessage(error), finishedAt: new Date() })
      .where(eq(indexRuns.id, runId));
    throw error;
  }

  async indexCoordinate(coordinateValue: string): Promise<IndexResult> {
    const coordinate = parseNipCoordinate(nipCoordinateSchema.parse(coordinateValue));
    if (!coordinate) throw new Error("Invalid NIP coordinate");
    const runId = await this.startRun("on_demand", coordinate.coordinate);
    try {
      const exact = await this.exactEvents(runId, coordinate);
      const ingested = await this.ingest(exact.events);
      return this.finishRun(runId, { ...emptyTotals(), ...ingested }, exact.failed);
    } catch (error) {
      return this.failRun(runId, error);
    }
  }

  async nightly(): Promise<IndexResult> {
    const runId = await this.startRun("nightly");
    try {
      const discovery = await Promise.all(
        this.relays
          .filter((relay) => relay.discovery)
          .map((relay) =>
            this.queryRelay(runId, relay, "discovery", () => this.queryClient.discover(relay.url)),
          ),
      );
      const totals = emptyTotals();
      const discoveredEvents = discovery.flatMap((result) => result.events);
      totals.discoveredCount = discoveredEvents.length;
      const discoveryIngest = await this.ingest(discoveredEvents);
      Object.assign(totals, discoveryIngest, { discoveredCount: totals.discoveredCount });

      const admitted = await this.db.select({ coordinate: indexedNips.coordinate }).from(indexedNips);
      const limit = pLimit(this.coordinateConcurrency);
      let failedRelay = discovery.some((result) => result.failed);
      await Promise.all(
        admitted.map(({ coordinate: value }) =>
          limit(async () => {
            const coordinate = parseNipCoordinate(value);
            if (!coordinate) return;
            const exact = await this.exactEvents(runId, coordinate);
            failedRelay ||= exact.failed;
            const result = await this.ingest(exact.events);
            totals.admittedCount += result.admittedCount;
            totals.versionCount += result.versionCount;
            totals.deletionCount += result.deletionCount;
            totals.invalidCount += result.invalidCount;
            totals.capRejectedCount += result.capRejectedCount;
          }),
        ),
      );
      return this.finishRun(runId, totals, failedRelay);
    } catch (error) {
      return this.failRun(runId, error);
    }
  }

  async settleLazyRequest(coordinate: string): Promise<void> {
    const [indexed] = await this.db
      .select({ deleted: indexedNips.deleted, currentEventId: indexedNips.currentEventId })
      .from(indexedNips)
      .where(eq(indexedNips.coordinate, coordinate))
      .limit(1);
    if (indexed && !indexed.deleted && indexed.currentEventId) {
      await this.db
        .delete(lazyIndexRequests)
        .where(eq(lazyIndexRequests.coordinate, coordinate));
    } else {
      await this.db
        .update(lazyIndexRequests)
        .set({
          status: "cooldown",
          expiresAt: new Date(Date.now() + this.lazyCooldownMinutes * 60_000),
        })
        .where(eq(lazyIndexRequests.coordinate, coordinate));
    }
  }

  close(): void {
    this.queryClient.close(this.relays.map((relay) => relay.url));
  }
}
