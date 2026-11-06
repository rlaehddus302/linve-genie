-- D-V3-130 음성 기록에 받아쓰기 모델 확신도(0~1, 없으면 null) — 애매함을 재려고
ALTER TABLE "voice_log" ADD COLUMN IF NOT EXISTS "conf" real;
