-- UX4 라이브 연결 정보의 라이브 제목 (D-UX4-119): 이을 때 읽은 방송 제목을 남겨 연결 화면이 유튜브를 다시 읽지 않고 바로 보인다. 옛 기록은 비움. 다시 적용해도 되게 IF NOT EXISTS
ALTER TABLE "youtube_links" ADD COLUMN IF NOT EXISTS "broadcast_title" text;
