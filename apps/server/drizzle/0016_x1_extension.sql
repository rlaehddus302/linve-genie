-- X1: 크롬 확장으로 채팅 읽기(보조 경로, 읽기만 — YT-10, D-X1-07·08·10·11). 연결 코드·토큰은 해시로만, 회차 잇기, 마지막 상태.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 표를 더하기만 한다.
CREATE TABLE "ext_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ext_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "ext_tokens_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ext_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"token_id" text NOT NULL,
	"video_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"how" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"unbound_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ext_status" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"video_id" text,
	"status_at" timestamp with time zone NOT NULL,
	"hidden" boolean NOT NULL,
	"read_count" integer NOT NULL,
	"unread_count" integer NOT NULL,
	"dropped" integer NOT NULL,
	"unread_since" timestamp with time zone,
	"last_chat_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ext_codes" ADD CONSTRAINT "ext_codes_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_tokens" ADD CONSTRAINT "ext_tokens_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_bindings" ADD CONSTRAINT "ext_bindings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_status" ADD CONSTRAINT "ext_status_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ext_codes_seller_idx" ON "ext_codes" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_tokens_active_uq" ON "ext_tokens" USING btree ("seller_id") WHERE "ext_tokens"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_bindings_video_uq" ON "ext_bindings" USING btree ("seller_id","video_id") WHERE "ext_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_bindings_broadcast_uq" ON "ext_bindings" USING btree ("seller_id","broadcast_id") WHERE "ext_bindings"."unbound_at" is null;
