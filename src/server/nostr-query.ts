import type { Event, Filter } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import pLimit from "p-limit";
import pRetry from "p-retry";
import type { NipCoordinate } from "./types";
import { DELETION_KIND, NIP_KIND } from "./types";

export interface RelayQueryOptions {
  timeoutMs?: number;
  retries?: number;
  concurrency?: number;
  discoveryLimit?: number;
}

export type RelayPool = Pick<SimplePool, "close" | "ensureRelay">;

const uniqueEvents = (events: readonly Event[]): Event[] => [
  ...new Map(events.map((event) => [event.id, event])).values(),
];

export class NostrQueryClient {
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly discoveryLimit: number;

  constructor(
    private readonly pool: RelayPool = new SimplePool(),
    options: RelayQueryOptions = {},
  ) {
    this.limit = pLimit(options.concurrency ?? 8);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retries = options.retries ?? 2;
    this.discoveryLimit = options.discoveryLimit ?? 10_000;
  }

  private async query(relayUrl: string, filters: readonly Filter[]): Promise<Event[]> {
    const batches = await this.limit(() =>
      pRetry(
        async () => {
          try {
            const relay = await this.pool.ensureRelay(relayUrl, {
              connectionTimeout: this.timeoutMs,
            });
            return await new Promise<Event[]>((resolve, reject) => {
              const events: Event[] = [];
              let settled = false;
              const state: { subscription?: { close: (reason?: string) => void } } = {};
              const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                state.subscription?.close(error ? "query failed" : "query complete");
                if (error) reject(error);
                else resolve(events);
              };
              const timeout = setTimeout(
                () => finish(new Error(`Relay query timed out after ${this.timeoutMs}ms`)),
                this.timeoutMs,
              );
              state.subscription = relay.subscribe([...filters], {
                onevent: (event) => events.push(event),
                oneose: () => finish(),
                onclose: (reason) =>
                  finish(new Error(`Relay closed the query before EOSE: ${reason}`)),
                eoseTimeout: this.timeoutMs * 2,
              });
            });
          } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
          }
        },
        { retries: this.retries },
      ),
    );
    return uniqueEvents(batches.flat());
  }

  discover(relayUrl: string): Promise<Event[]> {
    return this.query(relayUrl, [{ kinds: [NIP_KIND], limit: this.discoveryLimit }]);
  }

  exactNips(relayUrl: string, coordinate: NipCoordinate): Promise<Event[]> {
    return this.query(relayUrl, [
      {
        kinds: [NIP_KIND],
        authors: [coordinate.pubkey],
        "#d": [coordinate.identifier],
        limit: 100,
      },
    ]);
  }

  deletions(
    relayUrl: string,
    coordinate: NipCoordinate,
    eventIds: readonly string[] = [],
  ): Promise<Event[]> {
    const deletionFilters: Filter[] = [
      {
        kinds: [DELETION_KIND],
        authors: [coordinate.pubkey],
        "#a": [coordinate.coordinate],
      },
    ];
    for (let offset = 0; offset < eventIds.length; offset += 100) {
      deletionFilters.push({
        kinds: [DELETION_KIND],
        authors: [coordinate.pubkey],
        "#e": eventIds.slice(offset, offset + 100),
      });
    }
    return this.query(relayUrl, deletionFilters);
  }

  async exact(
    relayUrl: string,
    coordinate: NipCoordinate,
    knownEventIds: readonly string[] = [],
  ): Promise<Event[]> {
    const nipEvents = await this.exactNips(relayUrl, coordinate);
    const eventIds = [...new Set([...knownEventIds, ...nipEvents.map((event) => event.id)])];
    const deletions = await this.deletions(relayUrl, coordinate, eventIds);
    return uniqueEvents([...nipEvents, ...deletions]);
  }

  close(relayUrls: readonly string[]): void {
    this.pool.close([...relayUrls]);
  }
}
