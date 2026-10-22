-- N3: 입금 확인 (DEPOSIT_RULES DP-1·DP-6, D-N3-05·D-N3-06·D-N3-09·D-N3-10) — 입금 원천·입금·입금과 엔진 기록의 연결·처리 기록·기억한 입금자명·요청 번호.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 이벤트·발송함·스냅샷·출력 표는 바꾸지 않는다. 모든 표에 판매자 ID가 있다(SYS-02).
CREATE TABLE "deposit_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_min" integer DEFAULT 5 NOT NULL,
	"account_enc" text,
	"last_fetched_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"last_new" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"no" integer NOT NULL,
	"source_id" text NOT NULL,
	"external_key" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"precision" text NOT NULL,
	"amount" integer NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"turn" integer DEFAULT 0 NOT NULL,
	"applied_date" text,
	"applied_buyer" text,
	"applied_seq" integer,
	"received_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone,
	CONSTRAINT "deposits_no_uq" UNIQUE("seller_id","no"),
	CONSTRAINT "deposits_external_uq" UNIQUE("seller_id","source_id","external_key")
);
--> statement-breakpoint
CREATE TABLE "deposit_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"deposit_id" bigint NOT NULL,
	"scope_id" text NOT NULL,
	"date" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"turn" integer NOT NULL,
	"buyer" text NOT NULL,
	"auto" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deposit_links_seq_uq" UNIQUE("seller_id","scope_id","seq")
);
--> statement-breakpoint
CREATE TABLE "deposit_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"deposit_id" bigint NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"account_id" text,
	"date" text,
	"buyer" text,
	"scope_id" text,
	"seq" integer,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_names" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"channel" text NOT NULL,
	"norm" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deposit_names_uq" UNIQUE("seller_id","channel","norm")
);
--> statement-breakpoint
CREATE TABLE "deposit_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deposit_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "deposit_sources" ADD CONSTRAINT "deposit_sources_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_source_id_deposit_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."deposit_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_links" ADD CONSTRAINT "deposit_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_links" ADD CONSTRAINT "deposit_links_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_links" ADD CONSTRAINT "deposit_links_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_actions" ADD CONSTRAINT "deposit_actions_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_actions" ADD CONSTRAINT "deposit_actions_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_actions" ADD CONSTRAINT "deposit_actions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_actions" ADD CONSTRAINT "deposit_actions_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_names" ADD CONSTRAINT "deposit_names_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_sources_seller_idx" ON "deposit_sources" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_sources_paste_uq" ON "deposit_sources" USING btree ("seller_id") WHERE kind = 'PASTE';--> statement-breakpoint
CREATE INDEX "deposits_status_idx" ON "deposits" USING btree ("seller_id","status","no");--> statement-breakpoint
CREATE INDEX "deposits_at_idx" ON "deposits" USING btree ("seller_id","at");--> statement-breakpoint
CREATE INDEX "deposit_links_deposit_idx" ON "deposit_links" USING btree ("deposit_id");--> statement-breakpoint
CREATE INDEX "deposit_actions_deposit_idx" ON "deposit_actions" USING btree ("deposit_id","id");--> statement-breakpoint
CREATE TABLE "deposit_corp_bindings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"corp_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deposit_corp_bindings_corp_uq" UNIQUE("corp_key")
);
--> statement-breakpoint
ALTER TABLE "deposit_corp_bindings" ADD CONSTRAINT "deposit_corp_bindings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;
