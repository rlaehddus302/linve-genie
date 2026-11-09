// 라벨 프린트 (D-UX4-80, 사용자 지시 2026-11-10 "프린터라벨 → 그냥 라벨 프린트 … 누르면 안에 또다른 화면에서 프린터 연결, 라벨 꾸미기 같은 메뉴를 토스 '비밀번호 · 보안'처럼.
// 방송 처음 연결할 때 라벨 연결 안 했더라도 이 설정 들어와서 다시 연결할 수 있게 … 설정 화면도 그때 화면을 그대로"):
// 흰 화면 큰 제목 + 줄들 — 라벨 뽑기(켜고 끄기) · 프린터 연결(지금 프린터) › · 라벨 꾸미기 › · 테스트 인쇄 › · 출력 상태·농도 ›.
// 프린터 연결·라벨 꾸미기·테스트 인쇄는 방송 시작 라벨 단계(LabelSetupScreen)의 그 화면 하나를 그대로 연다.
import { printerProfile } from '@livejjim/printer'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { isApiError, put } from '../api/client.ts'
import { useServices } from '../services.tsx'
import { FormPage, ListRow, ToggleRow } from '../ui/kit/index.ts'
import { Notice } from '../ui/parts.tsx'
import type { LabelSetupStep } from './LabelSetupScreen.tsx'

export const LABEL_PRINT_TITLE = '라벨 프린트'
export const LABEL_PRINT_ROWS = { on: '라벨 뽑기', connect: '프린터 연결', design: '라벨 꾸미기', test: '테스트 인쇄', status: '출력 상태·농도' } as const

export function LabelPrintScreen({ onBack, openStep, openStatus }: { readonly onBack: () => void; readonly openStep: (step: LabelSetupStep) => void; readonly openStatus: () => void }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [busy, setBusy] = useState(false)
  // 들어오면 라벨 켜짐·프린터 상태를 다시 받는다
  useEffect(() => {
    void labels.reload().catch(() => undefined)
  }, [labels])
  const [error, setError] = useState<string | null>(null)
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const printerName = linked ? ((snapshot.profileId === null ? undefined : printerProfile(snapshot.profileId))?.displayName ?? (snapshot.target === 'test' ? '시험용 프린터' : '라벨 프린터')) : '연결 안 됨'
  const enabled = snapshot.queue?.labelsEnabled === true
  const switchLabels = (next: boolean) => {
    setBusy(true)
    setError(null)
    put('/api/settings/labels', { enabled: next })
      .then(() => labels.reload())
      .catch((caught: unknown) => setError(isApiError(caught) ? caught.message : '바꾸지 못했어요. 다시 눌러 주세요.'))
      .finally(() => setBusy(false))
  }
  return (
    <FormPage title={LABEL_PRINT_TITLE} onBack={onBack} testID="label-print">
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      <View>
        <ToggleRow title={LABEL_PRINT_ROWS.on} subtitle="찜이 확정되면 라벨을 바로 뽑아요" on={enabled} disabled={busy || snapshot.queue === null} onChange={switchLabels} testID="label-print-on" />
        <ListRow title={LABEL_PRINT_ROWS.connect} value={printerName} testID="label-print-connect" onPress={() => openStep('connect')} />
        <ListRow title={LABEL_PRINT_ROWS.design} testID="label-print-design" onPress={() => openStep('design')} />
        <ListRow title={LABEL_PRINT_ROWS.test} testID="label-print-test" onPress={() => openStep('test')} />
        <ListRow title={LABEL_PRINT_ROWS.status} testID="label-print-status" onPress={openStatus} />
      </View>
    </FormPage>
  )
}
