// 채팅·상품 인식 잠깐 멈춤 (D-PAUSE-01, 사용자 요청 2026-11-20 "방송 중간에 이벤트 한다고 채팅을 받는게 있는데, 그 도중에 잘못 들어오는
// 상품 등록이나 주문을 막기 위해 온오프 하듯이"): 라이브 관리 "채팅·화면 설정"의 스위치 하나로 켜고 끈다(broadcast.pause).
// 멈춘 동안 라이브 화면 탭 바 밑에 노란 줄과 [다시 받기] 단추 — 한 번 눌러 바로 다시 받는다.
import { useState } from 'react'
import { View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { BottomSheet, ToggleRow, Txt } from '../../ui/kit/index.ts'
import { BigButton as SmallButton, Notice, Row } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'
import { PLAIN } from './parts.tsx'

/** 스위치 이름 */
export const PAUSE_TITLE = '채팅·상품 인식 잠깐 멈춤'
export const PAUSE_HELP_TITLE = '잠깐 멈춤이란?'
export const PAUSE_HELP_BODY = '이벤트처럼 채팅을 따로 받을 때 켜 두세요.\n켜 둔 동안 채팅 번호로 찜·취소가 들어가지 않고, 화면·소리로 상품이 등록되거나 바뀌지 않아요.\n휴대폰으로 받은 문자찜은 확인 필요로 남아요.\n직접 넣는 상품·찜은 그대로 돼요.'
/** 멈춘 동안 라이브 화면에 보이는 줄 */
export const PAUSED_LINE = '채팅·상품 인식을 잠깐 멈췄어요. 지금은 채팅 찜과 자동 상품 등록이 들어오지 않아요.'
export const RESUME_LABEL = '다시 받기'
const FAILED = '바꾸지 못했어요. 다시 눌러 주세요.'

/** 그 방송이 지금 잠깐 멈춤인가 (설정 스냅샷 claim.paused) */
export function usePaused(broadcastId: string): boolean {
  const api = useConsoleApi()
  return api.data.broadcasts.get(broadcastId)?.settings['claim.paused'] === true
}

/** 켜기·끄기 보내기 — 결과 줄은 띄우지 않는다(스위치·노란 줄이 지금 상태를 보인다). 바꾸지 못했을 때만 빨간 줄 */
function usePauseCommand(broadcastId: string): { busy: boolean; error: string | null; send: (next: boolean) => void } {
  const api = useConsoleApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = (next: boolean) => {
    setBusy(true)
    setError(null)
    api.command({ type: 'broadcast.pause', b: broadcastId, paused: next }).then(
      () => undefined,
      (caught: unknown) => setError(isApiError(caught) ? caught.message : FAILED),
    ).finally(() => setBusy(false))
  }
  return { busy, error, send }
}

/** 라이브 관리의 스위치 줄 (이름 옆 ? — 설명 판) */
export function PauseSwitch({ broadcastId }: { readonly broadcastId: string }) {
  const on = usePaused(broadcastId)
  const { busy, error, send } = usePauseCommand(broadcastId)
  const [help, setHelp] = useState(false)
  return (
    <View style={{ paddingHorizontal: PLAIN.side }}>
      <ToggleRow title={PAUSE_TITLE} titleStep="bodyLarge" titleWeight={PLAIN.weight} titleInk={PLAIN.ink} rowHeight={PLAIN.row} on={on} disabled={busy} testID="pause-switch" onChange={send} onHelp={() => setHelp(true)} />
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      <BottomSheet visible={help} onClose={() => setHelp(false)} title={PAUSE_HELP_TITLE}>
        <Txt step="bodyLarge" color="textSub">{PAUSE_HELP_BODY}</Txt>
      </BottomSheet>
    </View>
  )
}

/** 멈춘 동안 라이브 화면 탭 바 밑 노란 줄 + [다시 받기] (판매자·끝나지 않은 라이브만) */
export function PausedNotice({ broadcastId, seller, closed }: { readonly broadcastId: string; readonly seller: boolean; readonly closed: boolean }) {
  const on = usePaused(broadcastId)
  const { busy, error, send } = usePauseCommand(broadcastId)
  if (!on || closed) return null
  return (
    <View testID="paused-notice" style={{ gap: 8 }}>
      <Row wrap>
        <Notice tone="warning" alert>
          {PAUSED_LINE}
        </Notice>
        {seller ? <SmallButton small label={RESUME_LABEL} disabled={busy} onPress={() => send(false)} /> : null}
      </Row>
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
    </View>
  )
}
