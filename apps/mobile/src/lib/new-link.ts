// 새 라이브의 잇기를 기다리지 않고 프린터 화면으로 (D-LINK-ASYNC-01, 사용자 "연결하기 버튼 누르면 딜레이 있는데 … 어차피 다음에 프린터 연결 화면으로 넘어가는데 비동기로 불러오면 안 돼?").
// 잇기는 서버가 유튜브 방송·채팅 페이지를 그때 다시 읽어 확인해(라이브인지·채팅을 받을 수 있는지·처음 잇는 채널인지) 1~3초 걸린다 — 없앨 수 없어 뒤로 미룬다.
// 링크 화면이 잇기를 여기 맡기고 프린터 화면을 열면, 프린터 화면은 잇기가 끝나야 방송 화면으로 가고, 못 이으면 링크 화면으로 돌아가 까닭(옮길까요·처음 채널·오류)을 본다.
import { JoinedLive } from '../screens/console/YoutubeSection.tsx'

/** ok 이음 · failed 못 이음(링크 화면이 까닭을 보인다) · joined 같이 보는 라이브에 들어감(앱 뿌리가 그 화면으로 옮긴다) */
export type NewLinkResult = 'ok' | 'failed' | 'joined'

const pending = new Map<string, Promise<NewLinkResult>>()

/** 방송 id의 잇기를 맡긴다 — 이으면 지운다. 못 이은 것은 남긴다(그 뒤에 열린 프린터 화면도 못 이은 것을 알아야 한다) */
export function trackNewLink(broadcastId: string, work: Promise<unknown>): void {
  const settled: Promise<NewLinkResult> = work.then(
    () => 'ok',
    (caught: unknown) => (caught instanceof JoinedLive ? 'joined' : 'failed'),
  )
  pending.set(broadcastId, settled)
  void settled.then((result) => {
    if (result === 'ok' && pending.get(broadcastId) === settled) pending.delete(broadcastId)
  })
}

/** 그 방송의 잇기 결과 — 맡긴 것이 없으면(이미 이었거나 다른 길로 왔다) 바로 ok */
export function newLinkSettled(broadcastId: string): Promise<NewLinkResult> {
  return pending.get(broadcastId) ?? Promise.resolve('ok')
}

/** 라이브 화면으로 들어간(시작한) 새 라이브 — 링크 화면이 사라질 때 이 회차의 연결은 끊지 않는다 (D-DRAFT-02) */
const started = new Set<string>()

/** 새 라이브를 라이브 화면으로 연다고 알린다 (프린터 화면 마침·라벨 단계 없이 바로 열기) */
export function markNewLiveStarted(broadcastId: string): void {
  started.add(broadcastId)
}

/** 라이브 화면으로 들어간 새 라이브인가 */
export function newLiveStarted(broadcastId: string): boolean {
  return started.has(broadcastId)
}

/** 시험용: 맡긴 잇기·시작 표시를 모두 지운다 (같은 방송 번호를 쓰는 다음 시험에 남지 않게) */
export function resetNewLinks(): void {
  pending.clear()
  started.clear()
}
