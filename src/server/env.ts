import { z } from "zod";
import { DEFAULT_INDEX_CAP } from "./types";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SITE_URL: z.url().default("http://localhost:3000"),
  NOSTR_INDEX_RELAYS: z.string().optional(),
  MAX_INDEXED_NIPS: z.coerce.number().int().positive().max(49_999).default(DEFAULT_INDEX_CAP),
  NIP_INDEX_CRON: z.string().min(9).default("0 3 * * *"),
  RELAY_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8_000),
  RELAY_QUERY_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  RELAY_QUERY_CONCURRENCY: z.coerce.number().int().positive().max(32).default(8),
  INDEX_COORDINATE_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
  MAX_PENDING_INDEX_JOBS: z.coerce.number().int().positive().max(10_000).default(1_000),
  LAZY_INDEX_COOLDOWN_MINUTES: z.coerce.number().int().positive().max(10_080).default(1_440),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= envSchema.parse(process.env);
  return cached;
}
