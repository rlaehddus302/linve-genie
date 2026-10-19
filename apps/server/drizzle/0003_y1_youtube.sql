-- Y1: 유튜브 연결·방송 잇기·채팅 수집·감사 메시지 발송함·할당량·원문 30일 (AC-Y1-01~62). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 이벤트 기록: Y1부터 기록하는 채팅의 본문·이름은 chat_raw에 따로 둔다(raw = true). 어디서 온 채팅인지(chat_source) 남긴다 (AC-Y1-60).
ALTER TABLE "events" ADD COLUMN "chat_source" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "raw" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "chat_raw" (
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"seq" integer NOT NULL,
	"nick" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "chat_raw_scope_seq_uq" UNIQUE("scope_id","seq")
);
--> statement-breakpoint
-- 범위: 봉인 (AC-Y1-61·62) — 봉인 시각·형식에 매이지 않는 장부(JSON)·장부 요약값, 유튜브 채팅이 있는 범위인지(봉인 예정 시각)
ALTER TABLE "scopes" ADD COLUMN "youtube_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scopes" ADD COLUMN "sealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scopes" ADD COLUMN "ledger" text;--> statement-breakpoint
ALTER TABLE "scopes" ADD COLUMN "ledger_digest" text;--> statement-breakpoint
-- 발송함 실행기 (AC-Y1-30~46). state가 null인 행은 실행기가 아직 보지 않았거나 다루지 않는 행(라벨·리허설)이다
ALTER TABLE "outbox" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "target" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "broadcast_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "post_text" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "sent_text" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "confirm_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "remote_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "reported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "resend_request_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_resend_request_uq" UNIQUE("seller_id","resend_request_id");--> statement-breakpoint
CREATE INDEX "outbox_runner_idx" ON "outbox" USING btree ("rehearsal","state","next_at");--> statement-breakpoint
CREATE INDEX "outbox_group_idx" ON "outbox" USING btree ("seller_id","group_id");--> statement-breakpoint
-- 구글 연결 (AC-Y1-01~06·31). 토큰은 서버 마스터 키로 암호화한 값만 둔다. 채널 하나는 판매자 하나에만
CREATE TABLE "youtube_connections" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"channel_title" text NOT NULL,
	"status" text NOT NULL,
	"can_publish" boolean DEFAULT false NOT NULL,
	"refresh_enc" text,
	"access_enc" text,
	"access_expires_at" timestamp with time zone,
	"consent_live_chat_at" timestamp with time zone,
	"consent_live_chat_by" text,
	"consent_video_comment_at" timestamp with time zone,
	"consent_video_comment_by" text,
	"connected_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "youtube_connections_channel_uq" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "youtube_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"session_hash" text NOT NULL,
	"account_id" text NOT NULL,
	"verifier_enc" text NOT NULL,
	"purpose" text NOT NULL,
	"target" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "youtube_oauth_states_seller_idx" ON "youtube_oauth_states" USING btree ("seller_id","expires_at");--> statement-breakpoint
-- 방송 잇기 (AC-Y1-12·13). 라이브찜 방송 하나에 이어진 유튜브 방송은 한 번에 하나
CREATE TABLE "youtube_links" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"video_id" text NOT NULL,
	"live_chat_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"linked_by" text,
	"request_id" text,
	"unlinked_at" timestamp with time zone,
	"unlinked_by" text,
	"chat_ended_at" timestamp with time zone,
	"summary_at" timestamp with time zone,
	CONSTRAINT "youtube_links_request_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_links_active_uq" ON "youtube_links" USING btree ("seller_id","broadcast_id") WHERE "youtube_links"."unlinked_at" is null;--> statement-breakpoint
CREATE INDEX "youtube_links_video_idx" ON "youtube_links" USING btree ("seller_id","video_id");--> statement-breakpoint
-- 수집기 (AC-Y1-20~28). 이은 것(link)마다 하나 — 이어받기 지점·방식·상태·서버 전체에서 하나만 돌게 하는 임대
CREATE TABLE "youtube_collectors" (
	"link_id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"page_token" text,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"first_done" boolean DEFAULT false NOT NULL,
	"gap" boolean DEFAULT false NOT NULL,
	"skipped_before_link" integer DEFAULT 0 NOT NULL,
	"recorded" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"resume_at" timestamp with time zone,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "youtube_collectors_seller_idx" ON "youtube_collectors" USING btree ("seller_id","status");--> statement-breakpoint
-- 우리 채널이 쓴 메시지 (게시 확인, AC-Y1-26·36). 봉인하면 지운다
CREATE TABLE "youtube_own_messages" (
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"live_chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"text" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "youtube_own_messages_uq" UNIQUE("seller_id","message_id")
);
--> statement-breakpoint
CREATE INDEX "youtube_own_messages_chat_idx" ON "youtube_own_messages" USING btree ("seller_id","live_chat_id","published_at");--> statement-breakpoint
-- 지운 메시지·유튜브 차단 알림 (AC-Y1-27). 엔진 입력이 아니다. 봉인하면 지운다
CREATE TABLE "youtube_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"message_id" text,
	"channel_id" text NOT NULL,
	"nick" text NOT NULL,
	"was_order" boolean DEFAULT false NOT NULL,
	"was_cancel" boolean DEFAULT false NOT NULL,
	"ban_type" text,
	"ban_seconds" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "youtube_notices_dedupe_uq" UNIQUE("seller_id","dedupe_key")
);
--> statement-breakpoint
CREATE INDEX "youtube_notices_scope_idx" ON "youtube_notices" USING btree ("seller_id","scope_id","id");--> statement-breakpoint
-- 할당량 계량 (AC-Y1-50~53): 판매자·태평양 날짜·호출 종류마다 횟수·단위
CREATE TABLE "youtube_quota" (
	"seller_id" text NOT NULL,
	"day" text NOT NULL,
	"method" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "youtube_quota_uq" UNIQUE("seller_id","day","method")
);
--> statement-breakpoint
CREATE INDEX "youtube_quota_day_idx" ON "youtube_quota" USING btree ("day");--> statement-breakpoint
ALTER TABLE "chat_raw" ADD CONSTRAINT "chat_raw_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_raw" ADD CONSTRAINT "chat_raw_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_connections" ADD CONSTRAINT "youtube_connections_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_oauth_states" ADD CONSTRAINT "youtube_oauth_states_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_links" ADD CONSTRAINT "youtube_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_links" ADD CONSTRAINT "youtube_links_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_collectors" ADD CONSTRAINT "youtube_collectors_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_collectors" ADD CONSTRAINT "youtube_collectors_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_own_messages" ADD CONSTRAINT "youtube_own_messages_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_own_messages" ADD CONSTRAINT "youtube_own_messages_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_notices" ADD CONSTRAINT "youtube_notices_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_notices" ADD CONSTRAINT "youtube_notices_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_quota" ADD CONSTRAINT "youtube_quota_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;
