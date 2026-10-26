-- TTX: 크롬 확장으로 틱톡 댓글 읽기 (PLT-02 확장 대비책, D-TTX-07·09). 회차의 틱톡 연결에 확장 경로의 기록 수·대기 수와 마지막 확장 상태를 둔다.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 더하기만 한다.
ALTER TABLE "tiktok_links" ADD COLUMN "ext_recorded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_standby" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_screen" text;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_read" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_unread" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD COLUMN "ext_unread_since" timestamp with time zone;
