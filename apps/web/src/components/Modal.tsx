// 창 (AC-S05-42, D-087): 처음 포커스는 아무것도 바꾸지 않는 "닫기"(또는 "아니요"), Esc로 닫기, Tab은 창 안에서만 돈다,
// 번호 붙은 선택 버튼은 숫자 키 1·2·3으로도 누른다(글 칸에 포커스가 있을 때는 글자 그대로).
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useReadOnly } from '../lib/read-only.ts'

export interface ModalProps {
  readonly title: string
  readonly onClose: () => void
  /** 처음 포커스를 받을 요소 (없으면 창 안의 "닫기" 버튼) */
  readonly initialFocus?: RefObject<HTMLElement | null>
  readonly children: ReactNode
  /** 창 아래 버튼 줄 */
  readonly actions?: ReactNode
  /** 닫기 버튼 글자 (기본 "닫기") */
  readonly closeLabel?: string
  readonly wide?: boolean
  /** 볼 수만 있는 화면(봉인한 날짜)에서도 안의 버튼을 잠그지 않는다 — 창이 스스로 쓰기 버튼을 잠글 때 (기본 잠금, AC-I3-41) */
  readonly unlocked?: boolean
  /** "닫기"를 버튼 줄 끝에 둔다 (설정 떠나기 창 — "저장하고 떠나기"·"저장하지 않고 떠나기"·"닫기" 순서, FB1 D-FB1-18 (e)). 처음 포커스는 그대로 "닫기" */
  readonly closeLast?: boolean
  /** "닫기"를 잠근다 (보내는 동안) */
  readonly closeDisabled?: boolean
  /** 휴대폰 폭(48rem 미만)에서 창을 화면 아래쪽에 붙인다 — 엄지 쪽 (로그아웃 확인 창만, MOB1 D-MOB1-16). PC 폭은 위쪽 그대로 */
  readonly phoneBottom?: boolean
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function isTextField(element: Element | null): boolean {
  if (element === null) return false
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (!(element instanceof HTMLInputElement)) return false
  return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(element.type)
}

export function Modal({ title, onClose, initialFocus, children, actions, closeLabel = '닫기', wide = false, unlocked = false, closeLast = false, closeDisabled = false, phoneBottom = false }: ModalProps) {
  const readOnly = useReadOnly() && !unlocked
  const titleId = useId()
  const backdrop = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const target = initialFocus?.current ?? closeButton.current
    // 화면보다 긴 창에서 처음 포커스가 맨 아래 "닫기"여도 창을 그 자리까지 내리지 않는다 — 제목·1등이 먼저 보이게 맨 위에서 연다 (QL3R1 D-QL3R1-01)
    target?.focus({ preventScroll: true })
    if (backdrop.current !== null) backdrop.current.scrollTop = 0
    if (panel.current !== null) panel.current.scrollTop = 0
    // 처음 한 번만 (내용이 바뀔 때마다 포커스를 옮기지 않는다)
  }, [])

  // 누른 버튼이 사라지거나(상태가 바뀌어 다른 버튼으로) 잠기면 포커스가 창 밖으로 빠진다 — 창의 "닫기"로 되돌린다(키보드만으로 계속 쓰게).
  // 보던 자리는 옮기지 않는다 (D-QL3R1-01 (2))
  useEffect(() => {
    const element = panel.current
    if (element !== null && !element.contains(document.activeElement)) closeButton.current?.focus({ preventScroll: true })
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      const first = items[0]
      const last = items.at(-1)
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if (/^[1-9]$/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey && !isTextField(document.activeElement)) {
      const choice = panel.current?.querySelector<HTMLButtonElement>(`button[data-key="${event.key}"]:not([disabled])`)
      if (choice) {
        event.preventDefault()
        event.stopPropagation()
        // 키를 누르고 있어 반복된 입력은 무시한다 — 한 번 누름 = 한 번 동작 (QL3R2 D-QL3R2-06 (2))
        if (event.repeat) return
        choice.click()
      }
    }
  }

  const close = (
    <button ref={closeButton} type="button" className="button" disabled={closeDisabled} onClick={onClose}>
      {closeLabel}
    </button>
  )
  return (
    <div ref={backdrop} className={phoneBottom ? 'backdrop backdrop-phone-bottom' : 'backdrop'}>
      <div ref={panel} className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div className="modal-body">
          {readOnly ? (
            <fieldset className="lock" disabled>
              {children}
            </fieldset>
          ) : (
            children
          )}
        </div>
        <div className="modal-actions">
          {closeLast ? null : close}
          {readOnly && actions !== undefined ? (
            <fieldset className="lock lock-inline" disabled>
              {actions}
            </fieldset>
          ) : (
            actions
          )}
          {closeLast ? close : null}
        </div>
      </div>
    </div>
  )
}
