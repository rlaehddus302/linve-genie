// 방송 관리 (D-UX4-20 → D-UX4-57): 토스 설정 화면처럼 굵은 묶음 이름 · 흰 카드 · 줄 이름만.
// 방송 화면 위 진짜 쌓인 화면(app/console/[id]/manage)과, 경로가 없을 때(시험·웹) 방송 화면 안 겹친 화면이 같이 쓴다.
// 여기서 여는 아래 판(문자찜·음성 설정·미리 등록·댓글 붙여넣기·채팅·방송 끝내기)도 이 안에 있다.
import { useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post, withRetry } from '../../api/client.ts'
import { DOCK_CHOICES, DOCK_TITLE, dockLabel, setDockChoice, useDockChoice, type DockChoice } from '../../lib/dock-choice.ts'
import { LISTEN_START, LISTEN_STOP } from '../../lib/words.ts'
import { useServices } from '../../services.tsx'
import { BigButton, BottomSheet, ConfirmSheet, FullSheet, Icon, Tap, ToggleRow, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { ChatView, PasteView } from './ChatPaste.tsx'
import { useConsoleApi } from './context.ts'
import { APP_IMPORT_TITLE, ImportView } from './ImportSheet.tsx'
import { MenuGroup, MenuRow } from './parts.tsx'
import { SmsForm } from './SmsForm.tsx'
import type { StreamAudio } from './StreamAudio.tsx'
import { VoiceSettingsPanel } from './VoicePanel.tsx'

/** 머리 오른쪽 "관리" 단추·방송 관리 화면 이름 (D-UX4-42) — 화면에는 "관리", 읽기 이름은 "방송 관리" */
export const MANAGE_LABEL = '방송 관리'

/** 방송 관리의 문자찜 칸 줄 이름 (D-UX4-20 — 옛 "직접 넣기" 시트의 문자찜 칸) */
export const SMS_DIRECT = '문자찜 직접 넣기'

/** 감사 채팅 스위치 이름 (D-UX4-63, 사용자 지시 2026-11-10 — 옛 "감사 채팅") */
export const THANKS_TITLE = '자동 감사 채팅'
/** ? 를 누르면 올라오는 설명 판 (D-UX4-64) — 한 문장에 한 줄 */
export const THANKS_HELP_TITLE = '자동 감사 채팅이란?'
export const THANKS_HELP_BODY = '찜이 1등으로 정해지면 유튜브 라이브 채팅에 감사 인사를 대신 올려요.\n손님은 채팅만 보고도 내 찜이 잡혔는지 바로 알 수 있어요.\n연습 방송에서는 올리지 않아요.'
/** 설명 판의 예시 채팅 (실제로 올리는 감사 문구 꼴 — core format 감사 문구와 같다) */
export const THANKS_EXAMPLE = { buyer: '홍길동', order: '15', thanks: '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다' } as const

/**
 * 감사 채팅 스위치 (D-YT-SRV-24 → D-UX4-20 스위치로 → D-UX4-63·64): 이름은 "자동 감사 채팅", 이름 옆 ? — 그 자리를 누르면 꾸욱 눌리고 아래에서 설명 판이 올라온다.
 * 켜고 끈 결과 줄은 띄우지 않는다(스위치가 지금 상태를 보인다). 바꾸지 못했을 때만 빨간 줄.
 */
export function ThanksSwitch({ on, busy, onPress }: { readonly on: boolean; readonly busy: boolean; readonly onPress: (next: boolean) => void }) {
  const [help, setHelp] = useState(false)
  return (
    <View style={{ paddingHorizontal: SPACE.xl }}>
      <ToggleRow title={THANKS_TITLE} on={on} disabled={busy} testID="thanks-switch" onChange={onPress} onHelp={() => setHelp(true)} />
      <BottomSheet visible={help} onClose={() => setHelp(false)} title={THANKS_HELP_TITLE} actions={<BigButton label="확인" onPress={() => setHelp(false)} />}>
        <Txt step="bodyLarge" color="textSub">{THANKS_HELP_BODY}</Txt>
        <ThanksExample />
      </BottomSheet>
    </View>
  )
}

/** 아래 창 고르기 (D-UX4-71): 세 줄 중 하나 — 고른 줄 오른쪽에 ✓, 누르면 바로 바뀌고 판이 닫힌다 */
function DockChoiceList({ value, onPick }: { readonly value: DockChoice; readonly onPick: (next: DockChoice) => void }) {
  const { p } = useKit()
  return (
    <View role="radiogroup" aria-label={DOCK_TITLE} style={{ marginHorizontal: -SPACE.sm }}>
      {DOCK_CHOICES.map((item) => {
        const on = item.value === value
        return (
          <Tap key={item.value} role="radio" aria-checked={on} aria-label={item.label} onPress={() => onPick(item.value)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <View style={{ flex: 1 }}>
              <Txt step="bodyLarge" weight={on ? 'bold' : 'book'} {...(on ? { color: 'primaryText' as const } : {})}>{item.label}</Txt>
            </View>
            {on ? <Icon name="check" size={20} color={p.primary} /> : null}
          </Tap>
        )
      })}
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

type ManageSheet = 'none' | 'sms' | 'voice' | 'end' | 'chat' | 'paste' | 'import' | 'dock'

/**
 * canLink: 방송 연결 줄을 보일지(유튜브 상태를 받았을 때). onClose: 이 화면을 닫는다(듣기 켜기·끄기는 방송 화면에서 안내·상태를 보여 주므로 닫고 한다, D-UX3-73).
 * onEnded: 방송을 끝낸 뒤.
 */
export function ConsoleManage({ broadcastId, seller, title, rehearsal, closed, canLink, stream, onClose, onShowLink, onOpenLabels, onEnded, openTool }: { readonly broadcastId: string; readonly seller: boolean; readonly title: string; readonly rehearsal: boolean; readonly closed: boolean; readonly canLink: boolean; readonly stream: StreamAudio; readonly onClose: () => void; readonly onShowLink: () => void; readonly onOpenLabels?: () => void; readonly onEnded: () => void; readonly openTool?: (tool: 'sms' | 'voice' | 'import' | 'paste' | 'chat') => void }) {
  const api = useConsoleApi()
  const services = useServices()
  const voiceView = useSyncExternalStore(services.voice.subscribe, services.voice.getView)
  const [sheet, setSheet] = useState<ManageSheet>('none')
  const [thanksBusy, setThanksBusy] = useState(false)
  const [thanksError, setThanksError] = useState<string | null>(null)
  const [pasted, setPasted] = useState<string | null>(null)
  const [endError, setEndError] = useState<string | null>(null)
  const close = () => setSheet('none')
  const dock = useDockChoice()
  // 설정 하나하나는 진짜 전체 화면으로 (D-UX4-60) — 경로가 없을 때(시험·웹)만 이 화면 위 판으로
  const show = (tool: 'sms' | 'voice' | 'import' | 'paste' | 'chat') => (openTool === undefined ? setSheet(tool) : openTool(tool))
  const thanksOn = api.data.broadcasts.get(broadcastId)?.settings['thanks.liveChat'] === true
  const listening = voiceView.on && voiceView.broadcastId === broadcastId
  const switchThanks = (next: boolean) => {
    setThanksBusy(true)
    setThanksError(null)
    // 켜고 끈 결과 줄은 띄우지 않는다 (D-UX4-63) — 바꾸지 못했을 때만 빨간 줄
    api.command({ type: 'broadcast.thanks', b: broadcastId, liveChat: next }).then(
      () => undefined,
      (caught: unknown) => setThanksError(isApiError(caught) ? caught.message : '바꾸지 못했어요. 다시 눌러 주세요.'),
    ).finally(() => setThanksBusy(false))
  }
  const endBroadcast = async () => {
    setEndError(null)
    try {
      const result = await withRetry(() => post<WriteResult>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/end`, { requestId: newRequestId() }))
      setSheet('none')
      await api.sync?.(result.seq)
      onEnded()
    } catch (caught) {
      setSheet('none')
      setEndError(isApiError(caught) ? caught.message : '끝내지 못했어요. 다시 눌러 주세요.')
    }
  }
  return (
    <>
      {thanksError !== null ? <Notice tone="danger" alert>{thanksError}</Notice> : null}
      {endError !== null ? <Notice tone="danger" alert>{endError}</Notice> : null}
      {pasted !== null ? <Notice tone="success">{pasted}</Notice> : null}
      <MenuGroup title="방송">
        {canLink ? <MenuRow title="방송 연결" onPress={onShowLink} /> : null}
        {/* 방송 중 감사 채팅 켜기·끄기 (D-YT-SRV-24) — 실제 방송만(리허설은 유튜브에 아무것도 올리지 않는다) */}
        {seller && !closed && !rehearsal ? <ThanksSwitch on={thanksOn} busy={thanksBusy} onPress={switchThanks} /> : null}
        {onOpenLabels !== undefined && !rehearsal ? <MenuRow title="프린터·라벨" onPress={onOpenLabels} /> : null}
      </MenuGroup>
      {seller && !closed ? (
        <MenuGroup title="듣기">
          {/* 휴대폰 마이크 켜기·끄기는 방송 화면에서 안내·상태를 보여 주므로 이 화면을 닫는다 (D-UX3-73) */}
          <MenuRow title={listening ? LISTEN_STOP : LISTEN_START} testID="listen-button" onPress={() => { onClose(); void (listening ? services.voice.turnOff() : services.voice.turnOn(broadcastId, title)) }} />
          {stream.status?.phase === 'stopped' ? <MenuRow title="방송 소리 다시 켜기" onPress={() => { onClose(); stream.retry() }} /> : null}
          <MenuRow title="음성 설정" onPress={() => show('voice')} />
        </MenuGroup>
      ) : null}
      <MenuGroup title="넣기·보기">
        {!closed ? <MenuRow title={SMS_DIRECT} onPress={() => show('sms')} /> : null}
        {/* 방송 전 상품 미리 등록 (PRD-05 앱, D-V3-128) */}
        {seller && !closed ? <MenuRow title={APP_IMPORT_TITLE} onPress={() => show('import')} /> : null}
        {!rehearsal && !closed ? <MenuRow title="댓글 붙여넣기" onPress={() => show('paste')} /> : null}
        <MenuRow title="채팅 보기" onPress={() => show('chat')} />
        {/* 방송 화면 맨 아래 창: 들린 말 · 채팅·문자 · 안 보기 (D-UX4-71) */}
        <MenuRow title={DOCK_TITLE} value={dockLabel(dock)} testID="dock-choice" onPress={() => setSheet('dock')} />
      </MenuGroup>
      {!closed ? (
        <MenuGroup>
          <MenuRow title="방송 끝내기" danger onPress={() => setSheet('end')} />
        </MenuGroup>
      ) : null}

      <BottomSheet visible={sheet === 'sms'} onClose={close} title={SMS_DIRECT}>
        <SmsForm />
      </BottomSheet>
      <FullSheet visible={sheet === 'import'} onClose={close} name={APP_IMPORT_TITLE} title={APP_IMPORT_TITLE}>
        {sheet === 'import' ? <ImportView /> : null}
      </FullSheet>
      <BottomSheet visible={sheet === 'chat'} onClose={close} title="채팅">
        {sheet === 'chat' ? <ChatView /> : null}
      </BottomSheet>
      <BottomSheet visible={sheet === 'paste'} onClose={close} title="댓글 붙여넣기">
        {sheet === 'paste' ? (
          <PasteView
            onDone={(message) => {
              setPasted(message)
              close()
            }}
          />
        ) : null}
      </BottomSheet>
      <BottomSheet visible={sheet === 'dock'} onClose={close} title={DOCK_TITLE}>
        <DockChoiceList value={dock} onPick={(next) => { setDockChoice(next); close() }} />
      </BottomSheet>
      <BottomSheet visible={sheet === 'voice'} onClose={close} title="음성 설정">
        <VoiceSettingsPanel session={services.voice} broadcastId={broadcastId} />
      </BottomSheet>
      <ConfirmSheet
        visible={sheet === 'end'}
        question="방송을 끝낼까요?"
        description="끝난 뒤에도 늦게 온 채팅·문자찜은 처리돼요."
        confirmLabel="끝내기"
        cancelLabel="아니요"
        danger
        onCancel={close}
        onConfirm={() => void endBroadcast()}
      />
    </>
  )
}
