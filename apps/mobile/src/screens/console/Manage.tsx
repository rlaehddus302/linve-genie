// 방송 관리 (D-UX4-20 → D-UX4-57): 토스 설정 화면처럼 굵은 묶음 이름 · 흰 카드 · 줄 이름만.
// 방송 화면 위 진짜 쌓인 화면(app/console/[id]/manage)과, 경로가 없을 때(시험·웹) 방송 화면 안 겹친 화면이 같이 쓴다.
// 여기서 여는 아래 판(문자찜·음성 설정·미리 등록·댓글 붙여넣기·채팅·방송 끝내기)도 이 안에 있다.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post, withRetry } from '../../api/client.ts'
import { LISTEN_START, LISTEN_STOP } from '../../lib/words.ts'
import { useServices } from '../../services.tsx'
import { BottomSheet, ConfirmSheet, FullSheet, ToggleRow } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
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

/** 감사 채팅 켜기·끄기 결과 줄을 보이는 시간 */
const THANKS_NOTE_MS = 5000
export const THANKS_ON_DONE = '감사 채팅을 켰어요. 이제 찜이 확정되면 채팅에 감사 메시지를 올려요.'
export const THANKS_OFF_DONE = '감사 채팅을 껐어요. 이제 채팅에 감사 메시지를 올리지 않아요.'

/** 감사 채팅 스위치 (D-YT-SRV-24 → D-UX4-20 스위치로) — 켜짐·꺼짐이 스위치에 보인다 */
export function ThanksSwitch({ on, busy, onPress }: { readonly on: boolean; readonly busy: boolean; readonly onPress: (next: boolean) => void }) {
  return (
    <View style={{ paddingHorizontal: SPACE.xl }}>
      <ToggleRow title="감사 채팅" on={on} disabled={busy} testID="thanks-switch" onChange={onPress} />
    </View>
  )
}

type ManageSheet = 'none' | 'sms' | 'voice' | 'end' | 'chat' | 'paste' | 'import'

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
  const [thanksNote, setThanksNote] = useState<{ readonly tone: 'success' | 'danger'; readonly text: string } | null>(null)
  const [pasted, setPasted] = useState<string | null>(null)
  const [endError, setEndError] = useState<string | null>(null)
  useEffect(() => {
    if (thanksNote === null) return
    const handle = setTimeout(() => setThanksNote(null), THANKS_NOTE_MS)
    return () => clearTimeout(handle)
  }, [thanksNote])
  const close = () => setSheet('none')
  // 설정 하나하나는 진짜 전체 화면으로 (D-UX4-60) — 경로가 없을 때(시험·웹)만 이 화면 위 판으로
  const show = (tool: 'sms' | 'voice' | 'import' | 'paste' | 'chat') => (openTool === undefined ? setSheet(tool) : openTool(tool))
  const thanksOn = api.data.broadcasts.get(broadcastId)?.settings['thanks.liveChat'] === true
  const listening = voiceView.on && voiceView.broadcastId === broadcastId
  const switchThanks = (next: boolean) => {
    setThanksBusy(true)
    api.command({ type: 'broadcast.thanks', b: broadcastId, liveChat: next }).then(
      () => setThanksNote({ tone: 'success', text: next ? THANKS_ON_DONE : THANKS_OFF_DONE }),
      (caught: unknown) => setThanksNote({ tone: 'danger', text: isApiError(caught) ? caught.message : '바꾸지 못했어요. 다시 눌러 주세요.' }),
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
      {thanksNote !== null ? <Notice tone={thanksNote.tone} alert={thanksNote.tone === 'danger'}>{thanksNote.text}</Notice> : null}
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
