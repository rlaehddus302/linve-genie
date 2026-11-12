-- 같은 영상에서 상품을 함께 관리하도록 연결된 가게. 주문·계정 접근 권한은 공유하지 않는다.
CREATE TABLE live_catalog_members (
  seller_id text NOT NULL REFERENCES sellers(id),
  broadcast_id text NOT NULL REFERENCES broadcasts(id),
  video_id text NOT NULL,
  team text NOT NULL,
  PRIMARY KEY (seller_id, broadcast_id, video_id)
);
--> statement-breakpoint
CREATE INDEX live_catalog_team_idx ON live_catalog_members (team, video_id);
--> statement-breakpoint
CREATE TABLE live_catalog_delivery (
  id bigserial PRIMARY KEY,
  seller_id text NOT NULL REFERENCES sellers(id),
  broadcast_id text NOT NULL REFERENCES broadcasts(id),
  scope_date text NOT NULL,
  body jsonb NOT NULL,
  done boolean NOT NULL DEFAULT false,
  problem text,
  lease_until timestamptz
);
--> statement-breakpoint
CREATE INDEX live_catalog_delivery_wait ON live_catalog_delivery (seller_id, broadcast_id, id) WHERE NOT done;
