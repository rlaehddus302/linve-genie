// 라벨 기능을 끈 판매자의 라벨 자리 (N4a, LABEL_RULES L-13 9, D-N4a-05, AC-N4a-13~15·20).
// - 라벨이 있던 자리(라벨 화면·상품 자세히·정산 자세히·Alt+P)에 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."를 보인다.
// - 오래된 화면이 보낸 라벨 요청이 `LABELS_OFF`로 거절됐으면 그 서버 문장을 함께 보인다(저절로 다시 보내지 않는다, AC-N4a-20).
//   그 문장은 켜지거나 다른 화면으로 옮기면 지운다(RefusalReset).
import { useEffect, useRef, type MouseEvent } from 'react'
import { LABELS_OFF_NOTE } from '../lib/print-words.ts'
import { routePath } from '../lib/router.ts'
import { usePrintApi, usePrintState } from './print-context.tsx'

export interface LabelsOffNoteProps {
  /** `/settings`로 가는 "설정" 링크 (라벨 화면, AC-N4a-13) — 누르면 부른다 */
  readonly onSettings?: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function LabelsOffNote({ onSettings }: LabelsOffNoteProps) {
  const print = usePrintState()
  const refusal = print.labelsRefusal ?? null
  return (
    <div className="labels-off stack-tight">
      {refusal !== null ? (
        <p className="field-error" role="alert" data-tone="danger">
          {refusal}
        </p>
      ) : null}
      <p className="labels-off-note">{LABELS_OFF_NOTE}</p>
      {onSettings !== undefined ? (
        <p>
          <a className="button" href={routePath({ name: 'settings' })} onClick={onSettings}>
            설정
          </a>
        </p>
      ) : null}
    </div>
  )
}

/** 화면(주소)을 옮기면 지난 화면의 `LABELS_OFF` 거절 문장을 지운다 — 처음 그린 때는 지우지 않는다 */
export function RefusalReset({ screen }: { readonly screen: string }) {
  const api = usePrintApi()
  const previous = useRef<string | null>(null)
  useEffect(() => {
    if (previous.current !== null && previous.current !== screen) {
      const refusal = api?.store.getSnapshot().labelsRefusal ?? null
      if (refusal !== null) api?.store.clearRefusal(refusal)
    }
    previous.current = screen
  }, [api, screen])
  return null
}
