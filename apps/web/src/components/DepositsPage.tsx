// 입금 확인 `/deposits` (SPEC §7 화면 11, PAY-01, STL-07·09, DAT-06, D-N3-11, AC-N3-40~50).
// 목록 다섯: 확인 필요 · 자동 확인됨·확인함 · 무시함 · 붙여넣기 · 계좌 연동 — 보는 목록은 주소 검색값(새로고침·북마크해도 같은 화면).
// 입금 확인은 실제 범위만 다룬다(리허설 고르기가 없다, DP-0 4). 다른 기기의 처리는 실시간 알림으로 1초 안에 목록·수가 바뀐다.
import { useState } from 'react'
import type { DepositActionResult, DepositView } from '../api/deposit-types.ts'
import { DEPOSIT_STATUS_WORD } from '../lib/deposit-words.ts'
import { DEPOSIT_TABS, type DepositTab, type DepositsRoute, type Navigate } from '../lib/router.ts'
import { useDepositSignal, useDepositStore } from './deposit-context.tsx'
import {
  DepositDetailDialog,
  DepositRows,
  INFO_COLUMNS,
  ListFrame,
  NoticeLine,
  RevertDialog,
  appliedWords,
  depositLabel,
  useAction,
  useDepositList,
  type DepositColumn,
  type Notice,
  type RevertTarget,
} from './deposit-parts.tsx'
import { PasteTab } from './DepositPaste.tsx'
import { ReviewTab } from './DepositReview.tsx'
import { SourcesTab } from './DepositSources.tsx'
import { ErrorNote } from './ErrorNote.tsx'
import { BankNotices } from './BankNotices.tsx'

export const TAB_WORD: Readonly<Record<DepositTab, string>> = {
  review: '확인 필요',
  done: '자동 확인됨·확인함',
  ignored: '무시함',
  paste: '붙여넣기',
  sources: '계좌 연동',
}

export function DepositsPage({ route, navigate }: { readonly route: DepositsRoute; readonly navigate: Navigate }) {
  const signal = useDepositSignal()
  const [notice, setNotice] = useState<Notice | null>(null)
  const tab = route.tab
  const pick = (next: DepositTab) => {
    if (next === tab) return
    setNotice(null)
    navigate({ name: 'deposits', tab: next })
  }
  return (
    <main className="page page-wide deposits-page">
      <h1>입금 확인</h1>
      {/* 휴대폰 알림의 입금 취소·읽지 못한 은행 알림 (SMS3 AC-SMS3-23·32) */}
      <BankNotices onNotice={setNotice} />
      <div className="row deposit-tabs" role="tablist" aria-label="입금 확인 목록">
        {DEPOSIT_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`deposit-tab-${key}`}
            aria-selected={key === tab}
            aria-controls="deposit-panel"
            className="button deposit-tab"
            onClick={() => pick(key)}
          >
            {TAB_WORD[key]}
            {key === 'review' && signal.review !== null && signal.review > 0 ? ` ${String(signal.review)}` : ''}
          </button>
        ))}
      </div>
      <section id="deposit-panel" role="tabpanel" aria-labelledby={`deposit-tab-${tab}`} className="stack">
        <NoticeLine notice={notice} onClose={() => setNotice(null)} />
        {tab === 'review' ? <ReviewTab onNotice={setNotice} /> : null}
        {tab === 'done' ? <DoneTab onNotice={setNotice} /> : null}
        {tab === 'ignored' ? <IgnoredTab onNotice={setNotice} /> : null}
        {tab === 'paste' ? <PasteTab /> : null}
        {tab === 'sources' ? <SourcesTab /> : null}
      </section>
    </main>
  )
}

// ── 자동 확인됨·확인함 (AC-N3-44) ────────────────────────────────────────

function DoneTab({ onNotice }: { readonly onNotice: (notice: Notice | null) => void }) {
  const signal = useDepositSignal()
  const store = useDepositStore()
  const list = useDepositList(['AUTO_APPLIED', 'APPLIED'], [signal.tick])
  const [reverting, setReverting] = useState<RevertTarget | null>(null)
  const [detail, setDetail] = useState<number | null>(null)
  const columns: DepositColumn[] = [
    ...INFO_COLUMNS,
    {
      head: '반영한 묶음',
      cell: (deposit) => (deposit.applied === null ? '' : appliedWords(deposit.applied)),
    },
    {
      head: '상태',
      cell: (deposit) => <span className={`tag deposit-status deposit-${deposit.status}`}>{DEPOSIT_STATUS_WORD[deposit.status]}</span>,
    },
    {
      head: '처리',
      bare: true,
      cell: (deposit) => (
        <div className="row deposit-actions" role="group" aria-label={`${depositLabel(deposit.no)} 처리`}>
          <button type="button" className="button" disabled={deposit.applied === null} onClick={() => setReverting(revertTarget(deposit))}>
            되돌리기
          </button>
          <button type="button" className="button" onClick={() => setDetail(deposit.no)}>
            자세히
          </button>
        </div>
      ),
    },
  ]
  return (
    <>
      <ListFrame list={list} empty="자동 확인했거나 확인한 입금이 없어요.">
        <DepositRows label="자동 확인됨·확인함 입금" deposits={list.deposits} columns={columns} />
      </ListFrame>
      {reverting !== null ? (
        <RevertDialog
          target={reverting}
          onClose={() => setReverting(null)}
          onDone={() => {
            const no = reverting.no
            setReverting(null)
            onNotice({ text: `${depositLabel(no)}: 되돌렸어요. 같은 금액의 환불 기록을 적었고 이 입금은 확인 필요로 돌아갔어요.`, tone: 'success' })
            void list.reload()
            void store?.refreshCount()
          }}
        />
      ) : null}
      {detail !== null ? <DepositDetailDialog no={detail} onClose={() => setDetail(null)} /> : null}
    </>
  )
}

function revertTarget(deposit: DepositView): RevertTarget | null {
  if (deposit.applied === null) return null
  return { no: deposit.no, buyerName: deposit.applied.buyerName, date: deposit.applied.date, amount: deposit.amount }
}

// ── 무시함 (AC-N3-44) ─────────────────────────────────────────────────────

function IgnoredTab({ onNotice }: { readonly onNotice: (notice: Notice | null) => void }) {
  const signal = useDepositSignal()
  const store = useDepositStore()
  const list = useDepositList(['IGNORED'], [signal.tick])
  const reopen = useAction()
  const [detail, setDetail] = useState<number | null>(null)
  const send = async (deposit: DepositView) => {
    const result = await reopen.run<DepositActionResult>(`/api/deposits/${String(deposit.no)}/reopen`)
    if (result === null) return
    onNotice({ text: `${depositLabel(deposit.no)}: 확인 필요로 옮겼어요.`, tone: 'success' })
    void list.reload()
    void store?.refreshCount()
  }
  const columns: DepositColumn[] = [
    ...INFO_COLUMNS,
    {
      head: '처리',
      bare: true,
      cell: (deposit) => (
        <div className="row deposit-actions" role="group" aria-label={`${depositLabel(deposit.no)} 처리`}>
          <button type="button" className="button" disabled={reopen.busy} onClick={() => void send(deposit)}>
            다시 확인 필요로
          </button>
          <button type="button" className="button" onClick={() => setDetail(deposit.no)}>
            자세히
          </button>
        </div>
      ),
    },
  ]
  return (
    <>
      {reopen.error !== null ? <ErrorNote error={reopen.error} /> : null}
      <ListFrame list={list} empty="무시한 입금이 없어요.">
        <DepositRows label="무시한 입금" deposits={list.deposits} columns={columns} />
      </ListFrame>
      {detail !== null ? <DepositDetailDialog no={detail} onClose={() => setDetail(null)} /> : null}
    </>
  )
}
