DROP TABLE live_catalog_members;
--> statement-breakpoint
CREATE TABLE live_catalog_backfill (video_id text PRIMARY KEY);
--> statement-breakpoint
INSERT INTO live_catalog_backfill(video_id)
SELECT l.video_id FROM youtube_links l JOIN broadcasts b ON b.id = l.broadcast_id
JOIN scopes s ON s.id = b.scope_id
WHERE l.unlinked_at IS NULL AND b.ended_at IS NULL AND NOT s.rehearsal
GROUP BY l.video_id HAVING count(DISTINCT l.broadcast_id) > 1;
