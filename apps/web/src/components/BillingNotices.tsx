// 요금 알림 띠·새 방송 시작 미리 보기 (N5, BL-9 1·2, AC-N5-56·57). 홈과 요금 화면에만 둔다 —
// 라이브 콘솔·문자찜 입력·구매자·정산·라벨 화면에는 요금 알림 띠·창·소리가 없다(방송 중 소진에도, D-N5-03).
// 문장은 서버 요금 상태의 값을 낱말로만 바꾼다(화면이 이용 방식을 다시 계산하지 않는다 — BL-4 6).
import type { MouseEvent } from 'react'
import type { Banner, StartPreview } from '../api/billing-types.ts'
import { OPEN_BILLING, bannerSentence, bannerTone, startSentence } from '../lib/billing-words.ts'
import { routePath, type Navigate } from '../lib/router.ts'

/** "요금 화면 열기" — 요금 화면으로 가는 링크 (왼쪽 단추만 화면 안에서 연다) */
export function OpenBillingLink({ navigate }: { readonly navigate: Navigate }) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate({ name: 'billing' })
  }
  return (
    <a className="button" href={routePath({ name: 'billing' })} onClick={go}>
      {OPEN_BILLING}
    </a>
  )
}

/** 알림 띠 (BL-9 1). navigate가 있으면(홈) "요금 화면 열기"를 하나 둔다 */
export function BillingBanners({ banners, navigate }: { readonly banners: readonly Banner[]; readonly navigate?: Navigate }) {
  if (banners.length === 0) return null
  return (
    <section className="billing-banners stack-tight" aria-label="요금 알림">
      <ul className="plain-list stack-tight">
        {banners.map((banner) => (
          <li key={banner.kind} className="billing-banner" data-tone={bannerTone(banner)}>
            {bannerSentence(banner)}
          </li>
        ))}
      </ul>
      {navigate !== undefined ? (
        <div className="row">
          <OpenBillingLink navigate={navigate} />
        </div>
      ) : null}
    </section>
  )
}

/**
 * 홈의 새 방송 시작 미리 보기 (BL-9 2): 지금 실제 방송을 시작하면 무엇으로 시작하는지. 이용권이 없으면 BL-4 1.5 문장 + "요금 화면 열기".
 * 서버가 시작을 거절했으면(미리 보기가 늦었을 수 있다) 그 문장을 대신 보인다 — 같은 자리 하나에만 (rejected).
 */
export function StartPreviewNote({ start, rejected, navigate }: { readonly start: StartPreview | null; readonly rejected: string | null; readonly navigate: Navigate }) {
  if (rejected !== null) {
    return (
      <div className="billing-start stack-tight" role="alert" data-tone="danger">
        <p>{rejected}</p>
        <div className="row">
          <OpenBillingLink navigate={navigate} />
        </div>
      </div>
    )
  }
  if (start === null) return null
  return (
    <div className="billing-start stack-tight" role="status" aria-label="새 방송 요금" data-tone={start.allowed ? 'info' : 'danger'}>
      <p>{startSentence(start)}</p>
      {start.allowed ? null : (
        <div className="row">
          <OpenBillingLink navigate={navigate} />
        </div>
      )}
    </div>
  )
}
