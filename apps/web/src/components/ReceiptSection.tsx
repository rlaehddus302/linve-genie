// 정산 자세히의 구매 내역 확인서 (STL-04·05, D-I2-01, AC-I2-13·15, UX-07 D-093).
// - 미리 보기 그림 = 서버가 만든 PNG 그대로(공유할 그림과 같은 파일). 받는 동안 "확인서를 만드는 중이에요…"이고 버튼이 잠긴다.
// - "이미지 공유"(공유할 수 있는 기기)는 미리 받아 둔 같은 PNG를 File로 만들어 누른 순간 navigator.share에 넘긴다 — 누른 뒤 다시 받지 않는다.
//   공유 창을 닫으면(AbortError) 아무 오류도 없다. 그 밖의 실패면 "공유하지 못했어요. '이미지 저장'으로 저장해 주세요."와 "이미지 저장".
// - 공유할 수 없는 기기는 "이미지 저장"(같은 바이트의 파일). "PDF 내려받기"는 같은 확인서 데이터·같은 글꼴로 서버가 만든 PDF.
// - 그 묶음이 바뀌면(입금·환불·배송비·조정·품목·이름·가게 설정 — 실시간 알림) 그림을 새로 받고, 받는 동안 공유·저장·내려받기를 잠근다.
//   새 그림을 받기 전엔 이전 그림을 공유하지 않는다.
// - 받은 그림·파일은 브라우저 저장소에 두지 않는다(메모리의 blob: 주소만, 다 쓰면 놓는다).
import { useEffect, useMemo, useRef, useState } from 'react'
import { getFile, isApiError, withQuery, type ApiError } from '../api/client.ts'
import { PROBE_PNG, canShareFiles, objectUrl, revokeObjectUrl, saveFile, shareFile } from '../lib/files.ts'
import { useDownload } from './downloads.tsx'
import { RequestError } from './ErrorNote.tsx'

export const RECEIPT_LOADING = '확인서를 만드는 중이에요…'
export const RECEIPT_NO_ITEMS = '구매 내역이 없어 확인서를 만들 수 없어요.'
export const SHARE_FAILED = "공유하지 못했어요. '이미지 저장'으로 저장해 주세요."
export const REHEARSAL_RECORD = '리허설 기록이에요.'

interface Received {
  readonly blob: Blob
  readonly fileName: string
  readonly url: string | null
}

export interface ReceiptSectionProps {
  readonly date: string
  readonly rehearsal: boolean
  /** 지금의 구매자 ID */
  readonly buyer: string
  /** 품목이 있는가 (없으면 확인서 대신 한 문장) */
  readonly hasItems: boolean
  /** 확인서에 닿는 자료의 모양 — 바뀌면 그림을 새로 받는다 */
  readonly signature: string
}

export function ReceiptSection({ date, rehearsal, buyer, hasItems, signature }: ReceiptSectionProps) {
  if (!hasItems) {
    return (
      <section className="stack-tight" aria-label="구매 내역 확인서">
        <h3 className="sub-title">구매 내역 확인서</h3>
        <p>{RECEIPT_NO_ITEMS}</p>
      </section>
    )
  }
  return <ReceiptPreview date={date} rehearsal={rehearsal} buyer={buyer} signature={signature} />
}

function ReceiptPreview({ date, rehearsal, buyer, signature }: Omit<ReceiptSectionProps, 'hasItems'>) {
  const [received, setReceived] = useState<Received | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [shareFailed, setShareFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const pdf = useDownload()
  const latest = useRef<Received | null>(null)
  const query = { buyer, rehearsal }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setShareFailed(false)
    getFile(withQuery(`/api/days/${date}/receipt.png`, query), { signal: controller.signal, fallbackName: `receipt-${date}.png` }).then(
      (file) => {
        if (controller.signal.aborted) return
        const next: Received = { blob: file.blob, fileName: file.fileName, url: objectUrl(file.blob) }
        revokeObjectUrl(latest.current?.url ?? null)
        latest.current = next
        setReceived(next)
        setLoading(false)
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return
        // 새 그림을 받지 못했다 — 이전 그림을 공유·저장하지 않게 지운다
        revokeObjectUrl(latest.current?.url ?? null)
        latest.current = null
        setReceived(null)
        setLoading(false)
        if (isApiError(caught)) setError(caught)
      },
    )
    return () => controller.abort()
    // query는 buyer·rehearsal로 정해진다
  }, [date, buyer, rehearsal, signature, attempt])

  // 화면이 내려가면 그림 주소를 놓는다
  useEffect(() => () => revokeObjectUrl(latest.current?.url ?? null), [])

  const file = useMemo(() => (received === null ? null : new File([received.blob], received.fileName, { type: 'image/png' })), [received])
  const sharable = useMemo(() => canShareFiles(file ?? PROBE_PNG()), [file])
  const locked = loading || file === null

  const share = () => {
    if (file === null || loading) return
    setShareFailed(false)
    // 누른 그 순간 넘긴다 (기다리지 않는다 — 브라우저의 사용자 동작 조건)
    void shareFile(file).then((outcome) => {
      if (outcome === 'failed') setShareFailed(true)
    })
  }
  const save = () => {
    if (received === null || loading) return
    saveFile(received.blob, received.fileName)
  }

  return (
    <section className="stack-tight receipt-section" aria-label="구매 내역 확인서">
      <h3 className="sub-title">구매 내역 확인서</h3>
      {loading ? <p role="status">{RECEIPT_LOADING}</p> : null}
      {received?.url !== undefined && received.url !== null ? <img className={loading ? 'receipt-preview receipt-preview-old' : 'receipt-preview'} src={received.url} alt="구매 내역 확인서 미리 보기" /> : null}
      {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 만들기" /> : null}
      <div className="row" role="group" aria-label="확인서 보내기">
        <button type="button" className="button" disabled={locked || pdf.busy} onClick={() => void pdf.run(withQuery(`/api/days/${date}/receipt.pdf`, query), `receipt-${date}.pdf`)}>
          PDF 내려받기
        </button>
        {sharable ? (
          <button type="button" className="button" disabled={locked} onClick={share}>
            이미지 공유
          </button>
        ) : (
          <button type="button" className="button" disabled={locked} onClick={save}>
            이미지 저장
          </button>
        )}
        {rehearsal ? <span className="tag tag-rehearsal">{REHEARSAL_RECORD}</span> : null}
      </div>
      {pdf.busy ? <p role="status">PDF를 만드는 중이에요…</p> : null}
      {pdf.error !== null ? <RequestError error={pdf.error} /> : null}
      {shareFailed ? (
        <div className="error-note" role="alert" data-tone="danger">
          <p>{SHARE_FAILED}</p>
          {sharable ? (
            <button type="button" className="button" disabled={locked} onClick={save}>
              이미지 저장
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
