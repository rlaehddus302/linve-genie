-- FB1: 택배 크기 = 세 변의 합 코드(60·80·100·120·160)와 쓰는 택배사 직접 입력 이름 (PARCEL_RULES PC-1·PC-6, D-FB1-04·D-FB1-05).
-- 옛 낱말은 차례대로 하나씩 옮긴다(극소→60, 소→80, 중→100, 대→120) — 지우는 것은 없다. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
UPDATE "parcel_settings" SET "box" = CASE "box" WHEN '극소' THEN '60' WHEN '소' THEN '80' WHEN '중' THEN '100' WHEN '대' THEN '120' ELSE "box" END WHERE "box" IN ('극소', '소', '중', '대');
--> statement-breakpoint
UPDATE "parcels" SET "box" = CASE "box" WHEN '극소' THEN '60' WHEN '소' THEN '80' WHEN '중' THEN '100' WHEN '대' THEN '120' ELSE "box" END WHERE "box" IN ('극소', '소', '중', '대');
--> statement-breakpoint
ALTER TABLE "parcel_settings" ALTER COLUMN "box" SET DEFAULT '80';
--> statement-breakpoint
ALTER TABLE "parcel_settings" ADD COLUMN "carrier_name" text;
