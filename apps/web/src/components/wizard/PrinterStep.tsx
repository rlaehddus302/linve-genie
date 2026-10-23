// 시작 마법사 4단계 — 프린터 (UX-02, D-I3-01·D-I1-06·D-WIZ-01, AC-I3-53·AC-I1-21). I1의 연결 마법사·테스트 인쇄(라벨 화면의 프린터 칸)를 그대로 끼운다.
// 연결하지 않아도 "다음"·"나중에 할게요"로 넘어갈 수 있다(프린터 없이 그림 파일로도 운영한다). 연결 버튼은 이 브라우저가 실제로 할 수 있는 것만 보인다.
// 마법사 본문(WizardPage)은 이 조각을 그대로 그리고 "이전·다음·나중에 할게요"는 본문이 단다.
// 라벨 기능이 꺼져 있으면 연결 칸 대신 "라벨 쓰지 않음" 안내만 보이고, 켬/끔을 아직 모르면 연결 칸을 보이지 않는다(N4a L-13 9, D-N4a-05).
// PL1B(UX-02·RCP-01, D-PL1-06, AC-PL1B-16~18): 라벨 켜짐이면 연결 칸 아래 보통 버튼 "라벨을 쓰지 않아요"와 안내 한 줄.
//   누르면 확인 창 없이 `PUT /api/settings/labels { enabled: false }` 하나(설정 화면의 끄기와 같은 저장 — 같은 바꾼 기록·같은 알림).
//   보내는 동안 이 버튼과 "다음"이 잠긴다(buttons에 busy를 넘긴다). 성공하면 onLabelsOff(본문이 5/5로 옮긴다), 실패하면 이 단계에 머물고 문장을 보인다.
//   "나중에 할게요"(마법사를 닫는다)와 다르다 — 이 버튼은 라벨 기능을 끈다.
import { useState, type ReactNode } from 'react'
import { isApiError, type ApiError } from '../../api/client.ts'
import { RequestError } from '../ErrorNote.tsx'
import { LabelsOffNote } from '../LabelsOff.tsx'
import { PrinterSection } from '../LabelsPage.tsx'
import { useLabelsEnabled, usePrintApi } from '../print-context.tsx'

export const PRINTER_STEP_TEXT = '라벨 프린터(NIIMBOT B1)는 라벨·프린터 화면에서 연결하고 테스트 인쇄를 해요. 프린터가 없어도 판매·정산은 그대로 돼요.'

/** 마법사 안에서 바로 연결할 수 있다는 안내 (I1 연결 마법사를 끼운 뒤) */
export const PRINTER_STEP_HERE = '여기서 바로 연결하고 테스트 인쇄를 해 볼 수도 있어요.'

/** 라벨을 쓰지 않는 판매자의 길 (D-PL1-06) */
export const NO_LABELS_BUTTON = '라벨을 쓰지 않아요'
export const NO_LABELS_HINT = '라벨 없이 팔아요. 설정에서 언제든 다시 켤 수 있어요.'

export interface PrinterStepProps {
  /** 라벨 끄기가 저장된 뒤 (본문이 다음 단계로 옮긴다) */
  readonly onLabelsOff?: () => void
  /** 단계 버튼(이전·다음·나중에 할게요) — 끄는 중이면 busy (다음을 잠근다) */
  readonly buttons?: (busy: boolean) => ReactNode
}

export function PrinterStep({ onLabelsOff, buttons }: PrinterStepProps = {}) {
  const labels = useLabelsEnabled()
  const api = usePrintApi()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<ApiError | null>(null)

  const turnOff = async () => {
    if (api === null || busy) return
    setBusy(true)
    setFailed(null)
    try {
      await api.store.saveLabelsEnabled(false)
      setBusy(false)
      onLabelsOff?.()
    } catch (caught) {
      setBusy(false)
      if (!isApiError(caught)) throw caught
      setFailed(caught)
    }
  }

  if (labels === false) {
    return (
      <>
        <div className="stack-tight">
          <p>{PRINTER_STEP_TEXT}</p>
          <LabelsOffNote />
        </div>
        {buttons?.(busy)}
      </>
    )
  }
  return (
    <>
      <div className="stack-tight">
        <p>{PRINTER_STEP_TEXT}</p>
        {labels === true ? (
          <>
            <p>{PRINTER_STEP_HERE}</p>
            <PrinterSection inWizard />
            {onLabelsOff !== undefined ? (
              <div className="stack-tight">
                <div className="row">
                  <button type="button" className="button" disabled={busy || api === null} onClick={() => void turnOff()}>
                    {NO_LABELS_BUTTON}
                  </button>
                </div>
                <p className="hint">{NO_LABELS_HINT}</p>
                {failed !== null ? <RequestError error={failed} /> : null}
              </div>
            ) : null}
          </>
        ) : (
          <p role="status">불러오는 중…</p>
        )}
      </div>
      {buttons?.(busy)}
    </>
  )
}
