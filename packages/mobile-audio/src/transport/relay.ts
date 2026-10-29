// RN 웹소켓 → 음성 엔진의 연결 함수(RelayConnect — packages/voice cloud.ts·livegenie.ts와 같은 모양) (APP-02, VOC-06 연결).
// 웹의 livegenie-link가 브라우저 WebSocket으로 하는 일을 RN WebSocket으로 한다. 엔진(다시 잇기 1·2·4·8초, 60초 안 6번째 멈춤, ready·result·closing)은
// packages/voice의 LiveGenieSpeechEngine 그대로 — 이 파일은 소켓을 열고 닫고 글 틀을 넘기기만 한다.
// 주소·쿠키는 부르는 쪽(앱)이 정한다. 이 파일에는 받아쓰기 서버 주소·토큰이 없다(D-APP-04). 머리글 값은 기록하지 않는다.

/** 엔진이 연결에서 받는 알림 (packages/voice RelayHandlers와 같다) */
export interface RelayHandlers {
  onMessage(data: unknown): void
  onClose(): void
  onError(): void
}
/** 엔진이 쓰는 연결 (packages/voice RelayConnection과 같다) */
export interface RelayConnection {
  send(data: ArrayBuffer | ArrayBufferView | string): void
  close(): void
}
export type RelayConnect = (handlers: RelayHandlers) => RelayConnection

/** RN·브라우저 WebSocket에서 쓰는 부분 */
export interface WebSocketLike {
  binaryType?: string
  readyState: number
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: ArrayBuffer | ArrayBufferView | string): void
  close(code?: number, reason?: string): void
}
export const WS_OPEN = 1

/** 소켓 만들기 — RN은 세 번째 인자로 머리글(쿠키)을 받는다: new WebSocket(url, null, { headers }) */
export type WebSocketFactory = (url: string, headers: Readonly<Record<string, string>> | undefined) => WebSocketLike

type RnWebSocketCtor = new (url: string, protocols?: string | string[] | null, options?: { headers?: Record<string, string> }) => WebSocketLike

/** 전역 WebSocket으로 소켓을 만든다 (없으면 예외 — 부르는 쪽이 UNSUPPORTED로 안내) */
export const defaultWebSocketFactory: WebSocketFactory = (url, headers) => {
  const Ctor = (globalThis as { WebSocket?: RnWebSocketCtor }).WebSocket
  if (typeof Ctor !== 'function') throw new Error('이 기기에서는 웹소켓을 쓸 수 없어요')
  return headers === undefined ? new Ctor(url) : new Ctor(url, null, { headers })
}

export interface RelayOptions {
  /** 음성 웹소켓 주소 (앱이 packages/voice voiceStreamUrl로 만든 것). 함수면 열 때마다 부른다 */
  readonly url: string | (() => string)
  /** 열 때 붙일 머리글 (예: 로그인 세션 쿠키 — RN 웹소켓은 웹뷰·브라우저와 쿠키 저장소가 다를 수 있어 앱이 넘긴다). 함수면 열 때마다 부른다 */
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>> | undefined)
  readonly factory?: WebSocketFactory
}

/** ArrayBufferView → 딱 맞는 ArrayBuffer (RN 웹소켓은 offset 있는 view를 그대로 보내면 버퍼 전체가 갈 수 있다) */
export function tightBuffer(chunk: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (chunk instanceof ArrayBuffer) return chunk
  if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength && chunk.buffer instanceof ArrayBuffer) return chunk.buffer
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice().buffer
}

/**
 * 음성 웹소켓 연결 함수. 글 틀만 엔진에 넘기고(이진 틀은 버림), 열리기 전·닫힌 뒤의 send는 조용히 버린다
 * (엔진은 ready 뒤에만 보내므로 보통 일어나지 않는다 — 끊긴 동안 소리는 버린다, D-APP-05).
 */
export function createRelayConnect(options: RelayOptions): RelayConnect {
  const factory = options.factory ?? defaultWebSocketFactory
  return (handlers) => {
    const url = typeof options.url === 'function' ? options.url() : options.url
    const headers = typeof options.headers === 'function' ? options.headers() : options.headers
    let socket: WebSocketLike | null = factory(url, headers)
    let open = false
    let ended = false
    const finish = (how: 'close' | 'error'): void => {
      if (ended) return
      ended = true
      const s = socket
      socket = null
      if (s !== null) {
        s.onopen = null
        s.onmessage = null
        s.onclose = null
        s.onerror = null
      }
      if (how === 'error') handlers.onError()
      else handlers.onClose()
    }
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => {
      open = true
    }
    socket.onmessage = (event) => {
      if (ended) return
      const data = event.data
      if (typeof data === 'string') handlers.onMessage(data)
      // 이진 틀은 약속에 없다 — 무시
    }
    socket.onerror = () => finish('error')
    socket.onclose = () => finish('close')
    return {
      send(data) {
        const s = socket
        if (s === null || ended || !open || s.readyState !== WS_OPEN) return
        if (typeof data === 'string') s.send(data)
        else s.send(tightBuffer(data))
      },
      close() {
        const s = socket
        if (s === null || ended) return
        ended = true
        socket = null
        s.onopen = null
        s.onmessage = null
        s.onclose = null
        s.onerror = null
        try {
          s.close()
        } catch {
          // 이미 닫힌 소켓 — 무시
        }
      },
    }
  }
}
