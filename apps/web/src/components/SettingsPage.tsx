// 설정 화면 `/settings` (SPEC §7 화면 8, N4a AC-N4a-10, D-N4a-05). 위 줄 오른쪽 "설정" 링크로 연다.
// 지금은 "라벨" 절 하나다 — 판매 규칙·배송비·감사 메시지·유튜브 연결 등은 I3이, 다른 병렬 트랙(N5 요금제 등)도 절을 더한다.
// 절마다 독립 컴포넌트로 두고 이 화면은 차례대로 늘어놓기만 한다(합칠 때 겹치지 않게). 이 화면에 주 버튼은 없다.
import { LabelSwitchSection } from './LabelSwitchSection.tsx'

export function SettingsPage() {
  return (
    <main className="page settings-page">
      <h1>설정</h1>
      <LabelSwitchSection />
    </main>
  )
}
