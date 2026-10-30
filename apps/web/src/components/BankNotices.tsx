// 입금 확인 화면 위 "은행 알림" 줄 (SMS3 PAY-02, DP-9 9, D-DEP2-06, AC-SMS3-23·32).
// - 입금 취소 알림: "입금 취소 알림이 왔어요: 14,000원 홍길동. 이 입금을 확인했다면 되돌려 주세요". 같은 금액·같은 이름의 확인한 입금이 있으면
//   그 입금의 "되돌리기" 단추 — 누르면 DP-6 되돌리기 확인 창(저절로 되돌리지 않는다).
// - 읽지 못한 알림: DP-8 문장 + 은행 이름·받은 시각(본문은 없다).
// - 줄마다 "확인했어요"로 닫는다(30일 뒤 사라지는 것은 서버). 입금 알림(`deposit` — `{ alerts: true }` 포함)·다시 붙음(판이 오른다)에 다시 읽는다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { DepositList, DepositView } from '../api/deposit-types.ts'
import type { BankAlertView } from '../api/inbox-types.ts'
import { formatWon } from '@livejjim/core'
import { BANK_NOTICE_CLOSE, BANK_NOTICE_TITLE, bankNoticeMeta, bankNoticeWords, cancelMatches, closeBankAlert, fetchBankAlerts } from '../lib/inbox.ts'
import { useDepositSignal, useDepositStore } from './deposit-context.tsx'
import { RevertDialog, depositLabel, type Notice, type RevertTarget } from './deposit-parts.tsx'
import { ErrorNote } from './ErrorNote.tsx'

export function BankNotices({ onNotice }: { readonly onNotice: (notice: Notice | null) => void }) {
  const signal = useDepositSignal()
  const store = useDepositStore()
  const [notices, setNotices] = useState<readonly BankAlertView[]>([])
  const [applied, setApplied] = useState<readonly DepositView[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [reverting, setReverting] = useState<RevertTarget | null>(null)
  const version = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++version.current
    try {
      const next = await fetchBankAlerts()
      if (mine !== version.current) return
      setNotices(next)
      // 입금 취소 알림이 있을 때만 확인한 입금을 받아 같은 금액·이름을 찾는다
      if (next.some((notice) => notice.kind === 'CANCEL')) {
        const list = await get<DepositList>(withQuery('/api/deposits', { status: 'AUTO_APPLIED,APPLIED', limit: 200 }))
        if (mine === version.current) setApplied(list.deposits)
      } else setApplied([])
    } catch (caught) {
      // 읽지 못하면 줄을 그리지 않는다(옛 서버는 404) — 입금 확인 목록은 그대로 쓸 수 있다
      if (!isApiError(caught)) throw caught
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, signal.tick])

  const close = async (notice: BankAlertView) => {
    if (busy !== null) return
    setBusy(notice.id)
    setError(null)
    try {
      await closeBankAlert(notice.id)
      setNotices((current) => current.filter((item) => item.id !== notice.id))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(null)
    }
  }

  if (notices.length === 0) return null
  return (
    <section className="card stack-tight bank-notices" aria-label={BANK_NOTICE_TITLE}>
      <h2 className="section-title">{BANK_NOTICE_TITLE}</h2>
      {error !== null ? <ErrorNote error={error} /> : null}
      <ul className="plain-list stack-tight">
        {notices.map((notice) => {
          const matches = cancelMatches(notice, applied)
          return (
            <li key={notice.id} className="bank-notice stack-tight" data-tone="warning">
              <p>
                <strong>! {bankNoticeWords(notice)}</strong>
              </p>
              <p className="hint">{bankNoticeMeta(notice)}</p>
              <div className="row">
                {matches.map((deposit) =>
                  deposit.applied === null ? null : (
                    <button
                      key={deposit.no}
                      type="button"
                      className="button"
                      onClick={() => setReverting({ no: deposit.no, buyerName: deposit.applied?.buyerName ?? '', date: deposit.applied?.date ?? '', amount: deposit.amount })}
                    >
                      {depositLabel(deposit.no)} ({formatWon(deposit.amount)}) 되돌리기
                    </button>
                  ),
                )}
                <button type="button" className="button" disabled={busy !== null} onClick={() => void close(notice)}>
                  {BANK_NOTICE_CLOSE}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {reverting !== null ? (
        <RevertDialog
          target={reverting}
          onClose={() => setReverting(null)}
          onDone={() => {
            const no = reverting.no
            setReverting(null)
            onNotice({ text: `${depositLabel(no)}: 되돌렸어요. 같은 금액의 환불 기록을 적었고 이 입금은 확인 필요로 돌아갔어요.`, tone: 'success' })
            void reload()
            void store?.refreshCount()
          }}
        />
      ) : null}
    </section>
  )
}
