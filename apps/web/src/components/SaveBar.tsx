// 설정 화면 아래 저장 막대 (FB1 D-FB1-06, AC-FB1-22~24). 화면 아래에 붙어 늘 보인다(휴대폰은 아래 메뉴 막대 위).
// 바뀐 칸이 없으면 "바꾼 칸이 없어요."와 잠긴 "저장", 있으면 "저장하지 않은 칸: 판매 규칙 · 택배"와 주 버튼 "저장".
// 누르면 단계를 차례로 보낸다(가게 → 설정 하나 → 택배, 하나가 실패해도 나머지는 보낸다). 보내는 동안 "저장하는 중…"으로 잠긴다(두 번 눌러도 한 번).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

type Steps = Partial<Record<SaveStepId, SaveStep>>

type Result = { readonly kind: 'saved'; readonly text: string } | { readonly kind: 'failed'; readonly failed: readonly SaveBlock[] }

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
  /** 저장한 뒤 바뀐 칸이 없어진 것을 봤다 — 그 뒤 칸을 고치면 성공 문장을 지운다 */
  const settled = useRef(false)
  const dirty = orderBlocks(Object.values(steps).flatMap((step) => step?.dirty ?? []))

  useEffect(() => {
    if (result?.kind !== 'saved') return
    if (dirty.length === 0) settled.current = true
    else if (settled.current) setResult(null)
  }, [result, dirty.length])

  const save = async () => {
    if (sending.current || dirty.length === 0) return
    sending.current = true
    setBusy(true)
    setResult(null)
    settled.current = false
    try {
      const outcome = await runSteps(steps)
      setResult(outcome.failed.length > 0 ? { kind: 'failed', failed: outcome.failed } : { kind: 'saved', text: savedMessage(outcome.saved) })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  // 실패 문장은 그 칸이 아직 저장하지 않은 채일 때만 (되돌려 저장값과 같아지면 사라진다)
  const failed = result?.kind === 'failed' ? result.failed.filter((name) => dirty.includes(name)) : []
  return (
    <section className="save-bar" aria-label="저장">
      {result?.kind === 'saved' && dirty.length === 0 ? (
        <p className="notice" role="status" data-tone="success">
          {result.text}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <p className="field-error save-bar-failed" role="alert">
          {failedMessage(failed)}
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
