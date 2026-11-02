// 댓글 붙여넣기 창 (PLT-02 세부, D-N2b-2-07·08, AC-N2b-2-64). 콘솔(틱톡 칸·알림 띠)과 문자찜 화면이 같은 창을 연다.
// - 글 칸 → "미리 보기"(아무것도 기록하지 않는다): 줄마다 줄 번호·닉네임·결과 문장(서버 문장 그대로), 같은 닉네임 묶음 안내, 주 단추 "찜 N개 넣기".
// - 글을 고치면 미리 보기를 다시 해야 넣을 수 있다(고친 글은 새 요청 번호).
// - 넣기: 한 번 누르면 단추가 잠긴다. 응답이 없어 다시 보내도 같은 요청 번호 — 찜이 둘 생기지 않는다(서버가 처음 응답을 돌려준다).
//   끝나면 "찜 N개를 넣었어요."를 부른 쪽에 넘기고 창을 닫는다.
// - 겹친 줄(AC-N2b-2-69, D-N2b-2-14): 서버가 준 `overlapMessage`를 결과 문장 아래에 그대로 보이고 그 줄에 "그래도 넣기"(기본 꺼짐).
//   N = total + 고른 줄의 overlaps 수(고르기를 바꿔도 미리 보기를 다시 하지 않는다). 넣기는 고른 줄 번호를 includeOverlaps로 보낸다.
//   처음 넣기를 누른 뒤에는 고르기를 잠근다 — 다시 보내는 넣기는 같은 요청 번호·같은 고르기(다르면 서버가 REQUEST_REUSED).
//   잠금은 응답을 잃은 경우(`transient` — 서버에 기록됐을 수 있다)만 남긴다. 서버의 확정 거절(기록이 남지 않는 4xx, 예: NOTHING_TO_ADD)이면
//   잠금을 풀어 다시 고를 수 있다(SA-N2b-2-011). 요청 번호는 그대로 — 앞선 시도가 기록됐다면 서버가 처음 응답이나 REQUEST_REUSED로 막는다.
//   같은 닉네임 묶음 안내는 서버 묶음에 고른 겹친 줄(같은 닉네임)을 더해 센다(SA-N2b-2-012).
//   끝 안내는 넣기 응답에서 빠진 겹친 번호 수 M이 있으면 "… 이미 있는 찜 M개는 넣지 않았어요."를 붙인다.
// - 키보드(UX-N2b-2-01): 미리 보기가 끝나면 포커스가 "찜 N개 넣기"로 간다(넣을 찜이 있을 때). 보는 동안 "미리 보기"는 잠그지 않고 aria-busy —
//   포커스가 창 밖으로 빠져 "닫기"로 가지 않게. 글 칸에서 Ctrl+Enter(⌘Enter)는 미리 보기, 미리 본 뒤면 넣기.
//   붙여 넣던 글은 부른 쪽(draft)에 남아 창을 닫았다 다시 열어도 그대로다.
// 닉네임·댓글은 글자로만 보인다(React 기본 이스케이프). 375px 폭에서도 가로로 넘치지 않게 줄을 감싼다.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { PastePlanView } from '../api/types.ts'
import { groupDigits } from '../lib/money.ts'
import { PASTE_GUIDE, PASTE_INCLUDE_OVERLAP, PASTE_STALE, pasteButtonLabel, pasteDoneMessage, pasteGroupMessage, pasteGroups, pasteOverlapCount } from '../lib/platforms.ts'
export { pasteGroups } from '../lib/platforms.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export interface PasteDialogProps {
  readonly broadcastId: string
  readonly onClose: () => void
  /** 넣기를 마쳤다 (문장 "찜 N개를 넣었어요.") — 부른 쪽이 창을 닫고 문장을 보인다 */
  readonly onDone: (message: string) => void
  /** 붙여 넣던 글 (창을 닫아도 부른 쪽에 남는다) */
  readonly draft?: string
  readonly onDraftChange?: (text: string) => void
  /** 글 칸 위 안내 (없으면 틱톡 안내 — 유튜브 수집 경고에서 열면 유튜브 안내, YT-11 AC8) */
  readonly guide?: string
}

interface Previewed {
  readonly text: string
  readonly plan: PastePlanView
  /** 이 글로 넣을 때 쓸 요청 번호 (같은 글이면 다시 보내도 같다) */
  readonly requestId: string
  /** "그래도 넣기"를 고른 줄 번호 */
  readonly include: ReadonlySet<number>
  /** 이 요청 번호로 넣기를 한 번이라도 보냈다 — 고르기를 잠근다 */
  readonly sent: boolean
}

const NO_LINES: ReadonlySet<number> = new Set()

export function PasteDialog({ broadcastId, onClose, onDone, draft = '', onDraftChange, guide = PASTE_GUIDE }: PasteDialogProps) {
  const [text, setTextState] = useState(draft)
  const setText = (value: string) => {
    setTextState(value)
    onDraftChange?.(value)
  }
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<ApiError | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<ApiError | null>(null)
  const sendingRef = useRef(false)
  const textId = useId()
  const guideId = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)
  /** 미리 보기를 마치면 "찜 N개 넣기"로 포커스를 옮긴다 */
  const focusSend = useRef(false)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`

  const stale = previewed !== null && previewed.text !== text
  const plan = previewed?.plan ?? null
  const include = previewed?.include ?? NO_LINES
  const locked = previewed?.sent === true
  const total = plan === null ? 0 : plan.total + pasteOverlapCount(plan.rows, include)
  const canSend = previewed !== null && !stale && total > 0 && !sending

  useEffect(() => {
    if (!focusSend.current) return
    focusSend.current = false
    if (canSend) sendButton.current?.focus()
  }, [previewed, canSend])

  const preview = async () => {
    if (previewing || sending) return
    const current = text
    setPreviewing(true)
    setPreviewError(null)
    setSendError(null)
    try {
      const result = await withRetry(() => post<PastePlanView>(`${base}/paste/preview`, { text: current }))
      // 같은 글을 다시 미리 보면 요청 번호를 그대로 둔다 (응답 없이 끝난 넣기를 다시 보내도 한 번만)
      focusSend.current = true
      // 고르기도 같은 글이면 그대로(이미 보낸 요청 번호는 같은 고르기로만 다시 보낼 수 있다)
      setPreviewed((before) =>
        before !== null && before.text === current
          ? { ...before, plan: result }
          : { text: current, plan: result, requestId: newRequestId(), include: NO_LINES, sent: false },
      )
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
    const includeOverlaps = [...previewed.include].sort((a, b) => a - b)
    setPreviewed({ ...previewed, sent: true })
    setSending(true)
    setSendError(null)
    try {
      const result = await withRetry(() => post<PastePlanView>(`${base}/paste`, { requestId, text: body, includeOverlaps }))
      onDone(pasteDoneMessage(result.added ?? result.total, pasteOverlapCount(result.rows)))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 확정 거절은 기록이 남지 않았다 — 고르기 잠금을 푼다. 응답을 잃은 경우만 잠금을 둔다(같은 고르기로 다시 보내기)
      if (!caught.transient) setPreviewed((before) => (before !== null && before.requestId === requestId ? { ...before, sent: false } : before))
      setSendError(caught)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const toggleInclude = (line: number, on: boolean) => {
    setPreviewed((before) => {
      if (before === null || before.sent) return before
      const next = new Set(before.include)
      if (on) next.add(line)
      else next.delete(line)
      return { ...before, include: next }
    })
  }

  const onTextKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    if (canSend) void send()
    else if (text.trim() !== '') void preview()
  }

  return (
    <Modal
      title="댓글 붙여넣기"
      onClose={onClose}
      wide
      initialFocus={area}
      actions={
        <button ref={sendButton} type="button" className="button button-primary" disabled={!canSend} onClick={() => void send()}>
          {sending ? '넣는 중…' : pasteButtonLabel(stale ? 0 : total)}
        </button>
      }
    >
      <div className="stack paste-dialog">
        <p id={guideId}>{guide}</p>
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
          onKeyDown={onTextKey}
        />
        <div className="row">
          <button type="button" className="button" aria-busy={previewing} disabled={sending || text.trim() === ''} onClick={() => void preview()}>
            {previewing ? '보는 중…' : '미리 보기'}
          </button>
        </div>
        {previewError !== null ? <ErrorNote error={previewError} /> : null}
        {stale ? (
          <p className="warning" role="status">
            {PASTE_STALE}
          </p>
        ) : null}
        {plan !== null && !stale ? <PastePreview plan={plan} total={total} include={include} locked={locked || sending} onInclude={toggleInclude} /> : null}
        {sendError !== null ? <ErrorNote error={sendError} {...(sendError.transient ? { onRetry: () => void send() } : {})} /> : null}
      </div>
    </Modal>
  )
}

export interface PastePreviewProps {
  readonly plan: PastePlanView
  /** 넣을 찜 수 (고른 줄의 겹친 번호 포함) */
  readonly total?: number
  readonly include?: ReadonlySet<number>
  /** 처음 넣기를 누른 뒤 — 고르기 잠금 */
  readonly locked?: boolean
  readonly onInclude?: (line: number, on: boolean) => void
}

/** 미리 보기: 줄 결과(겹친 줄은 서버 문장 + "그래도 넣기") + 같은 닉네임 묶음 */
export function PastePreview({ plan, total = plan.total, include = NO_LINES, locked = false, onInclude }: PastePreviewProps) {
  const many = pasteGroups(plan, include)
  return (
    <div className="stack-tight paste-preview" role="group" aria-label="미리 보기">
      <p role="status">넣을 찜 {groupDigits(total)}개</p>
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
            {row.overlaps !== undefined && row.overlaps.length > 0 && row.overlapMessage !== undefined ? (
              <span className="paste-overlap">
                <span className="paste-overlap-message">{row.overlapMessage}</span>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={include.has(row.line)}
                    disabled={locked || onInclude === undefined}
                    onChange={(event) => onInclude?.(row.line, event.target.checked)}
                  />
                  <span>{PASTE_INCLUDE_OVERLAP}</span>
                </label>
              </span>
            ) : null}
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
