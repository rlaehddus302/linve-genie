// 창 (AC-S05-42, D-087): 처음 포커스는 아무것도 바꾸지 않는 "닫기"(또는 "아니요"), Esc로 닫기, Tab은 창 안에서만 돈다,
// 번호 붙은 선택 버튼은 숫자 키 1·2·3으로도 누른다(글 칸에 포커스가 있을 때는 글자 그대로).
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

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
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isTextField(element: Element | null): boolean {
  if (element === null) return false
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (!(element instanceof HTMLInputElement)) return false
  return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(element.type)
}

export function Modal({ title, onClose, initialFocus, children, actions, closeLabel = '닫기', wide = false }: ModalProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const target = initialFocus?.current ?? closeButton.current
    target?.focus()
    // 처음 한 번만 (내용이 바뀔 때마다 포커스를 옮기지 않는다)
  }, [])

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
        choice.click()
      }
    }
  }

  return (
    <div className="backdrop">
      <div ref={panel} className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button ref={closeButton} type="button" className="button" onClick={onClose}>
            {closeLabel}
          </button>
          {actions}
        </div>
      </div>
    </div>
  )
}
