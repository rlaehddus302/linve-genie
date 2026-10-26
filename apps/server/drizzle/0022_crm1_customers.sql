-- CRM1: 설정 "손님 관리"와 손님 메모 (SPEC BUY-06·BUY-07, D-CRM1-05·D-CRM1-08). 엔진 이벤트와 상관없는 판매자 표다. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
CREATE TABLE "customer_settings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"regular_count" integer NOT NULL,
	"regular_amount" integer,
	"wait_days" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_memos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"marker" text NOT NULL,
	"text" text NOT NULL,
	"account_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_settings" ADD CONSTRAINT "customer_settings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memos" ADD CONSTRAINT "customer_memos_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_memos" ADD CONSTRAINT "customer_memos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_memos_marker_idx" ON "customer_memos" USING btree ("seller_id","marker","id");
