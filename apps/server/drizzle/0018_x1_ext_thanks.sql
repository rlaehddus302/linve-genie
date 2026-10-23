-- X1: 크롬 확장으로 감사 채팅 올리기(선택 — YT-10 AC11~AC17, D-X1-17~D-X1-24). 발송함 행의 게시 경로, 판매자 스위치, 회차별 상태.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 더하기만 한다.
ALTER TABLE "outbox" ADD COLUMN "via" text;
--> statement-breakpoint
CREATE TABLE "ext_post_settings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"enabled_at" timestamp with time zone,
	"enabled_by" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_post_lanes" (
	"seller_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"fails" integer DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	"owner_problem_at" timestamp with time zone,
	"owner_channel_id" text,
	"last_taken_at" timestamp with time zone,
	"last_done_at" timestamp with time zone,
	CONSTRAINT "ext_post_lanes_uq" UNIQUE("seller_id","broadcast_id")
);
--> statement-breakpoint
ALTER TABLE "ext_post_settings" ADD CONSTRAINT "ext_post_settings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_post_lanes" ADD CONSTRAINT "ext_post_lanes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;
