CREATE TABLE "lazy_index_requests" (
	"coordinate" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lazy_index_requests_status_check" CHECK ("lazy_index_requests"."status" IN ('queued', 'cooldown'))
);
--> statement-breakpoint
CREATE INDEX "lazy_index_requests_expires_at_idx" ON "lazy_index_requests" USING btree ("expires_at");