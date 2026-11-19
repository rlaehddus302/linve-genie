// 같이 본 라이브 하나만 보기 (D-SHARE-LIVE-04) — 라이브 화면·목록이 함께 쓴다
import { currentLiveView, setLiveView } from '../api/client.ts'
import { clearCached } from './cached-get.ts'

/**
 * 같이 본 라이브 하나만 보기를 끝낸다 (D-SHARE-LIVE-04): 그 라이브 화면을 닫을 때, 또 홈·모두보기가 다시 보일 때(혹시 남았으면).
 * 그 라이브를 보는 동안 받은 자료는 방송 주인 가게 것이라 기억을 비운다 — 내 가게 화면에 섞이지 않게
 */
export function endLiveView(broadcastId?: string): void {
  const now = currentLiveView()
  if (now === null || (broadcastId !== undefined && now !== broadcastId)) return
  setLiveView(null)
  clearCached()
}
