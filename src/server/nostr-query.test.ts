import { describe, expect, it } from "vitest";
import { NostrQueryClient, type RelayPool } from "./nostr-query";
import type { NipCoordinate } from "./types";

const coordinate: NipCoordinate = {
  kind: 30817,
  pubkey: "ab".repeat(32),
  identifier: "test",
  coordinate: `30817:${"ab".repeat(32)}:test`,
};

function poolWithSubscription(
  subscribe: (params: { oneose?: () => void }) => { close: () => void },
): RelayPool {
  return {
    close: () => {},
    ensureRelay: async () => ({ subscribe: (_filters: unknown, params: unknown) => subscribe(params as { oneose?: () => void }) }),
  } as unknown as RelayPool;
}

describe("Nostr server queries", () => {
  it("completes only after relay EOSE", async () => {
    const pool = poolWithSubscription((params) => {
      queueMicrotask(() => params.oneose?.());
      return { close: () => {} };
    });
    const client = new NostrQueryClient(pool, { timeoutMs: 50, retries: 0 });
    await expect(client.exactNips("wss://relay.example.com", coordinate)).resolves.toEqual([]);
  });

  it("rejects a relay that never sends EOSE", async () => {
    const pool = poolWithSubscription(() => ({ close: () => {} }));
    const client = new NostrQueryClient(pool, { timeoutMs: 10, retries: 0 });
    await expect(client.exactNips("wss://relay.example.com", coordinate)).rejects.toThrow(
      "timed out",
    );
  });
});
