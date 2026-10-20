-- I2: 가게 설정(D-I2-02)·포장·배송 기록(D-I2-05)·복구로 다시 만든 발송함 표시(D-I2-11).
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 기존 행: 가게 설정은 빈 값, 발송함은 실행 대상 그대로(restored = false).
-- 기존 표의 키·제약은 바꾸지 않는다(RA-I2-002): broadcasts 기본 키는 전역 (id) 그대로 — 다른 트랙이 broadcasts(id)를 참조한다.
--   같은 서버의 다른 판매자로 가져올 때 방송 ID가 이미 있으면 복구 명령이 먼저 거절한다(아무것도 바꾸지 않음).
-- 합칠 때(오케스트레이터): 이 파일은 칸·표를 더하기만 해서 다른 트랙 마이그레이션과 순서가 상관없다 — I1 0003·Y1 0004·I3 0005 뒤 0006으로 번호를 다시 매겼다.
ALTER TABLE "sellers" ADD COLUMN "shop" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "restored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
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
