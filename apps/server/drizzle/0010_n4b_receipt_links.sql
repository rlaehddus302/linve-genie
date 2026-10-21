-- N4b: 구매자 확인서 공유 링크(D-N4b-01·06)와 그 요청 번호. 토큰 원문은 두지 않는다(해시·암호화한 토큰만).
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다). 표를 더하기만 해서 다른 트랙 마이그레이션과 순서가 상관없다(합칠 때 번호만 다시 매긴다).
CREATE TABLE "receipt_links" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"date" text NOT NULL,
	"buyer" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "receipt_links_token_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "receipt_link_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"request_id" text NOT NULL,
	"date" text NOT NULL,
	"kind" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "receipt_link_requests_uq" UNIQUE("seller_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_revoked_by_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_link_requests" ADD CONSTRAINT "receipt_link_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_links_buyer_idx" ON "receipt_links" USING btree ("seller_id","date","buyer","created_at");
