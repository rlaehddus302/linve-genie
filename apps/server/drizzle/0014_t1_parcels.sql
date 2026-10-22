-- T1: 택배 자동 접수 — 배송지(암호문만, D-T1-04)·접수 시도(살아 있는 시도 하나 — 부분 고유 색인, D-T1-11)·화면 요청 번호·설정 "택배"(D-T1-09).
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 표를 더하기만 해서 다른 트랙 마이그레이션과 순서가 상관없다(합칠 때 번호만 다시 매긴다).
CREATE TABLE "parcel_addresses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"sealed" text NOT NULL,
	"source" text NOT NULL,
	"confirmed" boolean NOT NULL,
	"confirmed_by" text,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text,
	CONSTRAINT "parcel_addresses_uq" UNIQUE("seller_id","date","buyer")
);
--> statement-breakpoint
CREATE TABLE "parcels" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"carrier" text NOT NULL,
	"request_key" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"invoice" text,
	"box" text NOT NULL,
	"qty" integer NOT NULL,
	"track" text,
	"tracked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone NOT NULL,
	"booked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "parcels_request_key_uq" UNIQUE("seller_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "parcel_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"date" text NOT NULL,
	"kind" text NOT NULL,
	"targets" text NOT NULL,
	"result" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "parcel_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "parcel_settings" (
	"seller_id" text PRIMARY KEY NOT NULL,
	"carrier" text,
	"customer_enc" text,
	"sender_enc" text,
	"box" text DEFAULT '소' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parcel_addresses" ADD CONSTRAINT "parcel_addresses_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_addresses" ADD CONSTRAINT "parcel_addresses_confirmed_by_accounts_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_addresses" ADD CONSTRAINT "parcel_addresses_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels" ADD CONSTRAINT "parcels_cancelled_by_accounts_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_requests" ADD CONSTRAINT "parcel_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_settings" ADD CONSTRAINT "parcel_settings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parcel_addresses_date_idx" ON "parcel_addresses" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "parcels_live_uq" ON "parcels" USING btree ("seller_id","date","buyer") WHERE state in ('PENDING', 'UNKNOWN', 'BOOKED');--> statement-breakpoint
CREATE INDEX "parcels_bundle_idx" ON "parcels" USING btree ("seller_id","date","buyer","created_at");--> statement-breakpoint
CREATE INDEX "parcels_track_idx" ON "parcels" USING btree ("state","booked_at");
