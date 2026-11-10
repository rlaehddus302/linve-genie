// 방송 연결 (D-UX3-09): 방송 화면 메뉴의 "방송 연결"과 새 방송의 첫 연결 안내가 여는 쌓인 화면 — 밀어서 뒤로 가기가 된다.
// 아직 연결하지 않았고 연결할 수 있으면 흰 바탕 입력 화면(제목·설명 + 링크 칸(키보드 없음) + 설명 아래 [링크를 모르겠어요] 칩 · 칸 아래 [붙여넣기] 칩(D-UX4-113) + 맨 아래 [나중에 연결]·[확인], D-UX4-112),
// 이은 라이브가 있으면 흰 바탕 정보 줄(D-UX4-95 — LinkInfoPage: 플랫폼 · 채널 · 라이브 제목, [라이브 바로가기] · [라이브 연결 끊기]),
// 이을 수 없는 그 밖의 경우(서버 설정 없음·구글 연결 먼저·끝난 라이브 등)는 회색 바탕에 유튜브 카드(연결 안내 — YoutubeSection 그대로).
import { useState } from 'react'
import { BigButton, FormPage, StackPage } from '../ui/kit/index.ts'
import { View } from 'react-native'
import { PlatformFinder } from './NewBroadcastScreen.tsx'
import { EndBroadcastRow } from './console/EndBroadcast.tsx'
import { LinkInfoPage, hasLinkedLive } from './console/LinkInfo.tsx'
import { LINK_ASK_DESCRIPTION, LINK_ASK_TITLE, LinkUnknownChip, YoutubeSection, sendLiveLink, useAddressLinker, useMobileYoutube, type MobileYoutube } from './console/YoutubeSection.tsx'

/** 이 방송을 지금 주소로 이을 수 있나 (방송 화면과 같은 조건) */
export function canLinkByAddress(yt: MobileYoutube, closed: boolean): boolean {
  return yt.phase === 'ready' && yt.link !== null && yt.link.link === null && !closed && (yt.webChat === null ? yt.connection === 'CONNECTED' : yt.webChat.on)
}

export function BroadcastLinkScreen({ broadcastId, closed, onBack, onEnded }: { readonly broadcastId: string; readonly closed: boolean; readonly onBack: () => void; readonly onEnded?: () => void }) {
  // 방송 연결 끊기 (D-UX4-79 — 옛 방송 관리 "방송 끝내기"): 끝나지 않은 방송에서만, 화면 맨 아래
  const endRow = onEnded === undefined || closed ? null : <EndBroadcastRow broadcastId={broadcastId} onEnded={onEnded} />
  const yt = useMobileYoutube(broadcastId, true)
  const linkable = canLinkByAddress(yt, closed)
  const [finder, setFinder] = useState(false)
  const linker = useAddressLinker({ enabled: linkable, webChat: yt.webChat, broadcastId, submit: async (request) => {
      const view = await sendLiveLink(broadcastId, request)
      // 틱톡·밴드는 이으면 방송 화면으로 돌아간다(그 화면이 받는 상태를 보인다)
      if (view === null) onBack()
      else yt.setLink(view)
    } })
  // 받는 동안은 빈 흰 바탕 (D-UX4-83·95 — 회색 카드 화면이 잠깐 보였다가 흰 정보 화면으로 바뀌어 들썩이지 않게)
  if (yt.phase === 'loading' || (yt.phase === 'ready' && yt.link === null)) return <StackPage name="라이브 연결" onBack={onBack} testID="link-loading" />
  if (hasLinkedLive(yt)) return <LinkInfoPage broadcastId={broadcastId} yt={yt} closed={closed} onBack={onBack} {...(onEnded === undefined ? {} : { onEnded })} />
  if (!linkable) {
    return (
      <FormPage title="라이브 연결" onBack={onBack} cards>
        <YoutubeSection yt={yt} closed={closed} />
        {endRow}
      </FormPage>
    )
  }
  return (
    <FormPage
      title={LINK_ASK_TITLE}
      description={LINK_ASK_DESCRIPTION}
      headerAction={<LinkUnknownChip onPress={() => setFinder(true)} />}
      name="라이브 연결"
      onBack={onBack}
      overlay={linker.popup}
      actions={
        <>
          <BigButton kind="outline" label="나중에 연결" onPress={onBack} />
          {linker.action}
        </>
      }
    >
      <View role="group" aria-label="유튜브">
        {linker.fields}
      </View>
      {endRow}
      <PlatformFinder visible={finder} onClose={() => setFinder(false)} onReturned={() => void linker.recheck()} />
    </FormPage>
  )
}
