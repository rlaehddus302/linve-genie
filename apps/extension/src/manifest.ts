// 매니페스트 (X1 YT-10 AC1·AC10, D-X1-02·D-X1-14). build.mjs가 이 함수로 dist/manifest.json을 쓴다.
// - MV3. host 권한은 https://www.youtube.com/* 과 라이브지니 주소 하나. 그 밖의 권한은 storage 하나.
// - content script는 live_chat 페이지(팝아웃·시청 페이지 안 iframe — all_frames)만, live_chat_replay는 빼고.
// - 페이지 쪽 스크립트(world MAIN)는 채널 ID·게시 시각만 붙여 주는 작은 다리(page-bridge.ts).

const CHAT_MATCHES = ['https://www.youtube.com/live_chat*']
const CHAT_EXCLUDES = ['https://www.youtube.com/live_chat_replay*']

/** 라이브지니 주소 → host 권한 패턴 (http(s)://호스트[:포트]/*) */
export function originPattern(origin: string, prod = false): string {
  const url = new URL(origin)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`라이브지니 주소는 http(s)여야 한다: ${origin}`)
  // 배포 빌드는 https만 (localhost도 안 됨 — RA-X1-05·AC-X1-33)
  if (prod && url.protocol !== 'https:') throw new Error(`배포 빌드의 라이브지니 주소는 https여야 한다: ${origin}`)
  if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error(`운영 주소는 https여야 한다: ${origin}`)
  return `${url.protocol}//${url.host}/*`
}

export function buildManifest(origin: string, version: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: '라이브지니 채팅 받기',
    short_name: '라이브지니',
    description: '내 유튜브 라이브 채팅을 읽어 라이브지니로 보내요. 설정에서 켠 경우에만 라이브지니가 만든 감사 글을 내 채팅에 올려요.',
    version,
    minimum_chrome_version: '111',
    permissions: ['storage'],
    host_permissions: ['https://www.youtube.com/*', originPattern(origin)],
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html', default_title: '라이브지니' },
    content_scripts: [
      { matches: CHAT_MATCHES, exclude_matches: CHAT_EXCLUDES, js: ['page.js'], run_at: 'document_start', all_frames: true, world: 'MAIN' },
      { matches: CHAT_MATCHES, exclude_matches: CHAT_EXCLUDES, js: ['content.js'], run_at: 'document_idle', all_frames: true },
    ],
  }
}
