-- N4a: 라벨 기능 켬/끔 (SPEC RCP-01, LABEL_RULES L-12, D-N4a-01) — 지금 값과 바꾼 기록. src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
-- 지금 값은 판매자의 출력 대기열 줄에 둔다: 출력 기록을 바꾸는 트랜잭션이 모두 먼저 잠그는 줄이라, 켬/끔을 바꾸는 요청과 이벤트 기록·출력 요청이 같은 잠금으로 한 줄씩 처리된다.
-- 기본 켬(줄이 없거나 이 칸이 생기기 전의 줄도 켬). 판매 규칙 설정(sellers.settings)에는 넣지 않는다 — 방송 스냅샷·엔진 입력이 아니다.
-- 바꾼 기록은 지우지 않는다(지우는 API가 없다). 발송함(outbox) 표는 바꾸지 않는다.
ALTER TABLE "print_queues" ADD COLUMN "labels_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE "label_switches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"account_id" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_switches" ADD CONSTRAINT "label_switches_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_switches" ADD CONSTRAINT "label_switches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_switches_seller_idx" ON "label_switches" USING btree ("seller_id","id");
