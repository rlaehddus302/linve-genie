-- 같이 본 라이브 옛 기록 되살리기 (D-SHARE-LIVE-02): live_joins는 계정마다 한 줄이라 앞서 같이 본 라이브가 덮였다(11.18 보스다육 → 비트다육).
-- 같이 보는 동안 계정이 손으로 남긴 기록(다른 가게 범위에 이 계정 이름으로 쓴 이벤트, 계정 사이 동기화·화면 일꾼 제외)으로 들어갔던 라이브를 찾아 남긴다. 덧붙이기만
INSERT INTO "live_join_visits" ("account_id", "broadcast_id", "home_seller_id", "owner_seller_id", "joined_at")
SELECT e.account_id, b.id AS broadcast_id, a.seller_id AS home_seller_id, s.seller_id AS owner_seller_id, min(e.received_at) AS joined_at
FROM events e
JOIN scopes s ON s.id = e.scope_id AND NOT s.rehearsal
JOIN accounts a ON a.id = e.account_id AND a.seller_id <> s.seller_id
JOIN broadcasts b ON b.seller_id = s.seller_id AND b.scope_id = s.id AND b.id = (e.body::json ->> 'b')
WHERE e.account_id IS NOT NULL AND e.actor = 'account' AND (e.request_id IS NULL OR (e.request_id NOT LIKE 'catalog-%' AND e.request_id NOT LIKE 'screen-%'))
GROUP BY 1, 2, 3, 4
ON CONFLICT DO NOTHING;
