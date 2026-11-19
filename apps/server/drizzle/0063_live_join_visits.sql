-- 같이 본 라이브 기록 (D-SHARE-LIVE-02): 계정마다 들어간 라이브를 하나씩 남긴다(live_joins는 지금 한 줄이라 덮인다). 지금 들어가 있는 줄도 옮겨 둔다
CREATE TABLE IF NOT EXISTS "live_join_visits" (
	"account_id" text NOT NULL CONSTRAINT "live_join_visits_account_id_accounts_id_fk" REFERENCES "accounts"("id"),
	"broadcast_id" text NOT NULL,
	"home_seller_id" text NOT NULL CONSTRAINT "live_join_visits_home_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"owner_seller_id" text NOT NULL CONSTRAINT "live_join_visits_owner_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_join_visits_uq" UNIQUE("account_id","broadcast_id")
);--> statement-breakpoint
INSERT INTO "live_join_visits" ("account_id", "broadcast_id", "home_seller_id", "owner_seller_id", "joined_at")
SELECT "account_id", "broadcast_id", "home_seller_id", "owner_seller_id", "joined_at" FROM "live_joins"
ON CONFLICT DO NOTHING;
