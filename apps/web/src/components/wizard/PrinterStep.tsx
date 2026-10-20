// 시작 마법사 3단계 — 프린터 (UX-02, D-I3-01, AC-I3-53). I1(라벨·프린터)을 합칠 때 오케스트레이터가 이 조각을 I1의 연결 마법사·테스트 인쇄로 바꾼다.
// 지금은 설명만 — 프린터가 연결됐다고 말하거나 연결 버튼을 흉내 내지 않고, 프린터 장치 기능(블루투스·시리얼)을 부르지 않는다.
// 마법사 본문(WizardPage)은 이 조각을 그대로 그리고 "이전·다음·나중에 할게요"는 본문이 단다 — 이 파일만 바꾸면 된다.
export const PRINTER_STEP_TEXT = '라벨 프린터(NIIMBOT B1)는 라벨·프린터 화면에서 연결하고 테스트 인쇄를 해요. 프린터가 없어도 판매·정산은 그대로 돼요.'

export function PrinterStep() {
  return (
    <div className="stack-tight">
      <p>{PRINTER_STEP_TEXT}</p>
    </div>
  )
}
