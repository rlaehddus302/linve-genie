// 시작 안내 (D-APPX-03 — 웹 WizardPage와 같은 단계·문구, UX-02, D-I3-09, D-WIZ-01): 가게 이름 → 판매 규칙 확인 → 유튜브 → 프린터.
// 리허설 단계는 앱에서 뺐다 (D-UX3-86 — 사용자 지시 2026-11-09 "리허설 관련 기능은 일단 모든 화면에서 다 빼").
// 단계 표시는 글자("1/5 가게 이름"). 단계마다 "이전"(1단계 제외)·"다음"·"나중에 할게요". 단계를 옮기면 서버에 그 단계를 적는다(PUT /api/wizard — 실패해도 간다).
// 1단계는 이름을 바꿨을 때만 저장한다(실패하면 다음으로 가지 않는다). 2단계는 지금 규칙 여섯 줄만 보이고 바꾸기는 가게 설정에서.
// 유튜브 연결은 구글 로그인 창이라 기기 브라우저로 연다. 라벨 기능이 꺼져 있으면 프린터 단계를 건너뛴다.
// 마지막 단계(라벨이 꺼져 있으면 유튜브)의 "마치기"는 마침으로, "나중에 할게요"는 닫음으로 적는다 — 그 뒤로는 홈에 줄이 없다.
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { SaleSettings } from '@livejjim/core/settings'
import type { LabelSettings } from '@livejjim/web/src/api/print-types.ts'
import type { Shop, WizardState } from '@livejjim/web/src/api/types.ts'
import { fieldOf, valueWords, type RuleKey } from '@livejjim/web/src/lib/settings-fields.ts'
import { isApiError, put, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { openWeb } from '../lib/open-web.ts'
import { AppHeader, Appear, BigButton, Card, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { Late, useCameLate } from '../ui/late.tsx'

export const STEP_TITLES = ['가게 이름', '판매 규칙 확인', '유튜브 연결', '프린터 연결'] as const
export const START_ROW_TITLE = '시작 준비'
export const START_ROW_SUB = '가게 이름 → 판매 규칙 → 유튜브 → 프린터'
const LAST = STEP_TITLES.length
const PRINTER_STEP = 4
const RULE_LINES: readonly { readonly label: string; readonly key: RuleKey }[] = [
  { label: '대기 인원', key: 'waitlist.max' },
  { label: '1등이 취소되면', key: 'cancel.succession' },
  { label: '시청자가 채팅으로 취소하면', key: 'cancel.buyerChat' },
  { label: '가격 단위', key: 'price.unit' },
  { label: '기본 배송비', key: 'shipping.baseFee' },
  { label: '무료배송 기준', key: 'shipping.freeThreshold' },
]

/** 홈에 "시작 준비" 줄을 보일까 (웹 shouldOpenWizard와 같은 조건: 실제 방송이 없고 처음·진행 중) */
export function showsStart(wizard: WizardState | null, hasRealBroadcast: boolean): boolean {
  return !hasRealBroadcast && wizard !== null && (wizard.status === 'NEW' || wizard.status === 'IN_PROGRESS')
}

const clampStep = (step: number | null): number => (step === null || !Number.isInteger(step) ? 1 : Math.min(Math.max(step, 1), LAST))

export interface StartNavigation {
  readonly onClose: () => void
  readonly openShopSettings: () => void
  readonly openLabels: () => void
}

export function StartScreen({ nav }: { readonly nav: StartNavigation }) {
  const { p } = useKit()
  // 기억해 둔 마법사 단계·라벨 설정을 바로 쓰고 뒤에서 다시 받는다 (D-UX4-77). 단계는 처음 한 번만 정한다(누른 단계를 덮지 않게)
  const wizard = useCachedGet<{ wizard: WizardState }>('/api/wizard')
  const firstStep = wizard.data !== null ? (wizard.data.wizard.status === 'IN_PROGRESS' ? clampStep(wizard.data.wizard.step) : 1) : wizard.error !== null ? 1 : null
  const [step, setStep] = useState<number | null>(firstStep)
  useEffect(() => {
    if (firstStep !== null) setStep((current) => current ?? firstStep)
  }, [firstStep])
  const labelsOn = useCachedGet<LabelSettings>('/api/settings/labels').data?.enabled ?? null
  const record = (state: WizardState) => void put('/api/wizard', state.status === 'IN_PROGRESS' ? { status: state.status, step: state.step } : { status: state.status }).catch(() => undefined)
  // 라벨 기능이 꺼져 있으면 프린터 단계를 건너뛴다 — 유튜브가 마지막 (모르면 건너뛰지 않는다)
  const last = labelsOn === false ? PRINTER_STEP - 1 : LAST
  const go = (next: number) => {
    const target = Math.min(next, last)
    setStep(target)
    record({ status: 'IN_PROGRESS', step: target })
  }
  // 예전에 저장된 리허설 단계(5)나 꺼진 프린터 단계는 마지막 단계로 보인다
  const shown = step === null ? null : Math.min(step, last)
  const finish = () => {
    record({ status: 'DONE', step: null })
    nav.onClose()
  }
  const later = () => {
    record({ status: 'DISMISSED', step: null })
    nav.onClose()
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="start-screen">
      <AppHeader title="시작 마법사" onBack={later} backLabel="나중에 할게요" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        {shown === null ? <Loading /> : <Txt weight="bold" role="heading" aria-level={2}>{`${String(shown)}/${String(last)} ${STEP_TITLES[shown - 1] ?? ''}`}</Txt>}
        {shown === 1 ? <NameStep onNext={() => go(2)} /> : null}
        {shown === 2 ? <RulesStep onEdit={nav.openShopSettings} /> : null}
        {shown === 3 ? (
          <Card>
            <Txt>유튜브 채널을 연결하면 라이브 채팅을 받아 찜을 정해요. 구글 로그인 창은 기기 브라우저에서 열려요.</Txt>
            <BigButton label="유튜브 연결하기" onPress={() => void openWeb('/settings/youtube')} />
            <Txt step="caption" color="textSub">감사 메시지 자동 게시는 설정에서 따로 켤 수 있어요.</Txt>
          </Card>
        ) : null}
        {shown === PRINTER_STEP ? (
          <Card>
            <Txt>라벨 프린터(NIIMBOT B1)를 연결하면 1등이 정해질 때 라벨을 찍어요.</Txt>
            <BigButton label="프린터 연결하기" onPress={nav.openLabels} />
          </Card>
        ) : null}
        {shown !== null && shown !== 1 ? (
          <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
            <BigButton kind="secondary" label="이전" onPress={() => go(shown - 1)} />
            {shown < last ? <BigButton label="다음" onPress={() => go(shown + 1)} /> : <BigButton label="마치기" onPress={finish} />}
          </View>
        ) : null}
        <BigButton kind="outline" label="나중에 할게요" onPress={later} />
      </ScrollView>
    </View>
  )
}

function NameStep({ onNext }: { readonly onNext: () => void }) {
  // 기억해 둔 가게 이름을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) — 못 받으면 빈 이름. 칸은 처음 한 번만 채운다(적던 이름을 덮지 않게)
  const shop = useCachedGet<{ shop: Shop }>('/api/shop')
  const saved = shop.data !== null ? shop.data.shop.name : shop.error !== null ? '' : null
  // 적은 적이 없으면(null) 받은 이름을 그대로 보인다 — 받은 뒤 칸을 따로 채우지 않아 적던 글이 덮이지 않는다
  const [typed, setName] = useState<string | null>(null)
  const name = typed ?? saved ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  // 서버에서 받은 뒤에야 생기는 칸은 부드럽게 — 기억해 둔 이름으로 처음부터 그리면 바로 (D-UX4-112)
  const late = useCameLate(saved !== null)
  const next = async () => {
    if (busy) return
    if (saved !== null && name.trim() === saved.trim()) return onNext()
    setBusy(true)
    setError(null)
    try {
      await put('/api/shop', { name })
      void shop.reload()
      onNext()
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  if (saved === null) return <Loading />
  return (
    <Appear instant={!late}>
      <Card>
        <TextField label="가게 이름" value={name} onChangeText={setName} placeholder="초록다육" error={error?.problemFor('name')?.message ?? null} />
        {error !== null && error.problemFor('name') === undefined ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        <BigButton label="다음" busy={busy} onPress={() => void next()} />
      </Card>
    </Appear>
  )
}

function RulesStep({ onEdit }: { readonly onEdit: () => void }) {
  // 기억해 둔 규칙을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data, error } = useCachedGet<{ settings: SaleSettings }>('/api/settings')
  const settings = data?.settings ?? null
  return (
    <Card>
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {settings === null && error === null ? <Loading /> : null}
      <Late style={{ gap: SPACE.md }}>{settings !== null ? RULE_LINES.map((line) => <Txt key={line.key}>{`${line.label}: ${valueWords(fieldOf(line.key), settings)}`}</Txt>) : null}</Late>
      <Txt step="caption" color="textSub">바꾼 규칙은 다음에 시작하는 라이브부터 적용돼요.</Txt>
      <BigButton kind="outline" label="가게 설정에서 바꾸기" onPress={onEdit} />
    </Card>
  )
}
