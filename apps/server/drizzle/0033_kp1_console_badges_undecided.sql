-- KP1 UX-KP1-006: 방송 화면에 손님 표시 — 아직 정하지 않음(null)과 켬·끔을 구별한다. src/db/schema.ts와 같아야 한다.
ALTER TABLE "ledger_settings" ALTER COLUMN "console_badges" DROP NOT NULL;
