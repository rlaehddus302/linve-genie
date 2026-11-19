-- 판매자가 적은 손님 연락처 (D-CONTACT-01): 같은 휴대폰 번호(엔진 전화번호 키)면 같은 손님 — 다음 주문에 성함·주소를 이어 쓴다. 연락처는 암호문만
CREATE TABLE IF NOT EXISTS "buyer_contacts" (
	"seller_id" text NOT NULL CONSTRAINT "buyer_contacts_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"id" text NOT NULL,
	"phone_key" text NOT NULL,
	"contact_enc" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "buyer_contacts_uq" UNIQUE ("seller_id", "phone_key"),
	CONSTRAINT "buyer_contacts_id_uq" UNIQUE ("seller_id", "id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_contacts_updated_idx" ON "buyer_contacts" USING btree ("updated_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buyer_contact_links" (
	"seller_id" text NOT NULL CONSTRAINT "buyer_contact_links_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"buyer_key" text NOT NULL,
	"phone_key" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "buyer_contact_links_uq" UNIQUE ("seller_id", "buyer_key")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buyer_contact_links_updated_idx" ON "buyer_contact_links" USING btree ("updated_at");
