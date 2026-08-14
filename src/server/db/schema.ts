import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import type { Event } from "nostr-tools";

export const indexedNips = pgTable(
  "indexed_nips",
  {
    coordinate: text("coordinate").primaryKey(),
    kind: integer("kind").notNull(),
    pubkey: varchar("pubkey", { length: 64 }).notNull(),
    identifier: text("identifier").notNull(),
    currentEventId: varchar("current_event_id", { length: 64 }),
    currentCreatedAt: bigint("current_created_at", { mode: "number" }),
    deleted: boolean("deleted").notNull().default(false),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("indexed_nips_kind_check", sql`${table.kind} = 30817`),
    uniqueIndex("indexed_nips_author_identifier_idx").on(table.pubkey, table.identifier),
    index("indexed_nips_current_order_idx").on(table.currentCreatedAt, table.currentEventId),
  ],
);

export const nipVersions = pgTable(
  "nip_versions",
  {
    eventId: varchar("event_id", { length: 64 }).primaryKey(),
    coordinate: text("coordinate")
      .notNull()
      .references(() => indexedNips.coordinate, { onDelete: "restrict" }),
    pubkey: varchar("pubkey", { length: 64 }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    tags: jsonb("tags").$type<string[][]>().notNull(),
    definedKinds: jsonb("defined_kinds")
      .$type<Array<{ kind: number; name: string }>>()
      .notNull()
      .default([]),
    signature: varchar("signature", { length: 128 }).notNull(),
    rawEvent: jsonb("raw_event").$type<Event>().notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedByEventId: varchar("deleted_by_event_id", { length: 64 }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("nip_versions_coordinate_order_idx").on(
      table.coordinate,
      table.createdAt,
      table.eventId,
    ),
  ],
);

export const nipDeletionRequests = pgTable("nip_deletion_requests", {
  eventId: varchar("event_id", { length: 64 }).primaryKey(),
  pubkey: varchar("pubkey", { length: 64 }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").$type<string[][]>().notNull(),
  signature: varchar("signature", { length: 128 }).notNull(),
  rawEvent: jsonb("raw_event").$type<Event>().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nipDeletionTargets = pgTable(
  "nip_deletion_targets",
  {
    deletionEventId: varchar("deletion_event_id", { length: 64 })
      .notNull()
      .references(() => nipDeletionRequests.eventId, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetValue: text("target_value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.deletionEventId, table.targetType, table.targetValue],
      name: "nip_deletion_targets_pk",
    }),
    check(
      "nip_deletion_targets_type_check",
      sql`${table.targetType} IN ('event', 'coordinate')`,
    ),
    index("nip_deletion_targets_value_idx").on(table.targetType, table.targetValue),
  ],
);

export const indexRuns = pgTable(
  "index_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    trigger: text("trigger").notNull(),
    coordinate: text("coordinate"),
    status: text("status").notNull().default("running"),
    discoveredCount: integer("discovered_count").notNull().default(0),
    admittedCount: integer("admitted_count").notNull().default(0),
    versionCount: integer("version_count").notNull().default(0),
    deletionCount: integer("deletion_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    capRejectedCount: integer("cap_rejected_count").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("index_runs_trigger_check", sql`${table.trigger} IN ('on_demand', 'nightly')`),
    check(
      "index_runs_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'partial', 'failed')`,
    ),
    index("index_runs_started_at_idx").on(table.startedAt),
  ],
);

export const relaySyncs = pgTable(
  "relay_syncs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => indexRuns.id, { onDelete: "cascade" }),
    relayKey: text("relay_key").notNull(),
    relayUrl: text("relay_url").notNull(),
    queryType: text("query_type").notNull(),
    coordinate: text("coordinate"),
    status: text("status").notNull().default("running"),
    eventCount: integer("event_count").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("relay_syncs_query_type_check", sql`${table.queryType} IN ('exact', 'discovery')`),
    check(
      "relay_syncs_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
    index("relay_syncs_run_idx").on(table.runId),
    index("relay_syncs_relay_started_idx").on(table.relayKey, table.startedAt),
  ],
);

export const lazyIndexRequests = pgTable(
  "lazy_index_requests",
  {
    coordinate: text("coordinate").primaryKey(),
    status: text("status").notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "lazy_index_requests_status_check",
      sql`${table.status} IN ('queued', 'cooldown')`,
    ),
    index("lazy_index_requests_expires_at_idx").on(table.expiresAt),
  ],
);

export type IndexedNip = typeof indexedNips.$inferSelect;
export type NipVersion = typeof nipVersions.$inferSelect;
export type IndexRun = typeof indexRuns.$inferSelect;
