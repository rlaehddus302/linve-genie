-- I2: 가게 설정(D-I2-02)·포장·배송 기록(D-I2-05)·복구로 다시 만든 발송함 표시(D-I2-11)·판매자마다의 방송 ID(가져오기, D-I2-11·12).
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 기존 행: 가게 설정은 빈 값, 발송함은 실행 대상 그대로(restored = false).
-- 방송 ID는 판매자 안에서만 유일하면 된다(조회는 늘 판매자 ID와 함께) — 다른 판매자로 기록을 가져와도 방송 ID가 부딪치지 않게 기본 키를 (판매자, 방송)으로 바꾼다.
ALTER TABLE "sellers" ADD COLUMN "shop" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "restored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_pkey";--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_pkey" PRIMARY KEY("seller_id","id");--> statement-breakpoint
CREATE TABLE "packing_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"kind" text NOT NULL,
	"items" text,
	"invoice" text,
	"account_id" text,
	"request_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "packing_request_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "packing_records" ADD CONSTRAINT "packing_records_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_records" ADD CONSTRAINT "packing_records_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_records" ADD CONSTRAINT "packing_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packing_scope_idx" ON "packing_records" USING btree ("seller_id","scope_id","id");
