// 방송 연결 끊기 (D-UX4-79, 사용자 지시 2026-11-10 "방송 끝내기는 방송 연결 안에 넣어서 이름도 '방송 연결 끊기'로 하고 눌렀을 때는 아래 창이 아니라 팝업 창으로 …
// 토스 팝업 ui로 하고 끊기 버튼 색만 빨갛게"): 방송 연결 화면 맨 아래 빨간 글자 줄 → 가운데 팝업 [취소](왼쪽) · [끊기](오른쪽, 빨강).
// 끊으면 방송이 끝난다(옛 "방송 끝내기"와 같은 요청). 끝난 뒤에도 늦게 온 채팅·문자찜은 서버가 처리한다.
import { useContext, useState } from 'react'
import { View } from 'react-native'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post, withRetry } from '../../api/client.ts'
import { PopupDialog } from '../../ui/kit/index.ts'
import { Notice } from '../../ui/parts.tsx'
import { ConsoleContext } from './context.ts'
import { MenuGroup, MenuRow } from './parts.tsx'

export const END_LINK_LABEL = '라이브 연결 끊기'
export const END_LINK_QUESTION = '라이브 연결을 끊을까요?'
export const END_LINK_BODY = '라이브가 끝나요. 끝난 뒤에도 늦게 온 채팅·문자찜은 처리돼요.'

/** 방송 연결 화면 맨 아래 "방송 연결 끊기" 줄과 팝업. onEnded: 끊은 뒤(홈으로) */
export function EndBroadcastRow({ broadcastId, onEnded }: { readonly broadcastId: string; readonly onEnded: () => void }) {
  const api = useContext(ConsoleContext)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await withRetry(() => post<WriteResult>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/end`, { requestId: newRequestId() }))
      setAsking(false)
      await api?.sync?.(result.seq)
      onEnded()
    } catch (caught) {
      setAsking(false)
      setError(isApiError(caught) ? caught.message : '끊지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      <MenuGroup>
        <MenuRow title={END_LINK_LABEL} danger testID="end-link" onPress={() => setAsking(true)} />
      </MenuGroup>
      <PopupDialog visible={asking} message={END_LINK_QUESTION} description={END_LINK_BODY} cancelLabel="취소" confirmLabel="끊기" danger busy={busy} onCancel={() => setAsking(false)} onConfirm={() => void end()} />
    </View>
  )
}
