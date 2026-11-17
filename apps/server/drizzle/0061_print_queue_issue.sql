-- 라벨이 안 나가는 가장 최근 까닭 (D-ALERTFLOAT-01): 출력 기기 앱이 알린 실패 까닭 낱말(print.ts ATTEMPT_CAUSE_REASONS). 멈췄거나 프린터가 끊긴 동안만 둔다
ALTER TABLE "print_queues" ADD COLUMN IF NOT EXISTS "issue" text;
