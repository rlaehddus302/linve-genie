// 시작 마법사 3단계 — 프린터 (UX-02, D-I3-01·D-I1-06, AC-I3-53·AC-I1-21). I1의 연결 마법사·테스트 인쇄(라벨 화면의 프린터 칸)를 그대로 끼운다.
// 연결하지 않아도 "다음"·"나중에 할게요"로 넘어갈 수 있다(프린터 없이 그림 파일로도 운영한다). 연결 버튼은 이 브라우저가 실제로 할 수 있는 것만 보인다.
// 마법사 본문(WizardPage)은 이 조각을 그대로 그리고 "이전·다음·나중에 할게요"는 본문이 단다.
import { PrinterSection } from '../LabelsPage.tsx'

export const PRINTER_STEP_TEXT = '라벨 프린터(NIIMBOT B1)는 라벨·프린터 화면에서 연결하고 테스트 인쇄를 해요. 프린터가 없어도 판매·정산은 그대로 돼요.'

/** 마법사 안에서 바로 연결할 수 있다는 안내 (I1 연결 마법사를 끼운 뒤) */
export const PRINTER_STEP_HERE = '여기서 바로 연결하고 테스트 인쇄를 해 볼 수도 있어요.'

export function PrinterStep() {
  return (
    <div className="stack-tight">
      <p>{PRINTER_STEP_TEXT}</p>
      <p>{PRINTER_STEP_HERE}</p>
      <PrinterSection inWizard />
    </div>
  )
}
