-- 같이 보는 라이브 (D-SHARE-LIVE-01): 다른 판매자 계정이 이미 이어 둔 라이브를 이으면 그 방송에 들어간다. 계정마다 한 줄
CREATE TABLE IF NOT EXISTS "live_joins" (
	"account_id" text PRIMARY KEY NOT NULL CONSTRAINT "live_joins_account_id_accounts_id_fk" REFERENCES "accounts"("id"),
	"home_seller_id" text NOT NULL CONSTRAINT "live_joins_home_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"owner_seller_id" text NOT NULL CONSTRAINT "live_joins_owner_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"broadcast_id" text NOT NULL CONSTRAINT "live_joins_broadcast_id_broadcasts_id_fk" REFERENCES "broadcasts"("id"),
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_joins_broadcast_idx" ON "live_joins" USING btree ("broadcast_id");
