// 음성 웹소켓 표 (VOC-06 연결, D-APP-04): 앱은 라이브지니 서버의 음성 웹소켓 주소와 짧은 표만 받아 네이티브 모듈에 넘긴다.
// 받아쓰기 서버 주소·토큰은 서버만 안다. 서버 입구는 APP1(dev-server)이 낸다 — TODO(APP1 server): `POST /api/voice/ticket { b }` →
// `{ wsUrl, token }`. 아직 없으면(404) 개발용 가짜 값을 돌려준다(가짜 마이크 모듈과 짝).
import { absoluteUrl } from './config.ts'
import { isApiError, post } from './client.ts'

export interface VoiceTicket {
  readonly wsUrl: string
  readonly token: string
}

/** 서버가 흐름을 거절한 문장 (D-APP-10: 다른 기기에서 듣는 중·바쁨·꺼짐) — 서버 문장 그대로 보인다 */
export class VoiceRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoiceRefused'
  }
}

export async function fetchVoiceTicket(broadcastId: string): Promise<VoiceTicket> {
  try {
    return await post<VoiceTicket>('/api/voice/ticket', { b: broadcastId })
  } catch (error) {
    if (!isApiError(error)) throw error
    if (error.status === 404) {
      // TODO(APP1 server): 입구가 생기면 이 가짜 값을 지운다
      return { wsUrl: absoluteUrl('/api/voice/stream').replace(/^http/, 'ws'), token: 'dev-fake-ticket' }
    }
    if (error.status === 409 || error.status === 403 || error.status === 503) throw new VoiceRefused(error.message)
    throw error
  }
}
