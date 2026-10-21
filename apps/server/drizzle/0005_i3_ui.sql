-- I3: 보조자 계정(SYS-04)·시작 마법사 상태(UX-02)·발송함 정리(게시됨 확인·알림에서 빼기, YT-06) (AC-I3-36·50·60~62). src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 병렬 트랙과 번호가 겹치지 않게 이름에 트랙을 붙인다(합칠 때 번호 정리는 오케스트레이터 몫).
-- 계정: 역할(SELLER 판매자 · ASSISTANT 보조자), 보조자 이름(메모), 지운 시각(지워도 행은 남는다 — 이벤트의 조치자 기록이 이 행을 가리키고 같은 아이디를 다시 만들지 않는다)
ALTER TABLE "accounts" ADD COLUMN "role" text DEFAULT 'SELLER' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- 판매자: 시작 마법사 상태 (NEW 처음 · IN_PROGRESS 진행 중(단계 1~5) · DONE 마침 · DISMISSED 닫음). 이미 있는 판매자도 NEW — 화면은 실제 방송이 없을 때만 연다
ALTER TABLE "sellers" ADD COLUMN "wizard_status" text DEFAULT 'NEW' NOT NULL;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "wizard_step" integer;--> statement-breakpoint
-- 발송함: 판매자가 "유튜브에 올라가 있어요"로 적은 계정·요청 번호, "알림에서 빼기"의 시각·계정
ALTER TABLE "outbox" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "confirm_request_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "dismissed_by" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_confirm_request_uq" UNIQUE("seller_id","confirm_request_id");
