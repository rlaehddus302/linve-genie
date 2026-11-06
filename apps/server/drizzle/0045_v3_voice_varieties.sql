-- D-V3-127 내 품종 장부: 판매자가 직접 적은 품종 이름(JSON 배열). 음성 사전 맨 앞·받아쓰기 힌트
CREATE TABLE IF NOT EXISTS "voice_varieties" (
	"seller_id" text PRIMARY KEY NOT NULL CONSTRAINT "voice_varieties_seller_id_sellers_id_fk" REFERENCES "sellers"("id"),
	"names" text DEFAULT '[]' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
