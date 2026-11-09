// 방송 관리 (D-UX4-20 → D-UX4-57): 토스 설정 화면처럼 굵은 묶음 이름 · 흰 카드 · 줄 이름만.
// 방송 화면 위 진짜 쌓인 화면(app/console/[id]/manage)과, 경로가 없을 때(시험·웹) 방송 화면 안 겹친 화면이 같이 쓴다.
// 여기서 여는 아래 창(음성 설정·상품 미리 등록·화면 아래 창)도 이 안에 있다.
import { useState } from 'react'
import { View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { DOCK_CHOICES, DOCK_DESCRIPTION, DOCK_TITLE, dockLabel, setDockChoice, useDockChoice } from '../../lib/dock-choice.ts'
import { BigButton, BottomSheet, FullSheet, SheetChoices, ToggleRow, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { LABEL_PRINT_TITLE } from '../LabelPrintScreen.tsx'
import { useConsoleApi } from './context.ts'
import { APP_IMPORT_TITLE, ImportView } from './ImportSheet.tsx'
import { PLAIN, PlainRow, PlainTitle } from './parts.tsx'
import type { StreamAudio } from './StreamAudio.tsx'

/** 머리 오른쪽 "관리" 단추·방송 관리 화면 이름 (D-UX4-42) — 화면에는 "관리", 읽기 이름은 "방송 관리" */
export const MANAGE_LABEL = '라이브 관리'

/** 방송 연결 줄 이름 — 그 안 맨 아래에 "방송 연결 끊기"(D-UX4-79) */
export const LINK_TITLE = '라이브 연결'
/** 라벨 프린트 줄 이름 (D-UX4-80, 사용자 지시 2026-11-10 — 옛 "프린터·라벨") — 그 화면 제목과 같다 */
export { LABEL_PRINT_TITLE }

/** 감사 채팅 스위치 이름 (D-UX4-63, 사용자 지시 2026-11-10 — 옛 "감사 채팅") */
export const THANKS_TITLE = '자동 감사 채팅'
/** ? 를 누르면 올라오는 설명 판 (D-UX4-64) — 한 문장에 한 줄 */
export const THANKS_HELP_TITLE = '자동 감사 채팅이란?'
export const THANKS_HELP_BODY = '찜이 1등으로 정해지면 유튜브 라이브 채팅에 감사 인사를 대신 올려요.\n손님은 채팅만 보고도 내 찜이 잡혔는지 바로 알 수 있어요.\n연습 라이브에서는 올리지 않아요.'
/** 설명 판의 예시 채팅 (실제로 올리는 감사 문구 꼴 — core format 감사 문구와 같다) */
export const THANKS_EXAMPLE = { buyer: '홍길동', order: '15', thanks: '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다' } as const

/**
 * 감사 채팅 스위치 (D-YT-SRV-24 → D-UX4-20 스위치로 → D-UX4-63·64): 이름은 "자동 감사 채팅", 이름 옆 ? — 그 자리를 누르면 꾸욱 눌리고 아래에서 설명 판이 올라온다.
 * 켜고 끈 결과 줄은 띄우지 않는다(스위치가 지금 상태를 보인다). 바꾸지 못했을 때만 빨간 줄.
 */
export function ThanksSwitch({ on, busy, onPress }: { readonly on: boolean; readonly busy: boolean; readonly onPress: (next: boolean) => void }) {
  const [help, setHelp] = useState(false)
  return (
    <View style={{ paddingHorizontal: PLAIN.side }}>
      {/* 다른 줄과 같은 글자(17 · 보통 · #4F545E — D-UX4-94) */}
      <ToggleRow title={THANKS_TITLE} titleStep="bodyLarge" titleWeight={PLAIN.weight} titleInk={PLAIN.ink} rowHeight={PLAIN.toggleRow} on={on} disabled={busy} testID="thanks-switch" onChange={onPress} onHelp={() => setHelp(true)} />
      <BottomSheet visible={help} onClose={() => setHelp(false)} title={THANKS_HELP_TITLE} actions={<BigButton label="확인" onPress={() => setHelp(false)} />}>
        <Txt step="bodyLarge" color="textSub">{THANKS_HELP_BODY}</Txt>
        <ThanksExample />
      </BottomSheet>
    </View>
  )
}

/** 예시 그림: 손님이 "15"라고 치면 바로 아래에 감사 인사가 올라간 유튜브 채팅 두 줄 (사용자 사진 3 참고) */
function ThanksExample() {
  const { p } = useKit()
  const line = (who: string, text: string, mine: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? p.primary : p.soft }}>
        <Txt step="caption" weight="bold" color={mine ? 'onPrimary' : 'textSub'}>{who.slice(0, 1)}</Txt>
      </View>
      <View style={{ flex: 1, paddingTop: 4 }}>
        <Txt step="meta">
          <Txt step="meta" weight="bold" color="textSub">{`@${who}`}</Txt>
          {'  '}
          {text}
        </Txt>
      </View>
    </View>
  )
  return (
    <View role="img" aria-label={`예시: 손님 ${THANKS_EXAMPLE.buyer}님이 ${THANKS_EXAMPLE.order}라고 치면 내 채널로 "${THANKS_EXAMPLE.thanks}"가 올라가요`} testID="thanks-example" style={{ marginTop: SPACE.sm, padding: SPACE.lg, gap: SPACE.md, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
      {line(THANKS_EXAMPLE.buyer, THANKS_EXAMPLE.order, false)}
      {line('내 채널', THANKS_EXAMPLE.thanks, true)}
    </View>
  )
}

type ManageSheet = 'none' | 'import' | 'dock'

/** 관리에서 여는 설정 하나 (D-UX4-60 — 경로가 있으면 진짜 전체 화면) */
export type ManageTool = 'import'

/**
 * 묶음 (D-UX4-78, 사용자 지시 2026-11-10 "방송 관리 안에 '방송' 묶음은 방송 안에 방송 관리 느낌"): 무엇을 하는지로 나눈다 —
 * 라이브 채팅(방송 연결 · 자동 감사 채팅) · 듣기(휴대폰 마이크 · 음성 설정) · 상품·라벨(상품 미리 등록 · 라벨 프린트) · 화면(화면 아래 창).
 * 문자찜 직접 넣기·댓글 붙여넣기·채팅 보기(채팅·문자 탭과 겹침 — D-UX4-84)는 없앴고, 방송 끝내기는 방송 연결 안 "방송 연결 끊기"로 옮겼다(D-UX4-79).
 * canLink: 유튜브 상태를 받았는지 — 끝나지 않은 방송이면 받지 못했어도 방송 연결 줄을 보인다(그 안에서 연결을 끊는다).
 * onClose: 이 화면을 닫는다(듣기 켜기·끄기는 방송 화면에서 안내·상태를 보여 주므로 닫고 한다, D-UX3-73).
 */
export function ConsoleManage({ broadcastId, seller, rehearsal, closed, canLink, stream, onClose, onShowLink, onOpenLabels, openTool }: { readonly broadcastId: string; readonly seller: boolean; readonly title: string; readonly rehearsal: boolean; readonly closed: boolean; readonly canLink: boolean; readonly stream: StreamAudio; readonly onClose: () => void; readonly onShowLink: () => void; readonly onOpenLabels?: () => void; readonly openTool?: (tool: ManageTool) => void }) {
  const api = useConsoleApi()
  const [sheet, setSheet] = useState<ManageSheet>('none')
  const [thanksBusy, setThanksBusy] = useState(false)
  const [thanksError, setThanksError] = useState<string | null>(null)
  const close = () => setSheet('none')
  const dock = useDockChoice()
  // 설정 하나하나는 진짜 전체 화면으로 (D-UX4-60) — 경로가 없을 때(시험·웹)만 이 화면 위 판으로
  const show = (tool: ManageTool) => (openTool === undefined ? setSheet(tool) : openTool(tool))
  const thanksOn = api.data.broadcasts.get(broadcastId)?.settings['thanks.liveChat'] === true
  const switchThanks = (next: boolean) => {
    setThanksBusy(true)
    setThanksError(null)
    // 켜고 끈 결과 줄은 띄우지 않는다 (D-UX4-63) — 바꾸지 못했을 때만 빨간 줄
    api.command({ type: 'broadcast.thanks', b: broadcastId, liveChat: next }).then(
      () => undefined,
      (caught: unknown) => setThanksError(isApiError(caught) ? caught.message : '바꾸지 못했어요. 다시 눌러 주세요.'),
    ).finally(() => setThanksBusy(false))
  }
  const showLink = canLink || !closed
  const showThanks = seller && !closed && !rehearsal
  const showImport = seller && !closed
  const showLabels = onOpenLabels !== undefined && !rehearsal
  return (
    // 흰 바탕에 묶음·묶음 이름 없이 줄만 (D-UX4-94 — 토스 "비밀번호 · 보안"). 화면 끝까지 넓혀 줄 글자를 화면 끝에서 24에 둔다
    <View style={{ marginHorizontal: -SPACE.lg }}>
      <PlainTitle title={MANAGE_LABEL} />
      {thanksError !== null ? <View style={{ paddingHorizontal: PLAIN.side }}><Notice tone="danger" alert>{thanksError}</Notice></View> : null}
      {showLink ? <PlainRow title={LINK_TITLE} onPress={onShowLink} /> : null}
      {/* 방송 중 감사 채팅 켜기·끄기 (D-YT-SRV-24) — 실제 방송만(리허설은 유튜브에 아무것도 올리지 않는다) */}
      {showThanks ? <ThanksSwitch on={thanksOn} busy={thanksBusy} onPress={switchThanks} /> : null}
      {/* 휴대폰 마이크로 듣기·음성 설정은 없앴다 (D-UX4-94, 사용자 지시 "듣기 섹션에 있는 기능 필요없으니 지워") — 라이브 소리가 멈췄을 때 다시 켜기만 */}
      {seller && !closed && stream.status?.phase === 'stopped' ? <PlainRow title="라이브 소리 다시 켜기" onPress={() => { onClose(); stream.retry() }} /> : null}
      {/* 방송 전 상품 미리 등록 (PRD-05 앱, D-V3-128) */}
      {showImport ? <PlainRow title={APP_IMPORT_TITLE} onPress={() => show('import')} /> : null}
      {/* 라벨 프린트 (D-UX4-80 — 옛 "프린터·라벨"): 프린터 연결·라벨 꾸미기·테스트 인쇄를 고르는 화면 */}
      {showLabels ? <PlainRow title={LABEL_PRINT_TITLE} onPress={onOpenLabels} /> : null}
      {/* 라이브 화면 맨 아래 창 (D-UX4-71) */}
      <PlainRow title={DOCK_TITLE} value={dockLabel(dock)} testID="dock-choice" onPress={() => setSheet('dock')} />

      <FullSheet visible={sheet === 'import'} onClose={close} name={APP_IMPORT_TITLE} title={APP_IMPORT_TITLE}>
        {sheet === 'import' ? <ImportView /> : null}
      </FullSheet>
      <BottomSheet visible={sheet === 'dock'} onClose={close} title={DOCK_TITLE} description={DOCK_DESCRIPTION}>
        {/* 토스식 고르기 목록 (D-UX4-76 아래 창 SheetChoices) */}
        <SheetChoices label={DOCK_TITLE} choices={DOCK_CHOICES} value={dock} onPick={(next) => { setDockChoice(next); close() }} />
      </BottomSheet>
    </View>
  )
}
