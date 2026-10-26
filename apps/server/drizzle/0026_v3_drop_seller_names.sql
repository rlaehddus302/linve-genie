-- V3 D-V3-68: 판매자 채팅 품종 읽기(R-23)를 없애 판매자 품종 사전 표를 지운다(0024가 만든 표 — 쓰는 코드가 없다).
-- src/db/schema.ts와 같아야 한다(test/schema.test.ts가 대조한다).
DROP TABLE IF EXISTS "seller_names";
