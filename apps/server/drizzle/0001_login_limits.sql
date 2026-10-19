-- 로그인 시도 수를 있는 아이디·없는 아이디 모두 한 표에서 센다 (SA-S04-001·002, D-074). src/db/schema.ts와 같아야 한다.
-- 계정 행의 연속 실패·잠금 칸은 더 쓰지 않아 지운다 (S04 안에서 바꾼 것 — 운영 DB는 아직 없다).
CREATE TABLE "login_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_limits_updated_idx" ON "login_limits" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "failed_logins";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "locked_until";
