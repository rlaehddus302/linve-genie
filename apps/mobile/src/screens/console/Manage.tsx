// 방송 관리 (D-UX4-20 → D-UX4-57): 토스 설정 화면처럼 굵은 묶음 이름 · 흰 카드 · 줄 이름만.
// 방송 화면 위 진짜 쌓인 화면(app/console/[id]/manage)과, 경로가 없을 때(시험·웹) 방송 화면 안 겹친 화면이 같이 쓴다.
// 여기서 여는 아래 창(화면 아래 창)도 이 안에 있다.
// D-UX4-130 (사용자 지시 2026-11-12 "상품 미리 등록 기능 제거해. 라이브 연결 안에 있는 것들 모두 바깥에 있는 라이브 관리 화면으로 꺼내(뎁스 줄이는 의도)
// 라벨 프린트 화면도 마찬가지로 밖으로 빼"): 이은 라이브 정보(플랫폼·채널·라이브 제목)·라이브 바로가기·채팅 다시 받기·라이브 연결 끊기와
// 라벨 줄(라벨 출력·프린터 연결·라벨 디자인·테스트 인쇄)을 이 화면에 바로 둔다. 아직 잇지 않았으면 "라이브 연결 ›"(잇는 화면)만 남는다.
// D-MANAGE-01 (사용자 지시 2026-11-23): 묶음 "라이브 정보"(제목·바로가기, 바로가기 아래 "연결 끊기" — 옛 "방송 종료" 묶음은 없앰) · "채팅·음성"
// (채팅·음성 인식 잠깐 멈추기 · 닉네임 뒤 영문 숨기기(? 설명) · 찜 감사 채팅 · 찜 감사 채팅 양식 › · 도우미 창 ›) · "라벨·프린터".
// 없앤 줄: 올라간 감사 채팅(상품·찜을 고치면 저절로 고친다 — D-RETRO-105) · 소리 듣기(늘 휴대폰 마이크 — D-LISTEN-MIC-01) · 직접 인쇄·출력 내역(라이브 화면 라벨 탭에 있다) · 출력 상태·농도.
import { useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { useServices } from '../../services.tsx'
import { isApiError, put } from '../../api/client.ts'
import { DOCK_CHOICES, DOCK_DESCRIPTION, DOCK_TITLE, dockLabel, setDockChoice, useDockChoice } from '../../lib/dock-choice.ts'
import { BottomSheet, SheetChoices, ToggleRow, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { THANKS_TEMPLATE_TITLE, thanksTemplateLabel } from '../../lib/thanks-template.ts'
import { LABEL_PRINT_TITLE, LabelPrintRows, type LabelPrintNav } from '../LabelPrintScreen.tsx'
import { useThanksTemplate } from '../ThanksTemplateScreen.tsx'
import { useConsoleApi } from './context.ts'
import { EndBroadcastRow } from './EndBroadcast.tsx'
import { LinkInfo, hasLinkedLive } from './LinkInfo.tsx'
import { MenuGroup, PLAIN, PlainRow } from './parts.tsx'
import { PauseSwitch } from './Pause.tsx'
import type { StreamAudio } from './StreamAudio.tsx'
import type { MobileYoutube } from './YoutubeSection.tsx'

/** 묶음 이름 (D-MANAGE-01) */
export const MANAGE_GROUPS = { live: '라이브 정보', chat: '채팅·음성', labels: '라벨·프린터' } as const

/** 머리 오른쪽 "관리" 단추·방송 관리 화면 이름 (D-UX4-42) — 화면에는 "관리", 읽기 이름은 "방송 관리" */
export const MANAGE_LABEL = '라이브 관리'

/** 방송 연결 줄 이름 — 그 안 맨 아래에 "방송 연결 끊기"(D-UX4-79) */
export const LINK_TITLE = '라이브 연결'
/** 라벨 프린트 줄 이름 (D-UX4-80, 사용자 지시 2026-11-10 — 옛 "프린터·라벨") — 그 화면 제목과 같다 */
export { LABEL_PRINT_TITLE }

/** 감사 채팅 스위치 이름 (D-UX4-63 → D-MANAGE-01, 사용자 지시 2026-11-23 "자동 감사 채팅 -> 찜 감사 채팅") */
export const THANKS_TITLE = '찜 감사 채팅'
/** ? 를 누르면 올라오는 설명 판 (D-UX4-64) — 짧은 문장 하나에 한 줄 (D-MANAGE-01) */
export const THANKS_HELP_TITLE = '찜 감사 채팅이란?'
export const THANKS_HELP_BODY = '1등 찜이 정해지면 채팅에 감사 인사를 올려요.\n손님은 채팅만 보고 찜이 된 걸 알아요.\n상품·찜을 고치면 올라간 인사도 고쳐요.\n연습 라이브에서는 올리지 않아요.'
/** 설명 판의 예시 채팅 (실제로 올리는 감사 문구 꼴 — core format 감사 문구와 같다) */
export const THANKS_EXAMPLE = { buyer: '홍길동', order: '15', thanks: '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다' } as const

/**
 * 감사 채팅 스위치 (D-YT-SRV-24 → D-UX4-20 스위치로 → D-UX4-63·64 → D-MANAGE-01): 이름은 "찜 감사 채팅", 이름 옆 ? — 그 자리를 누르면 꾸욱 눌리고 아래에서 설명 판이 올라온다.
 * 켜고 끈 결과 줄은 띄우지 않는다(스위치가 지금 상태를 보인다). 바꾸지 못했을 때만 빨간 줄.
 */
export function ThanksSwitch({ on, busy, onPress }: { readonly on: boolean; readonly busy: boolean; readonly onPress: (next: boolean) => void }) {
  const [help, setHelp] = useState(false)
  return (
    <View style={{ paddingHorizontal: PLAIN.side }}>
      {/* 다른 줄과 같은 글자(17 · 보통 · #4F545E — D-UX4-94) */}
      <ToggleRow title={THANKS_TITLE} titleStep="bodyLarge" titleWeight={PLAIN.weight} titleInk={PLAIN.ink} rowHeight={PLAIN.row} on={on} disabled={busy} testID="thanks-switch" onChange={onPress} onHelp={() => setHelp(true)} />
      <BottomSheet visible={help} onClose={() => setHelp(false)} title={THANKS_HELP_TITLE}>
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

type ManageSheet = 'none' | 'dock'

export interface ConsoleManageProps {
  readonly broadcastId: string
  readonly seller: boolean
  readonly title: string
  readonly rehearsal: boolean
  readonly closed: boolean
  /** 유튜브 상태를 받았는지 — 끝나지 않은 방송이면 받지 못했어도 라이브 연결 줄을 보인다 */
  readonly canLink: boolean
  readonly stream: StreamAudio
  /** 이 화면을 닫는다(라이브 소리 다시 켜기는 방송 화면에서 안내·상태를 보여 주므로 닫고 한다, D-UX3-73) */
  readonly onClose: () => void
  /** 라이브 연결(잇는 화면) — 아직 잇지 않았을 때 */
  readonly onShowLink: () => void
  /** 유튜브 잇기 상태 — 이어져 있으면 그 정보 줄을 이 화면에 바로 그린다 (D-UX4-130) */
  readonly yt?: MobileYoutube
  /** 라벨 줄이 여는 화면 — 없으면 라벨 줄이 없다 (D-UX4-130) */
  readonly labels?: LabelPrintNav
  /** 라이브 연결을 끊은 뒤 (없으면 끊기 줄이 없다) */
  readonly onEnded?: () => void
  /** 찜 감사 채팅 양식 화면 (D-THANKS-FMT-01) — 없으면 그 줄이 없다 */
  readonly openThanksTemplate?: () => void
}

/** 닉네임 뒤 영문 숨기기 (D-MANAGE-01: 아래 설명 줄 대신 이름 옆 ? — 다른 스위치와 같은 모양) */
export const NICK_HIDE_TITLE = '닉네임 뒤 영문 숨기기'
export const NICK_HIDE_HELP_TITLE = '닉네임 뒤 영문 숨기기란?'
export const NICK_HIDE_HELP_BODY = '라이브 화면과 라벨에서 닉네임 뒤 영문을 빼고 보여요.\n예: ‘꽃언니-ab12’ → ‘꽃언니’'

function NicknameDisplaySwitch() {
  const { labels } = useServices()
  const { queue } = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [help, setHelp] = useState(false)
  const change = async (hideSuffix: boolean) => {
    setBusy(true)
    setError('')
    try {
      await put('/api/settings/nickname-display', { hideSuffix })
      await labels.reload()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : '닉네임 표시 설정을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  return <View style={{ paddingHorizontal: PLAIN.side }}>
    <ToggleRow title={NICK_HIDE_TITLE} titleStep="bodyLarge" titleWeight={PLAIN.weight} titleInk={PLAIN.ink} rowHeight={PLAIN.row} on={queue?.hideNicknameSuffix === true}
      disabled={queue === null || busy} testID="nick-hide-switch" onChange={(next) => void change(next)} onHelp={() => setHelp(true)} />
    {error ? <Notice tone="danger" alert>{error}</Notice> : null}
    <BottomSheet visible={help} onClose={() => setHelp(false)} title={NICK_HIDE_HELP_TITLE}>
      <Txt step="bodyLarge" color="textSub">{NICK_HIDE_HELP_BODY}</Txt>
    </BottomSheet>
  </View>
}

/** 찜 감사 채팅 양식 줄 — 오른쪽에 지금 양식 이름 */
function ThanksTemplateRow({ onPress }: { readonly onPress: () => void }) {
  const { blocks } = useThanksTemplate()
  const value = thanksTemplateLabel(blocks)
  return <PlainRow title={THANKS_TEMPLATE_TITLE} {...(value === undefined ? {} : { value })} testID="thanks-template-row" onPress={onPress} />
}

/** 각 기능은 관리 화면에서 바로 열고, 사용할 수 있는 기능이 있는 묶음만 보여 준다. */
export function ConsoleManage({ broadcastId, seller, rehearsal, closed, canLink, stream, onClose, onShowLink, yt, labels, onEnded, openThanksTemplate }: ConsoleManageProps) {
  const api = useConsoleApi()
  const { p } = useKit()
  const [sheet, setSheet] = useState<ManageSheet>('none')
  const [thanksBusy, setThanksBusy] = useState(false)
  const [thanksError, setThanksError] = useState<string | null>(null)
  const close = () => setSheet('none')
  const dock = useDockChoice()
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
  const linked = yt !== undefined && hasLinkedLive(yt)
  const showLink = !linked && (canLink || !closed)
  const showThanks = seller && !closed && !rehearsal
  const showLabels = labels !== undefined && !rehearsal
  // 연결 끊기 (D-MANAGE-01): "라이브 정보" 안 바로가기 바로 아래 — 끝나지 않은 라이브의 판매자만
  const ending = seller && !closed && onEnded !== undefined ? onEnded : undefined
  return (
    <View style={{ marginHorizontal: -SPACE.lg }}>
      <View style={{ gap: SPACE.md, backgroundColor: p.background }}>
        {linked || showLink || ending !== undefined ? (
          <MenuGroup title={MANAGE_GROUPS.live}>
            {linked && yt !== undefined ? <LinkInfo grouped broadcastId={broadcastId} yt={yt} closed={closed} {...(ending === undefined ? {} : { onEnded: ending })} /> : null}
            {showLink ? <PlainRow title={LINK_TITLE} onPress={onShowLink} /> : null}
            {/* 아직 잇지 않은 라이브도 끝낼 수 있게 — 이은 라이브는 위 LinkInfo 안에 있다 */}
            {!linked && ending !== undefined ? <EndBroadcastRow broadcastId={broadcastId} onEnded={ending} plain /> : null}
          </MenuGroup>
        ) : null}

        <MenuGroup title={MANAGE_GROUPS.chat}>
          {/* 채팅·음성 인식 잠깐 멈추기 (D-PAUSE-01) — 끝나지 않은 라이브의 판매자만, 맨 위 */}
          {seller && !closed ? <PauseSwitch broadcastId={broadcastId} /> : null}
          {seller ? <NicknameDisplaySwitch /> : null}
          {showThanks ? <ThanksSwitch on={thanksOn} busy={thanksBusy} onPress={switchThanks} /> : null}
          {thanksError !== null ? <View style={{ paddingHorizontal: PLAIN.side }}><Notice tone="danger" alert>{thanksError}</Notice></View> : null}
          {showThanks && openThanksTemplate !== undefined ? <ThanksTemplateRow onPress={openThanksTemplate} /> : null}
          {/* 마이크가 꺼진 동안 대신 듣는 라이브 소리가 멈췄을 때만 (D-UX3-73) */}
          {seller && !closed && stream.status?.phase === 'stopped' ? <PlainRow title="라이브 소리 다시 켜기" onPress={() => { onClose(); stream.retry() }} /> : null}
          <PlainRow title={DOCK_TITLE} value={dockLabel(dock)} testID="dock-choice" onPress={() => setSheet('dock')} />
        </MenuGroup>

        {showLabels && labels !== undefined ? (
          <MenuGroup title={MANAGE_GROUPS.labels}>
            <LabelPrintRows openStep={labels.openStep} seller={seller} />
          </MenuGroup>
        ) : null}
      </View>

      <BottomSheet visible={sheet === 'dock'} onClose={close} title={DOCK_TITLE} description={DOCK_DESCRIPTION}>
        {/* 토스식 고르기 목록 (D-UX4-76 아래 창 SheetChoices) */}
        <SheetChoices label={DOCK_TITLE} choices={DOCK_CHOICES} value={dock} onPick={(next) => { setDockChoice(next); close() }} />
      </BottomSheet>
    </View>
  )
}
