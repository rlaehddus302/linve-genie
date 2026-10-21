// 실제 웹캐스트 연결기 감싸개 (D-904, D-N2b-1-01·06·07, AC-N2b-1-01~04). tiktok-live-connector를 import하는 파일은 모듈 안에서 이것 하나뿐이다.
// 라이브러리는 2.1.0(마지막 MIT 정식판)에 고정한다 — 2.4.0부터 AGPL-3.0이다. AGPL 판의 코드는 복사하거나 옮겨 적지 않는다.
// 넘기는 값은 (아이디, 허용 목록 옵션)뿐이다: 세션·쿠키·인증·프록시·머리글 덮어쓰기 옵션은 넘기지 않고, 글을 올리는 조작은 부르지 않는다.
// 이벤트 꺼내기·실패 종류 가르기는 가짜 웹캐스트와 같은 코드(comment.ts·failure.ts)가 한다. 여기는 클라이언트를 만드는 곳이다.
import { TikTokLiveConnection } from 'tiktok-live-connector'
import type { TikTokLibraryOptions } from './settings.ts'
import type { WebcastClient, WebcastFactory } from './webcast.ts'

/** 라이브러리 연결 객체 중 감싸개가 쓰는 부분 (2.1.0 TikTokLiveConnection) */
export interface LibraryConnectionLike {
  connect(): Promise<unknown>
  disconnect(): Promise<void> | void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** 라이브러리 생성자 모양 — 시험에서 바꿔 끼운다 (넘기는 값 확인, AC-N2b-1-03) */
export type LibraryConnectionConstructor = new (uniqueId: string, options: TikTokLibraryOptions) => LibraryConnectionLike

export interface LibraryWebcastOptions {
  /** 라이브러리 생성자 (기본: tiktok-live-connector 2.1.0 TikTokLiveConnection) */
  readonly Connection?: LibraryConnectionConstructor
}

const DEFAULT_CONNECTION = TikTokLiveConnection as unknown as LibraryConnectionConstructor

function quietly(run: () => unknown): void {
  try {
    const result = run()
    if (result instanceof Promise) result.catch(() => undefined)
  } catch {
    // 닫다 난 오류는 무시한다
  }
}

/**
 * 라이브러리 연결 하나를 경계 모양으로. 라이브러리는 연결 시도 중에 닫을 수 없다(disconnect는 연결된 뒤에만 닫는다) —
 * 그래서 닫은 뒤에 늦게 성공하면 여기서 바로 닫고, 닫은 뒤의 이벤트는 넘기지 않는다.
 */
function adapt(connection: LibraryConnectionLike): WebcastClient {
  let closed = false
  return {
    async connect() {
      const state = await connection.connect()
      if (closed) quietly(() => connection.disconnect())
      return state
    },
    disconnect() {
      closed = true
      quietly(() => connection.disconnect())
    },
    on(event, listener) {
      return connection.on(event, (...args: unknown[]) => {
        if (!closed) listener(...args)
      })
    },
  }
}

/** 실제 웹캐스트 클라이언트를 만드는 곳. 연결 시도마다 새 라이브러리 연결을 (아이디, 옵션)으로 만든다 */
export function libraryWebcast(options: LibraryWebcastOptions = {}): WebcastFactory {
  const Connection = options.Connection ?? DEFAULT_CONNECTION
  return (uniqueId, libraryOptions) => adapt(new Connection(uniqueId, libraryOptions))
}
