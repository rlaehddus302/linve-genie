-- V3: 판매자 품종 사전 (R-23, D-V3-49) — 주인 배지 채팅의 "N번[품종]₩가격"에서 배운 품종 이름. 판매자마다 이름 하나에 한 줄, 2,000줄까지.
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 더하기만 한다.
CREATE TABLE "seller_names" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"name" text NOT NULL,
	"learned_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "seller_names_uq" UNIQUE("seller_id","name")
);
--> statement-breakpoint
ALTER TABLE "seller_names" ADD CONSTRAINT "seller_names_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seller_names_seen_idx" ON "seller_names" USING btree ("seller_id","seen_at");
