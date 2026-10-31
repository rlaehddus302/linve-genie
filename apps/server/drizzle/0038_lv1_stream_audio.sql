-- LV1 방송 소리로 듣기 (D-LV1-03): 판매자 설정, 기본 켬
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "stream_audio" boolean DEFAULT true NOT NULL;
