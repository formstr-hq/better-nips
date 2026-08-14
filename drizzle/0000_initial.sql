CREATE TABLE "index_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"coordinate" text,
	"status" text DEFAULT 'running' NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"admitted_count" integer DEFAULT 0 NOT NULL,
	"version_count" integer DEFAULT 0 NOT NULL,
	"deletion_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"cap_rejected_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "index_runs_trigger_check" CHECK ("index_runs"."trigger" IN ('on_demand', 'nightly')),
	CONSTRAINT "index_runs_status_check" CHECK ("index_runs"."status" IN ('running', 'succeeded', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "indexed_nips" (
	"coordinate" text PRIMARY KEY NOT NULL,
	"kind" integer NOT NULL,
	"pubkey" varchar(64) NOT NULL,
	"identifier" text NOT NULL,
	"current_event_id" varchar(64),
	"current_created_at" bigint,
	"deleted" boolean DEFAULT false NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_nips_kind_check" CHECK ("indexed_nips"."kind" = 30817)
);
--> statement-breakpoint
CREATE TABLE "nip_deletion_requests" (
	"event_id" varchar(64) PRIMARY KEY NOT NULL,
	"pubkey" varchar(64) NOT NULL,
	"created_at" bigint NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb NOT NULL,
	"signature" varchar(128) NOT NULL,
	"raw_event" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nip_deletion_targets" (
	"deletion_event_id" varchar(64) NOT NULL,
	"target_type" text NOT NULL,
	"target_value" text NOT NULL,
	CONSTRAINT "nip_deletion_targets_pk" PRIMARY KEY("deletion_event_id","target_type","target_value"),
	CONSTRAINT "nip_deletion_targets_type_check" CHECK ("nip_deletion_targets"."target_type" IN ('event', 'coordinate'))
);
--> statement-breakpoint
CREATE TABLE "nip_versions" (
	"event_id" varchar(64) PRIMARY KEY NOT NULL,
	"coordinate" text NOT NULL,
	"pubkey" varchar(64) NOT NULL,
	"created_at" bigint NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb NOT NULL,
	"defined_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signature" varchar(128) NOT NULL,
	"raw_event" jsonb NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_by_event_id" varchar(64),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_syncs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"relay_key" text NOT NULL,
	"relay_url" text NOT NULL,
	"query_type" text NOT NULL,
	"coordinate" text,
	"status" text DEFAULT 'running' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "relay_syncs_query_type_check" CHECK ("relay_syncs"."query_type" IN ('exact', 'discovery')),
	CONSTRAINT "relay_syncs_status_check" CHECK ("relay_syncs"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "nip_deletion_targets" ADD CONSTRAINT "nip_deletion_targets_deletion_event_id_nip_deletion_requests_event_id_fk" FOREIGN KEY ("deletion_event_id") REFERENCES "public"."nip_deletion_requests"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nip_versions" ADD CONSTRAINT "nip_versions_coordinate_indexed_nips_coordinate_fk" FOREIGN KEY ("coordinate") REFERENCES "public"."indexed_nips"("coordinate") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_syncs" ADD CONSTRAINT "relay_syncs_run_id_index_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."index_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_runs_started_at_idx" ON "index_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_nips_author_identifier_idx" ON "indexed_nips" USING btree ("pubkey","identifier");--> statement-breakpoint
CREATE INDEX "indexed_nips_current_order_idx" ON "indexed_nips" USING btree ("current_created_at","current_event_id");--> statement-breakpoint
CREATE INDEX "nip_deletion_targets_value_idx" ON "nip_deletion_targets" USING btree ("target_type","target_value");--> statement-breakpoint
CREATE INDEX "nip_versions_coordinate_order_idx" ON "nip_versions" USING btree ("coordinate","created_at","event_id");--> statement-breakpoint
CREATE INDEX "relay_syncs_run_idx" ON "relay_syncs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "relay_syncs_relay_started_idx" ON "relay_syncs" USING btree ("relay_key","started_at");
