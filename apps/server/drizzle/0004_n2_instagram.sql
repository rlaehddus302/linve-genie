-- N2: 플랫폼 라이브 연결·인스타그램 계정 연결·DM 발송 기록 (PLT-01·PLT-03, D-N2-01~D-N2-15). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 발송함(outbox) 표는 바꾸지 않는다(Y1 트랙과 겹치지 않게, D-N2-01). 모든 표에 판매자 ID가 있다(SYS-02). 토큰은 암호화한 값만, OAuth state는 해시만 둔다.
CREATE TABLE "ig_connections" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"account_id" text NOT NULL,
	"username" text NOT NULL,
	"account_type" text,
	"page_id" text,
	"tokens_enc" text NOT NULL,
	"token_obtained_at" timestamp with time zone NOT NULL,
	"token_expires_at" timestamp with time zone,
	"perm_comments" boolean NOT NULL,
	"perm_messages" boolean NOT NULL,
	"status" text NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_by" text,
	"malformed_count" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ig_connections_account_uq" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "ig_oauth_states" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"session_hash" text NOT NULL,
	"state_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"login" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ig_oauth_states_state_uq" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "live_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"platform" text NOT NULL,
	"state" text NOT NULL,
	"live_id" text,
	"account_id" text,
	"actor" text NOT NULL,
	"actor_account_id" text,
	"linked_at" timestamp with time zone NOT NULL,
	"unlinked_at" timestamp with time zone,
	"unlinked_by" text,
	"late_count" integer DEFAULT 0 NOT NULL,
	"malformed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_unlinked" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"platform" text NOT NULL,
	"live_id" text NOT NULL,
	"count" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_unlinked_uq" UNIQUE("seller_id","platform","live_id")
);
--> statement-breakpoint
CREATE TABLE "live_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "ig_dm_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"date" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"comment" text NOT NULL,
	"igsid" text NOT NULL,
	"text" text,
	"state" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"manual" boolean DEFAULT false NOT NULL,
	"meta_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ig_dm_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"date" text NOT NULL,
	"outbox_id" bigint NOT NULL,
	"effect_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ord" integer NOT NULL,
	"broadcast_id" text NOT NULL,
	"product" text NOT NULL,
	"buyer" text NOT NULL,
	"comment" text,
	"line" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"send_id" bigint,
	"sent_at" timestamp with time zone,
	"meta_message_id" text,
	"reported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ig_dm_rows_outbox_uq" UNIQUE("seller_id","outbox_id")
);
--> statement-breakpoint
ALTER TABLE "ig_connections" ADD CONSTRAINT "ig_connections_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_connections" ADD CONSTRAINT "ig_connections_consent_by_accounts_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_oauth_states" ADD CONSTRAINT "ig_oauth_states_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_oauth_states" ADD CONSTRAINT "ig_oauth_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_links" ADD CONSTRAINT "live_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_links" ADD CONSTRAINT "live_links_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_links" ADD CONSTRAINT "live_links_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_links" ADD CONSTRAINT "live_links_unlinked_by_accounts_id_fk" FOREIGN KEY ("unlinked_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_unlinked" ADD CONSTRAINT "live_unlinked_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_requests" ADD CONSTRAINT "live_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_dm_sends" ADD CONSTRAINT "ig_dm_sends_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_dm_sends" ADD CONSTRAINT "ig_dm_sends_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_dm_rows" ADD CONSTRAINT "ig_dm_rows_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_dm_rows" ADD CONSTRAINT "ig_dm_rows_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_dm_rows" ADD CONSTRAINT "ig_dm_rows_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_dm_rows" ADD CONSTRAINT "ig_dm_rows_send_id_ig_dm_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."ig_dm_sends"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ig_oauth_states_seller_idx" ON "ig_oauth_states" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_links_open_uq" ON "live_links" USING btree ("seller_id","broadcast_id") WHERE state <> 'UNLINKED';--> statement-breakpoint
CREATE INDEX "live_links_broadcast_idx" ON "live_links" USING btree ("seller_id","broadcast_id");--> statement-breakpoint
CREATE INDEX "live_links_live_idx" ON "live_links" USING btree ("seller_id","live_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ig_dm_sends_active_uq" ON "ig_dm_sends" USING btree ("seller_id","scope_id","comment") WHERE state IN ('PENDING', 'SENDING', 'CONFIRMING');--> statement-breakpoint
CREATE INDEX "ig_dm_sends_state_idx" ON "ig_dm_sends" USING btree ("state","next_at");--> statement-breakpoint
CREATE INDEX "ig_dm_rows_status_idx" ON "ig_dm_rows" USING btree ("status","seller_id");--> statement-breakpoint
CREATE INDEX "ig_dm_rows_comment_idx" ON "ig_dm_rows" USING btree ("seller_id","scope_id","comment");
--> statement-breakpoint
CREATE INDEX "events_ig_chat_idx" ON "events" USING btree ("seller_id","chat_message_id") WHERE chat_message_id LIKE 'ig:%';
