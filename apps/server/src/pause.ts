// 채팅·상품 인식 잠깐 멈춤 (D-PAUSE-01, SPEC R-1 "잠깐 멈춤").
// - 판정은 엔진이 한다: 멈춘 방송의 채팅은 받은 메시지로 기록만 하고 찜·취소를 만들지 않는다(입력 우선 기록 — 서버는 채팅을 버리지 않는다).
// - 서버는 멈춘 방송에 사람이 확인하지 않은 자동 입력을 넣지 않는다: 음성·화면 일꾼의 상품 등록·고침(거절), 휴대폰 문자함의 자동 문자찜(확인 필요 카드).
// - 판매자가 손으로 하는 입력(상품 등록·찜 넣기·문자찜 붙여넣기)은 막지 않는다.
import { getBroadcast, type EngineState } from '@livejjim/core'

/** 화면 문구 (쉬운 한국어) */
export const PAUSED_MESSAGE = '채팅·상품 인식을 잠깐 멈춘 라이브예요. 라이브 화면에서 다시 켜면 받아요.'

/** 그 방송이 지금 잠깐 멈춤인가 (설정 스냅샷 claim.paused) — 모르는 방송이면 아니다 */
export function isPausedBroadcast(state: EngineState, b: unknown): boolean {
  return typeof b === 'string' && getBroadcast(state, b)?.settings['claim.paused'] === true
}
