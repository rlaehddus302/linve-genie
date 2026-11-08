-- EP1 우체국 창구소포 간편사전접수 기록 (PARCEL_RULES PC-9, D-EP1-02): 묶음마다 많아야 한 줄 — 입력 완료(FILLED)·사전접수 완료(RECEIVED, 접수번호).
-- 다시 적용해도 되게(0038과 같음 — 마이그레이션 되감기 시험이 0019 뒤를 다시 적용한다) 외래 키를 표 안에 두고 IF NOT EXISTS로 만든다.
CREATE TABLE IF NOT EXISTS "parcel_epost" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL CONSTRAINT "parcel_epost_seller_id_sellers_id_fk" REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"state" text NOT NULL,
	"receipt_no" text,
	"filled_at" timestamp with time zone,
	"filled_by" text CONSTRAINT "parcel_epost_filled_by_accounts_id_fk" REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action,
	"received_at" timestamp with time zone,
	"received_by" text CONSTRAINT "parcel_epost_received_by_accounts_id_fk" REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "parcel_epost_uq" UNIQUE("seller_id","date","buyer")
);
