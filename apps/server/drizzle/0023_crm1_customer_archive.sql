-- CRM1: 손님 기록 보관 (D-CRM1-12, AC-CRM1-33). 30일 봉인 전에 손님 기록용 취소 수·'입금 안 함'을 남긴다. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
CREATE TABLE "customer_archive_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"date" text NOT NULL,
	"seq" integer NOT NULL,
	"frozen" boolean NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customer_archive_days_seller_date_uq" UNIQUE("seller_id","date")
);
--> statement-breakpoint
CREATE TABLE "customer_archive_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"date" text NOT NULL,
	"root" text NOT NULL,
	"members" text NOT NULL,
	"cancels" integer NOT NULL,
	"no_pay" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_archive_days" ADD CONSTRAINT "customer_archive_days_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_archive_rows" ADD CONSTRAINT "customer_archive_rows_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_archive_rows_date_idx" ON "customer_archive_rows" USING btree ("seller_id","date");
