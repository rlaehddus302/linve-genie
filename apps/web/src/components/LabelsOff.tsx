// 라벨 기능을 끈 판매자의 라벨 자리 (N4a, LABEL_RULES L-13 9, D-N4a-05, AC-N4a-13~15·20).
// - 라벨이 있던 자리(라벨 화면·상품 자세히·정산 자세히·Alt+P)에 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."를 보인다.
// - 오래된 화면이 보낸 라벨 요청이 `LABELS_OFF`로 거절됐으면 그 서버 문장을 함께 보인다(저절로 다시 보내지 않는다, AC-N4a-20).
//   그 문장은 켜지거나 다른 화면으로 옮기면 지운다(RefusalReset).
// - U-PL1B-06: 안내 문장의 "설정"은 설정 화면의 라벨 칸(`/settings/labels`)으로 가는 링크 — 문장 글자는 그대로다.
//   링크 이름은 "설정의 라벨 칸 열기"(메뉴의 "설정" 링크와 헷갈리지 않게). 따로 "설정" 버튼을 보이는 곳(라벨 화면)은 문장 안 링크를 두지 않는다.
import { useEffect, useRef, type MouseEvent } from 'react'
import { LABELS_OFF_NOTE } from '../lib/print-words.ts'
import { routePath } from '../lib/router.ts'
import { AppLink } from './AppLink.tsx'
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
      <p className="labels-off-note">{onSettings !== undefined ? LABELS_OFF_NOTE : <LabelsOffSentence />}</p>
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

/** 설정 링크 이름 (보이는 글자 "설정"을 담는다) */
export const LABELS_SETTINGS_LINK = '설정의 라벨 칸 열기'

const LINK_WORD = '설정'

/** "라벨 쓰지 않음 — 설정에서 켤 수 있어요." — "설정"만 설정 화면 라벨 칸 링크 */
export function LabelsOffSentence() {
  const at = LABELS_OFF_NOTE.indexOf(LINK_WORD)
  if (at < 0) return <>{LABELS_OFF_NOTE}</>
  return (
    <>
      {LABELS_OFF_NOTE.slice(0, at)}
      <AppLink to={{ name: 'settings', section: 'labels' }} className="inline-link" label={LABELS_SETTINGS_LINK}>
        {LINK_WORD}
      </AppLink>
      {LABELS_OFF_NOTE.slice(at + LINK_WORD.length)}
    </>
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
