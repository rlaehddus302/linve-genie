-- 복구 계약 (RA-I2-001, D-RESTORE-LIVE-01): 같이 보는 라이브(live_joins)가 방송 표를 외래 키로 잡고 있어, 복구가 그 판매자의 방송을 지울 때 막혔다.
-- 같이 본 라이브 기록(live_join_visits)처럼 방송은 외래 키로 잇지 않는다 — 읽을 때 방송 표와 이어 보므로 없는 방송은 빠진다
ALTER TABLE "live_joins" DROP CONSTRAINT IF EXISTS "live_joins_broadcast_id_broadcasts_id_fk";
