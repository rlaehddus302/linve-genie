-- BND1 (0020): 밴드 계정 연결·연결 시작 표·회차의 밴드 글 연결·본 댓글 표·알림 (PLT-04, D-BND1-07·09·10·11·12·14). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 모든 표에 판매자 ID가 있다(SYS-02). 토큰은 마스터 키로 암호화한 값만 둔다. 밴드 글 연결은 회차·범위를 외래 키로 잇지 않는다(복구 뒤에도 남아 FINISHED가 된다).
CREATE TABLE "band_accounts" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"user_key" text NOT NULL,
	"token_enc" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"profile_name" text,
	"connected_at" timestamp with time zone NOT NULL,
	"chosen_band" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "band_oauth_states" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"session_hash" text NOT NULL,
	"state_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "band_oauth_states_state_uq" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "band_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"date" text NOT NULL,
	"state" text NOT NULL,
	"finish_reason" text,
	"band_key" text NOT NULL,
	"post_key" text NOT NULL,
	"post_line" text NOT NULL,
	"actor_account_id" text,
	"linked_at" timestamp with time zone NOT NULL,
	"baseline" integer DEFAULT 0 NOT NULL,
	"skip_seller" integer DEFAULT 0 NOT NULL,
	"skip_no_author" integer DEFAULT 0 NOT NULL,
	"skip_bad_key" integer DEFAULT 0 NOT NULL,
	"skip_bad_time" integer DEFAULT 0 NOT NULL,
	"skip_no_text" integer DEFAULT 0 NOT NULL,
	"skip_too_long" integer DEFAULT 0 NOT NULL,
	"skip_duplicate" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"rate_limited" boolean DEFAULT false NOT NULL,
	"notices_seen" bigint DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"finished_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "band_seen" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"link_id" bigint NOT NULL,
	"comment_key" text NOT NULL,
	"kind" text NOT NULL,
	"text_hash" text,
	"nick" text,
	"text" text,
	"deleted_noticed" boolean DEFAULT false NOT NULL,
	"edited_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "band_seen_uq" UNIQUE("link_id","comment_key")
);
--> statement-breakpoint
CREATE TABLE "band_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"link_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"nick" text,
	"before_text" text,
	"after_text" text,
	"minutes" integer,
	"count" integer,
	"erased" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "band_accounts" ADD CONSTRAINT "band_accounts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_oauth_states" ADD CONSTRAINT "band_oauth_states_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_oauth_states" ADD CONSTRAINT "band_oauth_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_links" ADD CONSTRAINT "band_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_links" ADD CONSTRAINT "band_links_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_links" ADD CONSTRAINT "band_links_finished_by_accounts_id_fk" FOREIGN KEY ("finished_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_seen" ADD CONSTRAINT "band_seen_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_seen" ADD CONSTRAINT "band_seen_link_id_band_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."band_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_notices" ADD CONSTRAINT "band_notices_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "band_notices" ADD CONSTRAINT "band_notices_link_id_band_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."band_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "band_oauth_states_seller_idx" ON "band_oauth_states" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "band_links_open_uq" ON "band_links" USING btree ("seller_id","broadcast_id") WHERE state <> 'FINISHED';--> statement-breakpoint
CREATE UNIQUE INDEX "band_links_seller_uq" ON "band_links" USING btree ("seller_id") WHERE state <> 'FINISHED';--> statement-breakpoint
CREATE INDEX "band_links_broadcast_idx" ON "band_links" USING btree ("seller_id","broadcast_id");--> statement-breakpoint
CREATE INDEX "band_seen_seller_idx" ON "band_seen" USING btree ("seller_id","link_id");--> statement-breakpoint
CREATE INDEX "band_notices_link_idx" ON "band_notices" USING btree ("seller_id","link_id","id");
