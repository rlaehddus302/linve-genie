// 댓글 붙여넣기 창 (PLT-02 세부, D-N2b-2-07·08, AC-N2b-2-64). 콘솔(틱톡 칸·알림 띠)과 문자찜 화면이 같은 창을 연다.
// - 글 칸 → "미리 보기"(아무것도 기록하지 않는다): 줄마다 줄 번호·닉네임·결과 문장(서버 문장 그대로), 같은 닉네임 묶음 안내, 주 단추 "찜 N개 넣기".
// - 글을 고치면 미리 보기를 다시 해야 넣을 수 있다(고친 글은 새 요청 번호).
// - 넣기: 한 번 누르면 단추가 잠긴다. 응답이 없어 다시 보내도 같은 요청 번호 — 찜이 둘 생기지 않는다(서버가 처음 응답을 돌려준다).
//   끝나면 "찜 N개를 넣었어요."를 부른 쪽에 넘기고 창을 닫는다.
// 닉네임·댓글은 글자로만 보인다(React 기본 이스케이프). 375px 폭에서도 가로로 넘치지 않게 줄을 감싼다.
import { useId, useRef, useState } from 'react'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { PastePlanView } from '../api/types.ts'
import { groupDigits } from '../lib/money.ts'
import { PASTE_GUIDE, PASTE_STALE, pasteButtonLabel, pasteDoneMessage, pasteGroupMessage } from '../lib/platforms.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export interface PasteDialogProps {
  readonly broadcastId: string
  readonly onClose: () => void
  /** 넣기를 마쳤다 (문장 "찜 N개를 넣었어요.") — 부른 쪽이 창을 닫고 문장을 보인다 */
  readonly onDone: (message: string) => void
}

interface Previewed {
  readonly text: string
  readonly plan: PastePlanView
  /** 이 글로 넣을 때 쓸 요청 번호 (같은 글이면 다시 보내도 같다) */
  readonly requestId: string
}

export function PasteDialog({ broadcastId, onClose, onDone }: PasteDialogProps) {
  const [text, setText] = useState('')
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<ApiError | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  const sendingRef = useRef(false)
  const textId = useId()
  const guideId = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`

  const stale = previewed !== null && previewed.text !== text
  const plan = previewed?.plan ?? null
  const total = plan?.total ?? 0
  const canSend = previewed !== null && !stale && total > 0 && !sending

  const preview = async () => {
    if (previewing || sending) return
    const current = text
    setPreviewing(true)
    setPreviewError(null)
    setSendError(null)
    try {
      const result = await withRetry(() => post<PastePlanView>(`${base}/paste/preview`, { text: current }))
      // 같은 글을 다시 미리 보면 요청 번호를 그대로 둔다 (응답 없이 끝난 넣기를 다시 보내도 한 번만)
      setPreviewed((before) => ({ text: current, plan: result, requestId: before !== null && before.text === current ? before.requestId : newRequestId() }))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setPreviewed(null)
      setPreviewError(caught)
    } finally {
      setPreviewing(false)
    }
  }

  const send = async () => {
    if (!canSend || previewed === null || sendingRef.current) return
    sendingRef.current = true
    const { requestId, text: body } = previewed
    setSending(true)
    setSendError(null)
    try {
      const result = await withRetry(() => post<PastePlanView>(`${base}/paste`, { requestId, text: body }))
      onDone(pasteDoneMessage(result.added ?? result.total))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setSendError(caught)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <Modal
      title="댓글 붙여넣기"
      onClose={onClose}
      wide
      initialFocus={area}
      actions={
        <button type="button" className="button button-primary" disabled={!canSend} onClick={() => void send()}>
          {sending ? '넣는 중…' : pasteButtonLabel(stale ? 0 : total)}
        </button>
      }
    >
      <div className="stack paste-dialog">
        <p id={guideId}>{PASTE_GUIDE}</p>
        <label className="field" htmlFor={textId}>
          <span>붙여 넣을 댓글</span>
        </label>
        <textarea
          id={textId}
          ref={area}
          className="input paste-text"
          rows={6}
          spellCheck={false}
          aria-describedby={guideId}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="row">
          <button type="button" className="button" disabled={previewing || sending || text.trim() === ''} onClick={() => void preview()}>
            {previewing ? '보는 중…' : '미리 보기'}
          </button>
        </div>
        {previewError !== null ? <ErrorNote error={previewError} /> : null}
        {stale ? (
          <p className="warning" role="status">
            {PASTE_STALE}
          </p>
        ) : null}
        {plan !== null && !stale ? <PastePreview plan={plan} /> : null}
        {sendError !== null ? <ErrorNote error={sendError} {...(sendError.transient ? { onRetry: () => void send() } : {})} /> : null}
      </div>
    </Modal>
  )
}

/** 미리 보기: 줄 결과 + 같은 닉네임 묶음 */
export function PastePreview({ plan }: { readonly plan: PastePlanView }) {
  const many = plan.groups.filter((group) => group.lines.length > 1)
  return (
    <div className="stack-tight paste-preview" role="group" aria-label="미리 보기">
      <p role="status">넣을 찜 {groupDigits(plan.total)}개</p>
      <ol className="plain-list paste-rows" aria-label="줄마다 결과">
        {plan.rows.map((row) => (
          <li key={row.line} className={row.result === 'ORDER' ? 'paste-row paste-row-order' : 'paste-row'}>
            <span className="paste-line">{row.line}줄</span>{' '}
            {row.nickname !== undefined ? (
              <>
                <strong className="paste-nick">{row.nickname}</strong>{' '}
              </>
            ) : null}
            <span>{row.message}</span>
          </li>
        ))}
      </ol>
      {many.length > 0 ? (
        <ul className="plain-list paste-groups" aria-label="같은 닉네임">
          {many.map((group) => (
            <li key={group.nickname}>
              <strong className="paste-nick">{group.nickname}</strong> {pasteGroupMessage(group.lines.length)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
