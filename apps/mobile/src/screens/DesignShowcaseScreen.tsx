// 디자인 견본 (개발 모드 전용): 공통 컴포넌트를 한 화면에 모아 놓고 밝게/어둡게·글자 2배로 바꿔 본다.
import { useState } from 'react'
import {
  BigButton,
  BottomCTA,
  BottomSheet,
  Card,
  ConfirmSheet,
  EmptyState,
  KitScreen,
  ListRow,
  NumberPad,
  Section,
  StatusChip,
  TextField,
  Toast,
  ThemeOverrideProvider,
  ToggleRow,
  Txt,
  useKit,
  useToast,
  type Scheme,
} from '../ui/kit/index.ts'

export function DesignShowcaseScreen() {
  const [scheme, setScheme] = useState<Scheme | undefined>(undefined)
  const [big, setBig] = useState(false)
  return (
    <ThemeOverrideProvider scheme={scheme} fontScale={big ? 2 : undefined}>
      <Showcase scheme={scheme} setScheme={setScheme} big={big} setBig={setBig} />
    </ThemeOverrideProvider>
  )
}

function Showcase({ scheme, setScheme, big, setBig }: { readonly scheme: Scheme | undefined; readonly setScheme: (next: Scheme | undefined) => void; readonly big: boolean; readonly setBig: (next: boolean) => void }) {
  const kit = useKit()
  const { toast, show, hide } = useToast()
  const [sheet, setSheet] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [on, setOn] = useState(true)
  const nameError = name.length > 0 && name.length < 2 ? '이름을 두 글자 이상 적어 주세요.' : null
  return (
    <>
      <KitScreen
        testID="design-showcase"
        title="디자인 견본"
        lead="개발할 때만 보여요. 모든 공통 조각을 여기서 확인해요."
        footer={
          <BottomCTA note="화면 맨 아래 고정 버튼 — 홈 막대를 피해요">
            <BigButton kind="secondary" label="알림 막대 보기" onPress={() => show('저장했어요.', { actionLabel: '되돌리기', onAction: () => show('되돌렸어요.') })} />
            <BigButton label="다음으로" onPress={() => undefined} />
          </BottomCTA>
        }
      >
        <Section title="보기 방식">
          <Card>
            <ToggleRow title="어두운 화면" on={kit.scheme === 'dark'} onChange={(next) => setScheme(next ? 'dark' : 'light')} />
            <ToggleRow title="글자 2배로 보기" on={big} onChange={setBig} />
            {scheme === undefined ? null : <BigButton kind="secondary" label="기기 설정 따르기" onPress={() => setScheme(undefined)} />}
          </Card>
        </Section>
        <Section title="큰 버튼">
          <Card>
            <BigButton label="주 버튼" onPress={() => undefined} />
            <BigButton kind="secondary" label="보조 버튼" onPress={() => undefined} />
            <BigButton kind="danger" label="위험 버튼" onPress={() => undefined} />
            <BigButton label="처리하는 중" busy onPress={() => undefined} />
            <BigButton label="누를 수 없어요" disabled onPress={() => undefined} />
          </Card>
        </Section>
        <Section title="상태 꼬리표" description="색만으로 알리지 않고 기호와 글자를 함께 써요.">
          <Card>
            <StatusChip tone="success" label="결제 완료" />
            <StatusChip tone="warning" label="입금 기다려요" />
            <StatusChip tone="danger" label="확인이 필요해요" />
            <StatusChip tone="info" label="새 소식" />
            <StatusChip tone="neutral" label="대기 중" />
          </Card>
        </Section>
        <Section title="줄">
          <Card>
            <ListRow title="오늘 방송" subtitle="저녁 7시 시작" value="12명" onPress={() => undefined} />
            <ListRow title="받은 돈" value="124,000원" />
            <ToggleRow title="소리로 알려 주기" subtitle="새 찜이 들어오면 알려요." on={on} onChange={setOn} />
          </Card>
        </Section>
        <Section title="입력">
          <Card>
            <TextField label="손님 이름" help="닉네임 그대로 적어도 돼요." value={name} onChangeText={setName} error={nameError} placeholder="예: 다육사랑" />
            <TextField label="가격" unit="원" value={amount} editable={false} placeholder="숫자판으로 눌러요" />
            <NumberPad value={amount} onChange={setAmount} maxLength={7} />
          </Card>
        </Section>
        <Section title="판">
          <Card>
            <BigButton kind="secondary" label="아래 판 열기" onPress={() => setSheet(true)} />
            <BigButton kind="secondary" label="확인 질문 열기" onPress={() => setConfirm(true)} />
          </Card>
        </Section>
        <Section title="비어 있을 때">
          <Card>
            <EmptyState icon="🌱" title="아직 찜이 없어요" description="방송이 시작되면 여기에 손님 찜이 모여요." actionLabel="방송 시작하기" onAction={() => undefined} />
          </Card>
        </Section>
        <Txt step="caption" color="textSub">
          {`지금: ${kit.scheme === 'dark' ? '어두운' : '밝은'} 화면 · 글자 ${String(kit.fontScale)}배`}
        </Txt>
      </KitScreen>
      <Toast toast={toast} onDismiss={hide} bottomOffset={190} />
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title="어떤 걸 고를까요?">
        <ListRow title="오늘 방송" onPress={() => setSheet(false)} />
        <ListRow title="지난 방송" onPress={() => setSheet(false)} />
      </BottomSheet>
      <ConfirmSheet visible={confirm} question="이 찜을 취소할까요?" description="취소하면 다음 손님께 순서가 넘어가요." confirmLabel="찜 취소하기" danger onCancel={() => setConfirm(false)} onConfirm={() => setConfirm(false)} />
    </>
  )
}
