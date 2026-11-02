// 시작 안내 (D-APPX-03 — 웹 WizardPage와 같은 단계·문구, UX-02, D-I3-09, D-WIZ-01): 가게 이름 → 판매 규칙 확인 → 유튜브 → 프린터 → 리허설.
// 단계 표시는 글자("1/5 가게 이름"). 단계마다 "이전"(1단계 제외)·"다음"·"나중에 할게요". 단계를 옮기면 서버에 그 단계를 적는다(PUT /api/wizard — 실패해도 간다).
// 1단계는 이름을 바꿨을 때만 저장한다(실패하면 다음으로 가지 않는다). 2단계는 지금 규칙 여섯 줄만 보이고 바꾸기는 가게 설정에서.
// 유튜브 연결은 구글 로그인 창이라 기기 브라우저로 연다. 라벨 기능이 꺼져 있으면 프린터 단계를 건너뛴다.
// "리허설 시작하기"는 리허설 방송을 만들고 마침으로 적은 뒤 방송 화면으로. "나중에 할게요"는 닫음으로 적는다 — 그 뒤로는 홈에 줄이 없다.
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { SaleSettings } from '@livejjim/core/settings'
import type { LabelSettings } from '@livejjim/web/src/api/print-types.ts'
import type { Shop, WizardState, WriteResult } from '@livejjim/web/src/api/types.ts'
import { fieldOf, valueWords, type RuleKey } from '@livejjim/web/src/lib/settings-fields.ts'
import { get, isApiError, newRequestId, post, put, withRetry, type ApiError } from '../api/client.ts'
import { openWeb } from '../lib/open-web.ts'
import { AppHeader, BigButton, Card, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'

export const STEP_TITLES = ['가게 이름', '판매 규칙 확인', '유튜브 연결', '프린터 연결', '리허설 해 보기'] as const
export const REHEARSAL_INVITE = '리허설로 연습해 볼까요? 가짜 채팅으로 상품 등록부터 1등 확정까지 해 볼 수 있어요. 진짜 유튜브에는 아무것도 올라가지 않아요.'
export const START_ROW_TITLE = '시작 준비'
export const START_ROW_SUB = '가게 이름 → 판매 규칙 → 유튜브 → 프린터 → 리허설'
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
  readonly openConsole: (id: string) => void
}

export function StartScreen({ nav }: { readonly nav: StartNavigation }) {
  const { p } = useKit()
  const [step, setStep] = useState<number | null>(null)
  const [labelsOn, setLabelsOn] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    get<{ wizard: WizardState }>('/api/wizard').then(
      ({ wizard }) => {
        if (alive) setStep((current) => current ?? (wizard.status === 'IN_PROGRESS' ? clampStep(wizard.step) : 1))
      },
      () => {
        if (alive) setStep((current) => current ?? 1)
      },
    )
    get<LabelSettings>('/api/settings/labels').then(
      (settings) => {
        if (alive) setLabelsOn(settings.enabled)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])
  const record = (state: WizardState) => void put('/api/wizard', state.status === 'IN_PROGRESS' ? { status: state.status, step: state.step } : { status: state.status }).catch(() => undefined)
  const go = (next: number) => {
    // 라벨 기능이 꺼져 있으면 프린터 단계를 건너뛴다 (모르면 건너뛰지 않는다)
    const target = next === PRINTER_STEP && labelsOn === false ? (step !== null && step > PRINTER_STEP ? PRINTER_STEP - 1 : PRINTER_STEP + 1) : next
    setStep(target)
    record({ status: 'IN_PROGRESS', step: target })
  }
  const later = () => {
    record({ status: 'DISMISSED', step: null })
    nav.onClose()
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="start-screen">
      <AppHeader title="시작 마법사" onBack={later} backLabel="나중에 할게요" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        {step === null ? <Loading /> : <Txt weight="bold" role="heading" aria-level={2}>{`${String(step)}/${String(LAST)} ${STEP_TITLES[step - 1] ?? ''}`}</Txt>}
        {step === 1 ? <NameStep onNext={() => go(2)} /> : null}
        {step === 2 ? <RulesStep onEdit={nav.openShopSettings} /> : null}
        {step === 3 ? (
          <Card>
            <Txt>유튜브 채널을 연결하면 방송 채팅을 받아 찜을 정해요. 구글 로그인 창은 기기 브라우저에서 열려요.</Txt>
            <BigButton label="유튜브 연결하기" onPress={() => void openWeb('/settings/youtube')} />
            <Txt step="caption" color="textSub">감사 메시지 자동 게시는 설정에서 따로 켤 수 있어요.</Txt>
          </Card>
        ) : null}
        {step === 4 ? (
          <Card>
            <Txt>라벨 프린터(NIIMBOT B1)를 연결하면 1등이 정해질 때 라벨을 찍어요.</Txt>
            <BigButton label="프린터 연결하기" onPress={nav.openLabels} />
          </Card>
        ) : null}
        {step === 5 ? <RehearsalStep onDone={(id) => nav.openConsole(id)} onFinish={() => {
          record({ status: 'DONE', step: null })
          nav.onClose()
        }} /> : null}
        {step !== null && step !== 1 ? (
          <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
            <BigButton kind="secondary" label="이전" onPress={() => go(step - 1)} />
            {step < LAST ? <BigButton label="다음" onPress={() => go(step + 1)} /> : null}
          </View>
        ) : null}
        <BigButton kind="outline" label="나중에 할게요" onPress={later} />
      </ScrollView>
    </View>
  )
}

function NameStep({ onNext }: { readonly onNext: () => void }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    let alive = true
    get<{ shop: Shop }>('/api/shop').then(
      ({ shop }) => {
        if (!alive) return
        setSaved(shop.name)
        setName(shop.name)
      },
      () => {
        if (alive) setSaved('')
      },
    )
    return () => {
      alive = false
    }
  }, [])
  const next = async () => {
    if (busy) return
    if (saved !== null && name.trim() === saved.trim()) return onNext()
    setBusy(true)
    setError(null)
    try {
      await put('/api/shop', { name })
      onNext()
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  if (saved === null) return <Loading />
  return (
    <Card>
      <TextField label="가게 이름" value={name} onChangeText={setName} placeholder="초록다육" error={error?.problemFor('name')?.message ?? null} />
      {error !== null && error.problemFor('name') === undefined ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      <BigButton label="다음" busy={busy} onPress={() => void next()} />
    </Card>
  )
}

function RulesStep({ onEdit }: { readonly onEdit: () => void }) {
  const [settings, setSettings] = useState<SaleSettings | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    let alive = true
    get<{ settings: SaleSettings }>('/api/settings').then(
      (result) => {
        if (alive) setSettings(result.settings)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return (
    <Card>
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {settings === null && error === null ? <Loading /> : null}
      {settings !== null ? RULE_LINES.map((line) => <Txt key={line.key}>{`${line.label}: ${valueWords(fieldOf(line.key), settings)}`}</Txt>) : null}
      <Txt step="caption" color="textSub">바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.</Txt>
      <BigButton kind="outline" label="가게 설정에서 바꾸기" onPress={onEdit} />
    </Card>
  )
}

function RehearsalStep({ onDone, onFinish }: { readonly onDone: (id: string) => void; readonly onFinish: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [requestId] = useState(newRequestId)
  const start = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId, rehearsal: true }))
      await put('/api/wizard', { status: 'DONE' }).catch(() => undefined)
      if (created.broadcast !== undefined) onDone(created.broadcast.id)
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <Txt>{REHEARSAL_INVITE}</Txt>
      <BigButton label="리허설 시작하기" busy={busy} onPress={() => void start()} />
      <BigButton kind="outline" label="마치기" onPress={onFinish} />
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
    </Card>
  )
}
