-- 손님 패스 횟수 (D-PASS-01): 보관 행에 판매자 쪽 조치(손님 패스 사유가 아닌 방송자 취소·무효)로 끝난 찜 수. 옛 행은 0 — 그날 취소를 모두 손님 패스로 센다
ALTER TABLE "customer_archive_rows" ADD COLUMN IF NOT EXISTS "mine" integer DEFAULT 0 NOT NULL;
