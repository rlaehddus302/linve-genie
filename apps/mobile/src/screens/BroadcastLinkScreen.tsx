// 방송 연결 (D-UX3-09): 방송 화면 메뉴의 "방송 연결"과 새 방송의 첫 연결 안내가 여는 쌓인 화면 — 밀어서 뒤로 가기가 된다.
// 아직 잇지 않았고 이을 수 있으면 흰 바탕 입력 화면(방송 주소 칸 + [방송 주소를 모르겠어요] + 맨 아래 [나중에 잇기]·[이 방송에 잇기]),
// 이었거나 이을 수 없으면 회색 바탕에 유튜브 카드(받는 상태·연결 안내 — YoutubeSection 그대로).
import { useState } from 'react'
import type { LinkView } from '@livejjim/web/src/api/types.ts'
import { post, withRetry } from '../api/client.ts'
import { BigButton, FormPage } from '../ui/kit/index.ts'
import { View } from 'react-native'
import { PlatformFinder } from './NewBroadcastScreen.tsx'
import { YoutubeSection, useAddressLinker, useMobileYoutube, type MobileYoutube } from './console/YoutubeSection.tsx'

/** 이 방송을 지금 주소로 이을 수 있나 (방송 화면과 같은 조건) */
export function canLinkByAddress(yt: MobileYoutube, closed: boolean): boolean {
  return yt.phase === 'ready' && yt.link !== null && yt.link.link === null && !closed && (yt.webChat === null ? yt.connection === 'CONNECTED' : yt.webChat.on)
}

export function BroadcastLinkScreen({ broadcastId, closed, onBack }: { readonly broadcastId: string; readonly closed: boolean; readonly onBack: () => void }) {
  const yt = useMobileYoutube(broadcastId, true)
  const linkable = canLinkByAddress(yt, closed)
  const [finder, setFinder] = useState(false)
  const linker = useAddressLinker({ enabled: linkable, webChat: yt.webChat, broadcastId, autoFocus: true, submit: async (body) => yt.setLink(await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/youtube`, body))) })
  if (!linkable) {
    return (
      <FormPage title="방송 연결" onBack={onBack} cards>
        <YoutubeSection yt={yt} closed={closed} />
      </FormPage>
    )
  }
  return (
    <FormPage
      title="방송 링크를 넣어 주세요"
      name="방송 연결"
      onBack={onBack}
      overlay={linker.popup}
      actions={
        <>
          <BigButton kind="outline" label="나중에 잇기" onPress={onBack} />
          {linker.action}
        </>
      }
    >
      <View role="group" aria-label="유튜브">
        {linker.fields}
      </View>
      <BigButton kind="outline" label="링크를 모르겠어요" onPress={() => setFinder(true)} />
      <PlatformFinder visible={finder} onClose={() => setFinder(false)} onReturned={() => void linker.recheck()} />
    </FormPage>
  )
}
