-- 직접 넣은 택배 (D-UX3-38): 방송 판매 기록 없이 받는 분을 적어 접수하는 묶음. 배송지는 parcel_addresses(buyer = id), 시도는 parcels에
CREATE TABLE IF NOT EXISTS "parcel_extras" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "parcel_extras_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"date" text NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text CONSTRAINT "parcel_extras_created_by_accounts_id_fk" REFERENCES "accounts"("id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parcel_extras_seller_idx" ON "parcel_extras" USING btree ("seller_id", "date", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parcel_extras_date_idx" ON "parcel_extras" USING btree ("date");
