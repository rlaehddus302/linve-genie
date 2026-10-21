ALTER TABLE "tiktok_links" ADD COLUMN "save_failed_seen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "skipped" integer DEFAULT 0 NOT NULL;
