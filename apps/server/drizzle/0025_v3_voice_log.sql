-- V3: 음성 등록·고침 기록 (R-25, D-V3-65) — 음성으로 일어난 등록·가격 고침·품종 고침·번호 옮기기·되돌리기를 한 줄씩.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 더하기만 한다.
CREATE TABLE "voice_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"date" text NOT NULL,
	"rehearsal" boolean NOT NULL,
	"broadcast_id" text NOT NULL,
	"product_id" text,
	"no" integer NOT NULL,
	"to_no" integer,
	"before" text,
	"after" text,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"account_id" text,
	"device" text,
	"claims" integer NOT NULL,
	"heard" text NOT NULL,
	"big" boolean NOT NULL,
	"with_claims" boolean NOT NULL,
	"undone" boolean DEFAULT false NOT NULL,
	"undo_of" text,
	"failed" boolean NOT NULL,
	CONSTRAINT "voice_log_uq" UNIQUE("seller_id","request_id","kind")
);
--> statement-breakpoint
ALTER TABLE "voice_log" ADD CONSTRAINT "voice_log_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_log_date_idx" ON "voice_log" USING btree ("seller_id","date","at");--> statement-breakpoint
CREATE INDEX "voice_log_broadcast_idx" ON "voice_log" USING btree ("seller_id","broadcast_id","at");
