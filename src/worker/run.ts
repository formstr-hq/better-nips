import { createDatabasePool } from "../server/db";
import { getServerEnv } from "../server/env";
import { NipIndexer } from "../server/indexer";
import { NostrQueryClient } from "../server/nostr-query";
import { configuredRelayRegistry } from "../server/relays";
import { nightlyCrontab, runIndexWorker } from "./index";

const env = getServerEnv();
const { db, pool } = createDatabasePool(env.DATABASE_URL);
const indexer = new NipIndexer(
  db,
  configuredRelayRegistry(env.NOSTR_INDEX_RELAYS),
  {
    cap: env.MAX_INDEXED_NIPS,
    coordinateConcurrency: env.INDEX_COORDINATE_CONCURRENCY,
    lazyCooldownMinutes: env.LAZY_INDEX_COOLDOWN_MINUTES,
    queryClient: new NostrQueryClient(undefined, {
      timeoutMs: env.RELAY_QUERY_TIMEOUT_MS,
      retries: env.RELAY_QUERY_RETRIES,
      concurrency: env.RELAY_QUERY_CONCURRENCY,
      discoveryLimit: env.MAX_INDEXED_NIPS,
    }),
  },
);

try {
  const runner = await runIndexWorker({
    connectionString: env.DATABASE_URL,
    indexer,
    concurrency: env.WORKER_CONCURRENCY,
    crontab: nightlyCrontab(env.NIP_INDEX_CRON),
  });
  await runner.promise;
} finally {
  indexer.close();
  await pool.end();
}
