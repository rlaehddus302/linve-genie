// 서비스 워커 (UX-07, AC-S06-51, D-093). 빌드할 때(vite.config.ts의 PWA 플러그인) 그 빌드의 앱 껍데기 목록으로 /sw.js를 만든다.
// - 저장하는 것: 그 빌드의 index.html과 해시가 붙은 정적 파일, 매니페스트·아이콘(shell.files)뿐. 판매 데이터는 저장하지 않는다.
// - /api/로 시작하는 요청(SSE 포함)과 다른 출처 요청, GET이 아닌 요청은 가로채지 않는다 — 쓰기를 쌓아 두었다 다시 보내지 않는다.
// - 구매자 확인서 링크 `/r`·`/r/…`(서버가 그리는 문서·그림·PDF, N4b AC-N4b-25)도 가로채지도 저장하지도 않는다 —
//   앱을 설치한 브라우저에서 링크를 열어도 index.html이 아니라 서버 문서가 나온다.
// - 페이지 이동은 네트워크 먼저, 끊겼을 때만 저장한 index.html. 껍데기 파일은 저장한 것 먼저(주소로 찾는다 — Vary 무시).
// - 새 버전은 기다렸다가 다음에 열 때 바뀐다(skipWaiting은 화면이 "지금 새로고침"으로 보낸 SKIP_WAITING 메시지에만). clients.claim()을 하지 않는다.
// serviceWorkerMain은 브라우저 서비스 워커 안에서 그 글자 그대로 돈다 — 바깥 이름을 쓰지 않는다(함수 안에서 모두 정한다).

export interface ShellManifest {
  /** 빌드 내용의 해시 (바뀌면 sw.js 글자가 바뀌어 브라우저가 새 버전을 받는다) */
  readonly version: string
  /** 저장할 주소 ('/index.html', '/assets/…', '/manifest.webmanifest', '/icons/…') */
  readonly files: readonly string[]
}

export interface SwExtendableEvent {
  waitUntil(promise: Promise<unknown>): void
}

export interface SwFetchEvent {
  readonly request: Request
  respondWith(response: Promise<Response> | Response): void
}

export interface SwMessageEvent {
  readonly data: unknown
}

export interface SwCache {
  addAll(requests: string[]): Promise<void>
  match(request: Request | string, options?: { ignoreVary?: boolean }): Promise<Response | undefined>
}

export interface SwScope {
  readonly location: { readonly origin: string }
  readonly caches: {
    open(name: string): Promise<SwCache>
    keys(): Promise<string[]>
    delete(name: string): Promise<boolean>
  }
  fetch(request: Request): Promise<Response>
  skipWaiting(): Promise<void>
  addEventListener(type: string, listener: (event: never) => void): void
}

/** 서비스 워커 본문 */
export function serviceWorkerMain(scope: SwScope, shell: ShellManifest): void {
  const prefix = 'livejjim-shell-'
  const cacheName = prefix + shell.version
  const files = new Set(shell.files)

  scope.addEventListener('install', (event: SwExtendableEvent) => {
    event.waitUntil(scope.caches.open(cacheName).then((cache) => cache.addAll([...shell.files])))
  })

  scope.addEventListener('activate', (event: SwExtendableEvent) => {
    event.waitUntil(
      scope.caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName).map((key) => scope.caches.delete(key)))),
    )
  })

  scope.addEventListener('message', (event: SwMessageEvent) => {
    const data = event.data
    if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'SKIP_WAITING') void scope.skipWaiting()
  })

  scope.addEventListener('fetch', (event: SwFetchEvent) => {
    const request = event.request
    if (request.method !== 'GET') return
    const url = new URL(request.url)
    // 다른 출처·/api/(SSE 포함)는 가로채지 않는다 — 브라우저가 그대로 보낸다
    if (url.origin !== scope.location.origin) return
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return
    // 구매자 확인서 링크(서버 문서) — 끊겨도 앱 껍데기를 대신 주지 않는다 (AC-N4b-25)
    if (url.pathname === '/r' || url.pathname.startsWith('/r/')) return
    if (request.mode === 'navigate') {
      event.respondWith(
        scope.fetch(request).catch(() =>
          scope.caches
            .open(cacheName)
            .then((cache) => cache.match('/index.html', { ignoreVary: true }))
            .then((hit) => hit ?? Response.error()),
        ),
      )
      return
    }
    if (!files.has(url.pathname)) return
    event.respondWith(
      scope.caches
        .open(cacheName)
        // crossorigin 스크립트·스타일은 Origin 머리가 붙어 저장할 때와 다르다 — 응답의 Vary를 보지 않고 주소로 찾는다
        .then((cache) => cache.match(request.url, { ignoreVary: true }))
        .then((hit) => hit ?? scope.fetch(request)),
    )
  })
}

/** /sw.js 글자 */
export function serviceWorkerSource(shell: ShellManifest): string {
  return [
    '// 라이브찜 서비스 워커 — 빌드할 때 만든다(apps/web/pwa/service-worker.ts). 앱 껍데기만 저장하고 /api/·/r/는 가로채지 않는다(D-093, AC-N4b-25).',
    `(${serviceWorkerMain.toString()})(self, ${JSON.stringify({ version: shell.version, files: [...shell.files] })});`,
    '',
  ].join('\n')
}
