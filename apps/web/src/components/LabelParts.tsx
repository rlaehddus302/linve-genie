// 콘솔·정산의 라벨 조각 (LBL-02·03·07·09·11, L-10, L-11, D-I1-04·07·08·10, AC-I1-30~36·40~42).
// - 상품 자세히: 1등마다 미리 보기(지금 데이터 + 지금 템플릿 = 출력될 그림)·상태 낱말·이력·"라벨 출력"/"다시 출력"·그림 파일·공유·PDF, 지난 1등의 폐기 라벨.
// - Alt+P 창: 현재 상품의 1등 라벨 다시 출력(작업이 없으면 처음 출력) — 처음 포커스 "닫기", 1 = 출력.
// - 정산 자세히: 포장 라벨 쪽마다 미리 보기·"포장 라벨 출력"·그림 파일(쪽마다)·PDF·재출력 필요.
// - 리허설은 라벨이 없다: 그 자리에 "리허설 방송은 라벨을 출력하지 않아요."
// - 라벨 기능이 꺼져 있으면(N4a, L-13 9·10) 라벨 자리에 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."만 — 미리 보기·상태·이력·출력·그림 파일·PDF가 없다.
//   리허설은 그 문장도 없다(라벨 문장이 아예 없다). 켬/끔을 아직 모르면 라벨 자리를 비워 둔다(AC-N4a-18). 창이 열린 채 꺼지면 창은 그대로 두고 라벨 부분만 바꾼다.
// - 출력·다시 출력·포장 라벨은 엔진 기록이 아니어서 5초 대기 없이 바로 보낸다(같은 요청 번호로 재시도 — 서버는 한 번만 만든다).
import type { PackingLabelData, ProductLabelData } from '@livejjim/label'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isApiError, newRequestId, withRetry, type ApiError } from '../api/client.ts'
import type { JobView, LabelView } from '../api/print-types.ts'
import type { Claim, Product } from '../api/types.ts'
import { claimOptionWords, productSlots } from '../lib/derive.ts'
import { canShareFile, downloadBytes, shareBytes } from '../lib/label-files.ts'
import {
  labelErrorMessage,
  labelPdfBytes,
  packingPdfName,
  packingPngName,
  packingTemplateOf,
  pngBytes,
  productPdfName,
  productPngName,
  productTemplateOf,
  renderPacking,
  renderProduct,
} from '../lib/label-render.ts'
import { NO_WINNER_LABEL, PRINT_ACTION, REHEARSAL_NO_LABELS, historyWord } from '../lib/print-words.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { LabelImage } from './LabelImage.tsx'
import { Modal } from './Modal.tsx'
import { LabelsOffNote } from './LabelsOff.tsx'
import { FONT_ERROR, useLabelEnv, useLabelsEnabled, usePackingLabel, usePrintApi, usePrintState, type EnvState } from './print-context.tsx'

/** 1등 찜의 라벨 키 `<찜>@<확정버전>` */
export const labelKeyOf = (claim: Pick<Claim, 'id' | 'confirmVersion'>): string | null => (claim.confirmVersion === null ? null : `${claim.id}@${String(claim.confirmVersion)}`)

/** 상품 보드의 라벨 상태 낱말 (AC-I1-30): 1등마다 서버 라벨 키 상태, 작업이 없으면 낱말 없음 */
export function boardLabelWords(labels: ReadonlyMap<string, LabelView>, claims: ReadonlyMap<string, Claim>, product: Product): string[] {
  const words = new Set<string>()
  for (const id of productSlots(product).winnerClaims) {
    const claim = claims.get(id)
    if (claim === undefined) continue
    const key = labelKeyOf(claim)
    const word = key === null ? '' : (labels.get(key)?.word ?? '')
    if (word !== '') words.add(word)
  }
  return [...words]
}

const ACCEPTED_PRINT = '라벨 출력을 접수했어요.'
const ACCEPTED_REPRINT = '다시 출력을 접수했어요.'

/** 라벨 출력·다시 출력 보내기 (같은 요청 번호로 재시도) */
function useLabelRequest() {
  const api = usePrintApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const send = async (kind: 'print' | 'reprint', body: { b: string; claim: string; version?: number }, date: string): Promise<boolean> => {
    if (api === null || busy) return false
    setBusy(true)
    setError(null)
    setDone(null)
    const requestId = newRequestId()
    try {
      await withRetry(() => api.store.act<{ jobs: JobView[] }>(`/api/print/labels/${kind}`, { requestId, ...body }))
      setDone(kind === 'print' ? ACCEPTED_PRINT : ACCEPTED_REPRINT)
      api.store.refreshLabels(date)
      return true
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      api.store.refreshLabels(date)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, done, send }
}

/** 라벨 그림 저장·공유·PDF (내보내기는 출력함이 아니다 — 작업·엔진을 바꾸지 않는다, AC-I1-40) */
function useExport() {
  const [message, setMessage] = useState<string | null>(null)
  const share = useRef<boolean | null>(null)
  share.current ??= canShareFile()
  return { message, setMessage, canShare: share.current }
}

// ── 상품 자세히 (AC-I1-31) ────────────────────────────────────────────────

export interface ProductLabelsProps {
  readonly product: Product
  readonly winners: readonly Claim[]
  readonly labels: ReadonlyMap<string, LabelView>
  readonly rehearsal: boolean
  readonly date: string
  readonly nameOf: (claim: Claim) => string
}

export function ProductLabels({ product, winners, labels, rehearsal, date, nameOf }: ProductLabelsProps) {
  const env = useLabelEnv()
  const api = usePrintApi()
  const enabled = useLabelsEnabled()
  const store = api?.store ?? null
  // 라벨 상태에 없는 1등 라벨 키 (자동 출력을 끈 방송에서 채팅·문자찜으로 생긴 1등 — 작업이 없어 print 알림이 없다): 한 번 다시 받는다 (AC-I1-31)
  const missing = rehearsal || enabled !== true
    ? ''
    : winners
        .map((claim) => labelKeyOf(claim))
        .filter((key): key is string => key !== null && !labels.has(key))
        .join('\n')
  useEffect(() => {
    if (store === null || missing === '') return
    store.ensureLabels(date, missing.split('\n'))
    // labels: 처음 조회가 끝나 라벨 상태가 바뀌면 다시 본다 (저장소가 키마다 한 번만 다시 받는다)
  }, [store, date, missing, labels])
  if (enabled !== true) {
    // 모름·리허설: 라벨 자리를 비운다. 꺼짐: 라벨이 있던 자리에 안내 한 번 (AC-N4a-14)
    if (enabled === null || rehearsal) return null
    return (
      <section className="stack-tight" aria-label="라벨">
        <h3 className="sub-title">라벨</h3>
        <LabelsOffNote />
      </section>
    )
  }
  if (rehearsal) {
    return (
      <section className="stack-tight" aria-label="라벨">
        <h3 className="sub-title">라벨</h3>
        <p>{REHEARSAL_NO_LABELS}</p>
      </section>
    )
  }
  const voided = [...labels.values()].filter((label) => label.kind === 'product' && label.voided && label.broadcast === product.broadcast && label.no === product.no)
  return (
    <section className="stack-tight" aria-label="라벨">
      <h3 className="sub-title">라벨</h3>
      {winners.length === 0 ? <p>{NO_WINNER_LABEL}</p> : null}
      {winners.map((claim) => (
        <WinnerLabel key={claim.id} claim={claim} label={labelKeyOf(claim) === null ? undefined : labels.get(labelKeyOf(claim) as string)} env={env} date={date} name={nameOf(claim)} />
      ))}
      {voided.length > 0 ? (
        <ul className="plain-list" aria-label="폐기한 라벨">
          {voided.map((label) => (
            <li key={label.key}>
              지난 1등 라벨 · {label.buyer.kind === 'sms' ? '문자찜' : label.buyer.name} · <span className="tag tag-discard">{label.word}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function WinnerLabel({ claim, label, env, date, name }: { readonly claim: Claim; readonly label: LabelView | undefined; readonly env: EnvState; readonly date: string; readonly name: string }) {
  const print = usePrintState()
  const request = useLabelRequest()
  const exporter = useExport()
  const template = productTemplateOf(print.templates?.product.template)
  const data = (label?.data ?? null) as ProductLabelData | null
  const rendered = useMemo(() => (env.state !== 'ready' || data === null ? null : renderProduct(env.env, template, data)), [env, template, data])
  const canPrint = label === undefined ? true : label.canPrint
  const no = data?.no ?? claim.no
  const send = () =>
    void request.send(canPrint ? 'print' : 'reprint', { b: claim.broadcast, claim: claim.id, ...(canPrint || claim.confirmVersion === null ? {} : { version: claim.confirmVersion }) }, date)
  const savePng = async (share: boolean) => {
    if (rendered === null || !rendered.ok) return
    const png = pngBytes(rendered.image)
    if (!png.ok) {
      exporter.setMessage(png.message)
      return
    }
    if (share) await shareBytes(png.bytes, productPngName(date, no), 'image/png')
    else downloadBytes(png.bytes, productPngName(date, no), 'image/png')
  }
  const savePdf = () => {
    if (rendered === null || !rendered.ok) return
    const pdf = labelPdfBytes([rendered.image])
    if (!pdf.ok) exporter.setMessage(pdf.message)
    else downloadBytes(pdf.bytes, productPdfName(date, no), 'application/pdf')
  }
  return (
    <div className="label-box" role="group" aria-label={`1등 ${name}${claimOptionWords(claim)} 라벨`}>
      <p>
        {/* 옵션 상품은 같은 구매자의 두 변형 라벨이 있을 수 있다 — 옵션 글·수량으로 가린다 (D-O4-07) */}
        <strong>
          1등 {name}
          {claimOptionWords(claim)}
        </strong> {label !== undefined && label.word !== '' ? <span className={label.state === 'REPRINT_NEEDED' ? 'tag tag-alert' : 'tag'}>{label.word}</span> : <span className="hint">아직 라벨을 만들지 않았어요</span>}
      </p>
      {label !== undefined ? <p className="hint">{historyWord(label)}</p> : null}
      {env.state === 'error' ? <p className="field-error">{FONT_ERROR}</p> : null}
      {rendered !== null && !rendered.ok ? (
        <p className="field-error" role="alert">
          {labelErrorMessage(rendered.error)}
        </p>
      ) : null}
      {rendered !== null && rendered.ok ? <LabelImage image={rendered.image} label={`${String(no)}번 라벨 미리 보기`} framed /> : null}
      <div className="row">
        <button type="button" className="button button-primary" disabled={request.busy} onClick={send}>
          {canPrint ? PRINT_ACTION.print : PRINT_ACTION.reprint}
        </button>
        <button type="button" className="button" disabled={rendered === null || !rendered.ok} onClick={() => void savePng(false)}>
          그림 파일로 저장
        </button>
        {exporter.canShare ? (
          <button type="button" className="button" disabled={rendered === null || !rendered.ok} onClick={() => void savePng(true)}>
            공유
          </button>
        ) : null}
        <button type="button" className="button" disabled={rendered === null || !rendered.ok} onClick={savePdf}>
          PDF로 저장
        </button>
      </div>
      {request.done !== null ? <p role="status">{request.done}</p> : null}
      {request.error !== null ? <ErrorNote error={request.error} /> : null}
      {exporter.message !== null ? <p className="field-error">{exporter.message}</p> : null}
    </div>
  )
}

// ── Alt+P 창 (AC-I1-33) ───────────────────────────────────────────────────

export interface ReprintDialogProps {
  readonly product: Product | undefined
  readonly winners: readonly Claim[]
  readonly labels: ReadonlyMap<string, LabelView>
  readonly rehearsal: boolean
  readonly date: string
  readonly title: string
  readonly nameOf: (claim: Claim) => string
  readonly onClose: () => void
}

export function ReprintDialog({ product, winners, labels, rehearsal, date, title, nameOf, onClose }: ReprintDialogProps) {
  const request = useLabelRequest()
  const enabled = useLabelsEnabled()
  if (enabled !== true) {
    // 콘솔은 꺼져 있으면 이 창을 열지 않는다 — 열린 채 꺼지면 창은 그대로 두고 안내만 (포커스를 빼앗지 않는다, AC-N4a-18)
    return (
      <Modal title="라벨 다시 출력" onClose={onClose}>
        <LabelsOffNote />
      </Modal>
    )
  }
  if (rehearsal || product === undefined || winners.length === 0) {
    return (
      <Modal title="라벨 다시 출력" onClose={onClose}>
        <p>{rehearsal ? REHEARSAL_NO_LABELS : NO_WINNER_LABEL}</p>
      </Modal>
    )
  }
  const canPrintOf = (claim: Claim): boolean => {
    const key = labelKeyOf(claim)
    const label = key === null ? undefined : labels.get(key)
    return label === undefined ? true : label.canPrint
  }
  const send = (claim: Claim) => {
    const canPrint = canPrintOf(claim)
    void request.send(canPrint ? 'print' : 'reprint', { b: claim.broadcast, claim: claim.id, ...(canPrint || claim.confirmVersion === null ? {} : { version: claim.confirmVersion }) }, date)
  }
  const single = winners.length === 1 ? winners[0] : undefined
  const result = (
    <>
      {request.busy ? <p role="status">보내는 중…</p> : null}
      {request.done !== null ? <p role="status">{request.done}</p> : null}
      {request.error !== null ? <ErrorNote error={request.error} /> : null}
    </>
  )
  if (single !== undefined) {
    const canPrint = canPrintOf(single)
    return (
      <Modal
        title="라벨 다시 출력"
        onClose={onClose}
        actions={
          <button type="button" className="button button-primary" data-key="1" disabled={request.busy || request.done !== null} onClick={() => send(single)}>
            1 {canPrint ? '출력' : PRINT_ACTION.reprint}
          </button>
        }
      >
        <p>
          {title} 라벨을 {canPrint ? '출력할까요?' : '다시 출력할까요?'} (1등: {nameOf(single)}
          {claimOptionWords(single)})
        </p>
        {result}
      </Modal>
    )
  }
  return (
    <Modal title="라벨 다시 출력" onClose={onClose}>
      <p>{title}의 어느 1등 라벨을 출력할까요?</p>
      <ol className="plain-list stack-tight">
        {winners.map((claim, index) => {
          const key = index < 9 ? String(index + 1) : undefined
          const canPrint = canPrintOf(claim)
          return (
            <li key={claim.id}>
              <button type="button" className="button" data-key={key} disabled={request.busy} onClick={() => send(claim)}>
                {key === undefined ? '' : `${key} `}
                {nameOf(claim)}
                {claimOptionWords(claim)} {canPrint ? '출력' : PRINT_ACTION.reprint}
              </button>
            </li>
          )
        })}
      </ol>
      {result}
    </Modal>
  )
}

// ── 정산 자세히의 포장 라벨 (AC-I1-35) ────────────────────────────────────

export function PackingLabels({ date, buyer, rehearsal }: { readonly date: string; readonly buyer: string; readonly rehearsal: boolean }) {
  const enabled = useLabelsEnabled()
  if (enabled !== true) {
    // 모름·리허설: 비운다. 꺼짐: 포장 라벨 자리에 안내 (AC-N4a-15)
    if (enabled === null || rehearsal) return null
    return (
      <section className="stack-tight" aria-label="포장 라벨">
        <h3 className="sub-title">포장 라벨</h3>
        <LabelsOffNote />
      </section>
    )
  }
  if (rehearsal) {
    return (
      <section className="stack-tight" aria-label="포장 라벨">
        <h3 className="sub-title">포장 라벨</h3>
        <p>{REHEARSAL_NO_LABELS}</p>
      </section>
    )
  }
  return <PackingBody date={date} buyer={buyer} />
}

const NO_ITEMS = '이 묶음에는 1등 상품이 없어 포장 라벨을 만들 수 없어요.'

function PackingBody({ date, buyer }: { readonly date: string; readonly buyer: string }) {
  const api = usePrintApi()
  const print = usePrintState()
  const packing = usePackingLabel(date, buyer)
  const env = useLabelEnv()
  const exporter = useExport()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const view = packing.view
  const data = (view?.data ?? null) as PackingLabelData | null
  const template = packingTemplateOf(print.templates?.packing.template)
  const rendered = useMemo(() => (env.state !== 'ready' || data === null ? null : renderPacking(env.env, template, data)), [env, template, data])
  const pages = rendered !== null && rendered.ok ? rendered.images : []
  const label = view?.label
  const send = async () => {
    if (api === null || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    const requestId = newRequestId()
    try {
      const result = await withRetry(() => api.store.act<{ jobs: JobView[] }>('/api/print/packing', { requestId, date, buyer: view?.buyer ?? buyer }))
      setDone(`포장 라벨 ${String(result.jobs.length)}장 출력을 접수했어요.`)
      api.store.refreshPacking(date, buyer)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const savePng = async (index: number, share: boolean) => {
    const image = pages[index]
    if (image === undefined) return
    const png = pngBytes(image)
    if (!png.ok) {
      exporter.setMessage(png.message)
      return
    }
    if (share) await shareBytes(png.bytes, packingPngName(date, index + 1), 'image/png')
    else downloadBytes(png.bytes, packingPngName(date, index + 1), 'image/png')
  }
  const savePdf = () => {
    if (pages.length === 0) return
    const pdf = labelPdfBytes(pages)
    if (!pdf.ok) exporter.setMessage(pdf.message)
    else downloadBytes(pdf.bytes, packingPdfName(date), 'application/pdf')
  }
  return (
    <section className="stack-tight" aria-label="포장 라벨">
      <h3 className="sub-title">포장 라벨</h3>
      {packing.phase === 'loading' ? <p role="status">불러오는 중…</p> : null}
      {packing.phase === 'error' && packing.error !== null ? <ErrorNote error={packing.error} /> : null}
      {label !== undefined && label.word !== '' ? (
        <p>
          <span className={label.state === 'REPRINT_NEEDED' ? 'tag tag-alert' : 'tag'}>{label.word}</span> <span className="hint">{historyWord(label)}</span>
        </p>
      ) : null}
      {packing.phase === 'ready' && data === null ? <p className="warning">{NO_ITEMS}</p> : null}
      {env.state === 'error' ? <p className="field-error">{FONT_ERROR}</p> : null}
      {rendered !== null && !rendered.ok ? (
        <p className="field-error" role="alert">
          {labelErrorMessage(rendered.error)}
        </p>
      ) : null}
      {pages.length > 0 ? (
        <ul className="plain-list label-pages" aria-label="포장 라벨 쪽">
          {pages.map((image, index) => (
            <li key={index} className="label-box">
              <p>
                {index + 1}/{pages.length}
              </p>
              <LabelImage image={image} label={`포장 라벨 ${String(index + 1)}/${String(pages.length)} 미리 보기`} framed />
              <div className="row">
                <button type="button" className="button button-small" onClick={() => void savePng(index, false)}>
                  그림 파일로 저장
                </button>
                {exporter.canShare ? (
                  <button type="button" className="button button-small" onClick={() => void savePng(index, true)}>
                    공유
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row">
        {/* 보통 버튼: 정산 자세히의 주 버튼은 지금 할 일 하나(입금·환불 적기)뿐이다 (AC-S06b-24, D-101) */}
        <button type="button" className="button" disabled={busy || data === null} onClick={() => void send()}>
          포장 라벨 출력
        </button>
        <button type="button" className="button" disabled={pages.length === 0} onClick={savePdf}>
          PDF로 저장
        </button>
      </div>
      {done !== null ? <p role="status">{done}</p> : null}
      {error !== null ? <ErrorNote error={error} /> : null}
      {exporter.message !== null ? <p className="field-error">{exporter.message}</p> : null}
    </section>
  )
}
