// 실시간 안내 (AC-S05-62, AC-S06-41·61): 끊김과 "최신으로 맞추지 못함"은 화면 위 고정 영역 안에 둔다 — 끝까지 내려도 보인다.
import type { ConsoleSnapshot } from '../lib/console-store.ts'

export const CONNECTION_LOST = '실시간 연결이 끊겼어요. 다시 연결하는 중이에요.'
export const STALE_MESSAGE = '화면을 최신으로 맞추지 못했어요. 다시 시도하는 중이에요.'

export function LiveNotices({ snapshot, onRetry }: { readonly snapshot: Pick<ConsoleSnapshot, 'connection' | 'stale'>; readonly onRetry: () => void }) {
  return (
    <>
      {snapshot.connection === 'lost' ? (
        <p className="connection-banner" role="alert" data-tone="danger">
          {CONNECTION_LOST}
        </p>
      ) : null}
      {snapshot.stale ? (
        <div className="connection-banner stale-banner" role="alert" data-tone="danger">
          <span>{STALE_MESSAGE}</span>
          <button type="button" className="button" onClick={onRetry}>
            지금 다시 불러오기
          </button>
        </div>
      ) : null}
    </>
  )
}
