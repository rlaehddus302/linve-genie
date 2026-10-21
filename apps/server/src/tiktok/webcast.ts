// 웹캐스트 클라이언트 경계 (D-N2b-1-07, AC-N2b-1-60). 연결 관리·거르개는 이 경계 위에서 돈다 — 실제 연결기(library.ts)와 가짜 웹캐스트(fake.ts)는
// 클라이언트를 만드는 곳만 다르다. 경계의 모양은 tiktok-live-connector 2.1.0의 TikTokLiveConnection 중 쓰는 부분과 같다:
// connect()·disconnect()·on(이벤트) — 이벤트 이름과 자료 모양도 라이브러리와 같다(chat 자료 = WebcastChatMessage).
// 글을 올리는 조작은 경계에 없다(읽기 전용, D-904).
import type { TikTokLibraryOptions } from './settings.ts'

/** 연결 관리가 듣는 라이브러리 이벤트 이름. 그 밖의 이벤트(선물·좋아요·입장·팔로우·공유·이모트·시청자 수·대결 등)는 듣지 않는다 */
export const WEBCAST_EVENTS = Object.freeze({
  CHAT: 'chat',
  DISCONNECTED: 'disconnected',
  STREAM_END: 'streamEnd',
  ERROR: 'error',
} as const)

export interface WebcastClient {
  /** 연결한다. 성공하면 이행, 실패하면 거부(거부 값은 classifyWebcastFailure가 실패 종류로 바꾼다) */
  connect(): Promise<unknown>
  /**
   * 닫는다. 어느 때든 부를 수 있고 여러 번 불러도 된다. 연결 시도 중이면 그 시도를 버린다 —
   * 늦게 성공해도 열린 채로 두지 않는다(연결 관리도 늦은 성공을 다시 닫는다).
   */
  disconnect(): unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** 클라이언트를 만든다: (연결할 틱톡 아이디, 라이브러리 옵션) */
export type WebcastFactory = (uniqueId: string, options: TikTokLibraryOptions) => WebcastClient
