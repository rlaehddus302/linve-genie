// 라벨 프린트 (D-UX4-80, 사용자 지시 2026-11-10 "프린터라벨 → 그냥 라벨 프린트 … 누르면 안에 또다른 화면에서 프린터 연결, 라벨 꾸미기 같은 메뉴를 토스 '비밀번호 · 보안'처럼.
// 방송 처음 연결할 때 라벨 연결 안 했더라도 이 설정 들어와서 다시 연결할 수 있게 … 설정 화면도 그때 화면을 그대로"):
// 흰 화면 큰 제목 + 줄들 — 라벨 뽑기(켜고 끄기) · 프린터 연결(지금 프린터) › · 라벨 꾸미기 › · 테스트 인쇄 › · 출력 상태·농도 ›.
// 프린터 연결·라벨 디자인·테스트 인쇄는 방송 시작 라벨 단계(LabelSetupScreen)의 그 화면 하나를 그대로 연다.
// D-UX4-130 (사용자 지시 2026-11-12 "라벨 프린트 화면도 마찬가지로 밖으로 빼. 라벨 꾸미기 네이밍도 라벨 디자인으로"): 라이브 관리가 이 줄들(LabelPrintRows)을
// 흰 화면 줄 모양으로 바로 그린다 — 한 단계 덜 들어간다. 이 화면(/label-print)은 옛 주소로 들어올 때만 남는다.
import { printerProfile } from '@livejjim/printer'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { isApiError, put } from '../api/client.ts'
import { useServices } from '../services.tsx'
import { BottomSheet, FormPage, ListRow, ToggleRow, Txt } from '../ui/kit/index.ts'
import { Notice } from '../ui/parts.tsx'
import { PLAIN, PlainRow } from './console/parts.tsx'
import type { LabelSetupStep } from './LabelSetupScreen.tsx'

export const LABEL_PRINT_TITLE = '라벨 프린트'
export const LABEL_PRINT_ROWS = { on: '라벨 뽑기', connect: '프린터 연결', design: '라벨 디자인', test: '테스트 인쇄', status: '출력 상태·농도' } as const
/** 라벨 뽑기 ? 설명 (흰 화면 줄에는 아래 설명 줄이 없어 ?로 — 자동 감사 채팅과 같다) */
export const LABEL_ON_HELP_TITLE = '라벨 뽑기란?'
export const LABEL_ON_HELP_BODY = '찜이 확정되면 라벨을 바로 뽑아요.\n끄면 찜은 그대로 받고 라벨만 뽑지 않아요.'

/** 라벨 프린트 줄이 여는 곳 (한 단계는 /label-setup?step=, 출력 상태·농도는 /labels) */
export interface LabelPrintNav {
  readonly openStep: (step: LabelSetupStep) => void
  readonly openStatus: () => void
}

/** 라벨 켜짐·프린터 상태와 켜고 끄기 (라벨 프린트 화면과 라이브 관리가 같이 쓴다) */
function useLabelPrint() {
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
  return { snapshot, busy, error, printerName, enabled, switchLabels }
}

/**
 * 라이브 관리 안의 라벨 줄들 (D-UX4-130): 라벨 뽑기(켜고 끄기) · 프린터 연결(지금 프린터) › · 라벨 디자인 › · 테스트 인쇄 › · 출력 상태·농도 ›.
 * 흰 화면 줄 모양(PlainRow — 토스 "비밀번호 · 보안"). 부모는 화면 끝까지 넓어야 한다.
 */
export function LabelPrintRows({ openStep, openStatus }: LabelPrintNav) {
  const { snapshot, busy, error, printerName, enabled, switchLabels } = useLabelPrint()
  const [help, setHelp] = useState(false)
  return (
    <View testID="label-print-rows">
      {error !== null ? (
        <View style={{ paddingHorizontal: PLAIN.side }}>
          <Notice tone="danger" alert>
            {error}
          </Notice>
        </View>
      ) : null}
      <View style={{ paddingHorizontal: PLAIN.side }}>
        <ToggleRow title={LABEL_PRINT_ROWS.on} titleStep="bodyLarge" titleWeight={PLAIN.weight} titleInk={PLAIN.ink} rowHeight={PLAIN.row} on={enabled} disabled={busy || snapshot.queue === null} onChange={switchLabels} onHelp={() => setHelp(true)} testID="label-print-on" />
      </View>
      <PlainRow title={LABEL_PRINT_ROWS.connect} value={printerName} testID="label-print-connect" onPress={() => openStep('connect')} />
      <PlainRow title={LABEL_PRINT_ROWS.design} testID="label-print-design" onPress={() => openStep('design')} />
      <PlainRow title={LABEL_PRINT_ROWS.test} testID="label-print-test" onPress={() => openStep('test')} />
      <PlainRow title={LABEL_PRINT_ROWS.status} testID="label-print-status" onPress={openStatus} />
      <BottomSheet visible={help} onClose={() => setHelp(false)} title={LABEL_ON_HELP_TITLE}>
        <Txt step="bodyLarge" color="textSub">{LABEL_ON_HELP_BODY}</Txt>
      </BottomSheet>
    </View>
  )
}

export function LabelPrintScreen({ onBack, openStep, openStatus }: { readonly onBack: () => void } & LabelPrintNav) {
  const { snapshot, busy, error, printerName, enabled, switchLabels } = useLabelPrint()
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
