import { and, asc, count, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { Event } from "nostr-tools";
import { createDatabase, type Database } from "./db";
import { indexedNips, lazyIndexRequests, nipVersions } from "./db/schema";
import { getServerEnv } from "./env";

let database: Database | undefined;

export function getDatabase(): Database {
  database ??= createDatabase(getServerEnv().DATABASE_URL);
  return database;
}

export type IndexedNipState =
  | { status: "missing" }
  | { status: "deleted"; coordinate: string }
  | {
      status: "active";
      coordinate: string;
      event: Event;
      title: string;
      summary: string;
      updatedAt: Date;
    };

export async function getIndexedNip(
  coordinate: string,
  db: Database = getDatabase(),
): Promise<IndexedNipState> {
  const [row] = await db
    .select({
      coordinate: indexedNips.coordinate,
      deleted: indexedNips.deleted,
      rawEvent: nipVersions.rawEvent,
      title: nipVersions.title,
      summary: nipVersions.summary,
      updatedAt: indexedNips.updatedAt,
    })
    .from(indexedNips)
    .leftJoin(nipVersions, eq(nipVersions.eventId, indexedNips.currentEventId))
    .where(eq(indexedNips.coordinate, coordinate))
    .limit(1);

  if (!row) return { status: "missing" };
  if (row.deleted || !row.rawEvent || !row.title || row.summary === null) {
    return { status: "deleted", coordinate: row.coordinate };
  }
  return {
    status: "active",
    coordinate: row.coordinate,
    event: row.rawEvent,
    title: row.title,
    summary: row.summary,
    updatedAt: row.updatedAt,
  };
}

export async function listIndexedNips(
  limit: number,
  db: Database = getDatabase(),
) {
  return db
    .select({
      coordinate: indexedNips.coordinate,
      pubkey: indexedNips.pubkey,
      identifier: indexedNips.identifier,
      createdAt: indexedNips.currentCreatedAt,
      updatedAt: indexedNips.updatedAt,
    })
    .from(indexedNips)
    .where(
      and(eq(indexedNips.deleted, false), isNotNull(indexedNips.currentEventId)),
    )
    .orderBy(desc(indexedNips.currentCreatedAt), indexedNips.coordinate)
    .limit(limit);
}

export async function countAdmittedNips(db: Database = getDatabase()): Promise<number> {
  const [row] = await db.select({ value: count() }).from(indexedNips);
  return row?.value ?? 0;
}

const LAZY_QUEUE_LOCK_ID = 3_081_700_010;

export async function reserveLazyIndexRequest(
  coordinate: string,
  maxPending: number,
  cooldownMinutes: number,
  db: Database = getDatabase(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LAZY_QUEUE_LOCK_ID})`);
    const now = new Date();
    await tx.delete(lazyIndexRequests).where(lt(lazyIndexRequests.expiresAt, now));
    const [existing] = await tx
      .select({ status: lazyIndexRequests.status })
      .from(lazyIndexRequests)
      .where(eq(lazyIndexRequests.coordinate, coordinate))
      .limit(1);
    if (existing?.status === "cooldown") return false;

    if (!existing) {
      const [pending] = await tx.select({ value: count() }).from(lazyIndexRequests);
      if ((pending?.value ?? 0) >= maxPending) {
        const [oldestCooldown] = await tx
          .select({ coordinate: lazyIndexRequests.coordinate })
          .from(lazyIndexRequests)
          .where(eq(lazyIndexRequests.status, "cooldown"))
          .orderBy(asc(lazyIndexRequests.requestedAt))
          .limit(1);
        if (!oldestCooldown) return false;
        await tx
          .delete(lazyIndexRequests)
          .where(eq(lazyIndexRequests.coordinate, oldestCooldown.coordinate));
      }
    }
    const expiresAt = new Date(now.getTime() + cooldownMinutes * 60_000);
    await tx
      .insert(lazyIndexRequests)
      .values({ coordinate, status: "queued", requestedAt: now, expiresAt })
      .onConflictDoUpdate({
        target: lazyIndexRequests.coordinate,
        set: { status: "queued", requestedAt: now, expiresAt },
      });
    return true;
  });
}
