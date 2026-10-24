// 설정 화면 아래 저장 막대 (FB1 D-FB1-06, AC-FB1-22~24). 화면 아래에 붙어 늘 보인다(휴대폰은 아래 메뉴 막대 위).
// 바뀐 칸이 없으면 "바꾼 칸이 없어요."와 잠긴 "저장", 있으면 "저장하지 않은 칸: 판매 규칙 · 택배"와 주 버튼 "저장".
// 누르면 단계를 차례로 보낸다(가게 → 설정 하나 → 택배, 하나가 실패해도 나머지는 보낸다). 보내는 동안 "저장하는 중…"으로 잠긴다(두 번 눌러도 한 번).
// 떠나기 창의 "저장하고 떠나기"(FB1 D-FB1-18 (e))도 이 막대의 저장을 그대로 부른다(같은 요청 차례·같은 문장·같은 포커스) — 막대가 앱에 떠나기 확인으로 알린다.
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { LeaveGuardContext, UNSAVED_LEAVE, UNSAVED_QUESTION } from '../lib/leave-guard.ts'
import {
  SAVE_LABEL,
  SAVING_LABEL,
  SaveBarContext,
  dirtyLine,
  failedMessage,
  orderBlocks,
  runSteps,
  savedMessage,
  type SaveBlock,
  type SaveStep,
  type SaveStepId,
} from '../lib/save-bar.ts'

/**
 * 일부 실패 뒤 첫 고칠 칸으로 데려간다 (U-FB1-02, UX-03): 실패한 칸 이름 중 화면에서 첫 블록(제목 h2가 그 이름인 칸)의
 * 첫 빨간 칸(aria-invalid)으로 화면을 옮기고 포커스. 접힌 "상세 설정" 안이면 편다. 빨간 칸이 없으면(네트워크 실패 등) 그 블록 제목으로.
 */
export function focusFirstFailed(root: ParentNode, failed: readonly SaveBlock[]): HTMLElement | null {
  const first = orderBlocks(failed)[0]
  if (first === undefined) return null
  const heading = [...root.querySelectorAll<HTMLElement>('section.settings-section > h2')].find((h) => h.textContent?.trim() === first)
  const block = heading?.parentElement
  if (heading === undefined || block === null || block === undefined) return null
  const field = block.querySelector<HTMLElement>('[aria-invalid="true"]')
  const target = field ?? heading
  for (let parent = target.parentElement; parent !== null && parent !== block; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
  }
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: field === null ? 'start' : 'center' })
  target.focus({ preventScroll: true })
  return target
}

type Steps = Partial<Record<SaveStepId, SaveStep>>

type Result = { readonly kind: 'saved'; readonly text: string } | { readonly kind: 'failed'; readonly failed: readonly SaveBlock[]; readonly saved: readonly SaveBlock[] }

/** 저장 막대와 그 막대가 맡는 칸들 (children 안의 칸 묶음이 useSaveStep으로 알린다) */
export function SaveBarArea({ children }: { readonly children: ReactNode }) {
  const [steps, setSteps] = useState<Steps>({})
  const register = useCallback((id: SaveStepId, step: SaveStep | null) => {
    setSteps((current) => {
      if (step === null) {
        if (current[id] === undefined) return current
        const next = { ...current }
        delete next[id]
        return next
      }
      return { ...current, [id]: step }
    })
  }, [])
  return (
    <SaveBarContext.Provider value={register}>
      {children}
      <SaveBar steps={steps} />
    </SaveBarContext.Provider>
  )
}

function SaveBar({ steps }: { readonly steps: Steps }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const sending = useRef(false)
  const barRef = useRef<HTMLElement>(null)
  /** 저장한 뒤 바뀐 칸이 없어진 것을 봤다 — 그 뒤 칸을 고치면 성공 문장을 지운다 */
  const settled = useRef(false)
  const dirty = orderBlocks(Object.values(steps).flatMap((step) => step?.dirty ?? []))

  useEffect(() => {
    if (result?.kind !== 'saved') return
    if (dirty.length === 0) settled.current = true
    else if (settled.current) setResult(null)
  }, [result, dirty.length])

  /** 모두 저장했으면 true (보내는 중이면 false — 두 번 눌러도 한 번) */
  const save = async (): Promise<boolean> => {
    if (sending.current) return false
    if (dirty.length === 0) return true
    sending.current = true
    setBusy(true)
    setResult(null)
    settled.current = false
    try {
      const outcome = await runSteps(steps)
      const ok = outcome.failed.length === 0
      setResult(ok ? { kind: 'saved', text: savedMessage(outcome.saved) } : { kind: 'failed', failed: outcome.failed, saved: outcome.saved })
      return ok
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  // 떠나기 창의 "저장하고 떠나기" (D-FB1-18 (e)): 남은 값이 있으면 묻고, 저장은 이 막대의 저장 그대로
  const register = useContext(LeaveGuardContext)
  const dirtyNow = useRef(dirty.length > 0)
  dirtyNow.current = dirty.length > 0
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(
    () =>
      register({
        pending: () => dirtyNow.current,
        hold: () => {},
        release: () => {},
        discard: () => {},
        question: UNSAVED_QUESTION,
        leaveLabel: UNSAVED_LEAVE,
        save: () => saveRef.current(),
      }),
    [register],
  )

  // 일부 실패하면 첫 고칠 칸으로 (저장할 때마다 한 번 — result가 새로 생길 때)
  useEffect(() => {
    if (result?.kind !== 'failed') return
    const root = barRef.current?.closest('main') ?? document
    focusFirstFailed(root, result.failed)
  }, [result])

  // 실패 문장은 그 칸이 아직 저장하지 않은 채일 때만 (되돌려 저장값과 같아지면 사라진다)
  const failed = result?.kind === 'failed' ? result.failed.filter((name) => dirty.includes(name)) : []
  return (
    <section ref={barRef} className="save-bar" aria-label="저장">
      {result?.kind === 'saved' && dirty.length === 0 ? (
        <p className="notice" role="status" data-tone="success">
          {result.text}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <p className="field-error save-bar-failed" role="alert">
          {failedMessage(failed, result?.kind === 'failed' ? result.saved : [])}
        </p>
      ) : null}
      <div className="row save-bar-row">
        <p className="save-bar-state">{dirtyLine(dirty)}</p>
        <button type="button" className={dirty.length > 0 ? 'button button-primary' : 'button'} disabled={busy || dirty.length === 0} onClick={() => void save()}>
          {busy ? SAVING_LABEL : SAVE_LABEL}
        </button>
      </div>
    </section>
  )
}
