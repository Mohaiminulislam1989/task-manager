ALTER TABLE "stints" ADD COLUMN "paused_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "hold_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "paused_ms" bigint DEFAULT 0 NOT NULL;