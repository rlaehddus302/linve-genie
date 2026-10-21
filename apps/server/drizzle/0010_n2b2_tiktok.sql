-- N2b-2 (0010): 동시 송출(회차·플랫폼마다 연결 하나)·틱톡 연결·틱톡 동의 기록·틱톡 아이디·댓글 붙여넣기 요청 (PLT-02·PLT-03, D-N2b-2-01·04·05·08). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 모든 표에 판매자 ID가 있다(SYS-02). 붙여 넣은 글은 두지 않고 요약값만 둔다.
DROP INDEX "live_links_open_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "live_links_open_uq" ON "live_links" USING btree ("seller_id","broadcast_id","platform") WHERE state <> 'UNLINKED';--> statement-breakpoint
CREATE TABLE "tiktok_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"state" text NOT NULL,
	"tiktok_id" text NOT NULL,
	"actor_account_id" text,
	"linked_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"unlinked_at" timestamp with time zone,
	"unlinked_by" text,
	"not_recorded" integer DEFAULT 0 NOT NULL,
	"save_failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiktok_consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"on" boolean NOT NULL,
	"notice_version" text,
	"request_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "tiktok_consents_request_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "tiktok_accounts" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"tiktok_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "paste_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"digest" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "paste_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD CONSTRAINT "tiktok_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD CONSTRAINT "tiktok_links_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD CONSTRAINT "tiktok_links_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD CONSTRAINT "tiktok_links_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_links" ADD CONSTRAINT "tiktok_links_unlinked_by_accounts_id_fk" FOREIGN KEY ("unlinked_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_consents" ADD CONSTRAINT "tiktok_consents_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_consents" ADD CONSTRAINT "tiktok_consents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paste_requests" ADD CONSTRAINT "paste_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_links_open_uq" ON "tiktok_links" USING btree ("seller_id","broadcast_id") WHERE state = 'LINKED';--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_links_seller_uq" ON "tiktok_links" USING btree ("seller_id") WHERE state = 'LINKED';--> statement-breakpoint
CREATE INDEX "tiktok_links_broadcast_idx" ON "tiktok_links" USING btree ("seller_id","broadcast_id");--> statement-breakpoint
CREATE INDEX "tiktok_consents_seller_idx" ON "tiktok_consents" USING btree ("seller_id","id");--> statement-breakpoint
CREATE INDEX "events_tt_chat_idx" ON "events" USING btree ("seller_id","chat_broadcast") WHERE chat_message_id LIKE 'tt:%';
