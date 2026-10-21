// 시작 마법사 3단계 — 프린터 (UX-02, D-I3-01·D-I1-06, AC-I3-53·AC-I1-21). I1의 연결 마법사·테스트 인쇄(라벨 화면의 프린터 칸)를 그대로 끼운다.
// 연결하지 않아도 "다음"·"나중에 할게요"로 넘어갈 수 있다(프린터 없이 그림 파일로도 운영한다). 연결 버튼은 이 브라우저가 실제로 할 수 있는 것만 보인다.
// 마법사 본문(WizardPage)은 이 조각을 그대로 그리고 "이전·다음·나중에 할게요"는 본문이 단다.
// 라벨 기능이 꺼져 있으면 연결 칸 대신 "라벨 쓰지 않음" 안내만 보이고, 켬/끔을 아직 모르면 연결 칸을 보이지 않는다(N4a L-13 9, D-N4a-05).
import { LabelsOffNote } from '../LabelsOff.tsx'
import { PrinterSection } from '../LabelsPage.tsx'
import { useLabelsEnabled } from '../print-context.tsx'

export const PRINTER_STEP_TEXT = '라벨 프린터(NIIMBOT B1)는 라벨·프린터 화면에서 연결하고 테스트 인쇄를 해요. 프린터가 없어도 판매·정산은 그대로 돼요.'

/** 마법사 안에서 바로 연결할 수 있다는 안내 (I1 연결 마법사를 끼운 뒤) */
export const PRINTER_STEP_HERE = '여기서 바로 연결하고 테스트 인쇄를 해 볼 수도 있어요.'

export function PrinterStep() {
  const labels = useLabelsEnabled()
  if (labels === false) {
    return (
      <div className="stack-tight">
        <p>{PRINTER_STEP_TEXT}</p>
        <LabelsOffNote />
      </div>
    )
  }
  return (
    <div className="stack-tight">
      <p>{PRINTER_STEP_TEXT}</p>
      {labels === true ? (
        <>
          <p>{PRINTER_STEP_HERE}</p>
          <PrinterSection inWizard />
        </>
      ) : (
        <p role="status">불러오는 중…</p>
      )}
    </div>
  )
}
