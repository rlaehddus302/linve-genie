// 라이브 연결 정보 (D-UX4-95, 사용자 지시 2026-11-10 "관리화면과 마찬가지로 섹션 없애고 배경 흰색하고, 연결 정보를 나열하자. 플랫폼(아이콘 왼쪽에 배치하기),
// 라이브 제목, 채널명(왼쪽에 채널 프로필 사진). 메뉴에는 라이브로 바로가기(누르면 해당 링크 타고 바로가기)와 라이브 연결 끊기 2개를 배치."):
// 이은 라이브를 토스 "비밀번호 · 보안"처럼 흰 바탕 줄로 — 플랫폼(아이콘 · 이름) · 라이브 제목 · 채널(사진 · 이름), 그 아래 누르는 줄
// [라이브로 바로가기 ›](주소를 알 때만) · [채팅 다시 받기 ›](멈춰서 다시 받을 수 있을 때만) · [라이브 연결 끊기 ›](빨강, 끝나지 않은 라이브에서 판매자만).
// 채팅을 못 받는 경고(빨간 한 줄 + 대비 경로)는 판매자 안전이라 맨 위에 남긴다. 제목·채널 이름은 바깥 글이라 글자로만 보인다.
import { useEffect, useState, type ReactNode } from 'react'
import { Image, ScrollView, View } from 'react-native'
import type { BroadcastItem, LinkView } from '@livejjim/web/src/api/types.ts'
import { isApiError, post, withRetry } from '../../api/client.ts'
import { peekCached, rememberCached, useCachedGet } from '../../lib/cached-get.ts'
import type { LivePlatform } from '../../lib/open-app.ts'
import { openExternal } from '../../lib/open-web.ts'
import { broadcastTitleText, channelName } from '../../lib/youtube.ts'
import { Icon, PAGE, SPACE, StackPage, Txt, useBottomInset, useKit } from '../../ui/kit/index.ts'
import { Notice } from '../../ui/parts.tsx'
import { PlatformIcon } from '../../ui/PlatformIcon.tsx'
import { broadcastTitle } from '../BroadcastList.tsx'
import { EndBroadcastRow } from './EndBroadcast.tsx'
import { PLAIN, PlainRow, PlainTitle } from './parts.tsx'
import { YoutubeWarning, type MobileYoutube } from './YoutubeSection.tsx'

export const LINK_INFO_TITLE = '라이브 연결'
export const LINK_INFO_ROWS = { platform: '플랫폼', title: '라이브 제목', channel: '채널', open: '라이브로 바로가기', restart: '채팅 다시 받기' } as const
/** 줄 오른쪽 작은 그림 (플랫폼 아이콘·채널 사진) */
export const LINK_INFO_ICON = 24

const PLATFORM_WORD: Readonly<Record<LivePlatform, string>> = { youtube: '유튜브', tiktok: '틱톡', band: '밴드' }

/** 이은 유튜브 라이브의 바로가기 주소 (기기에서 열면 유튜브 앱, 없으면 브라우저) */
export function liveWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

/** 이 라이브 연결 화면이 정보 줄을 보일 때 — 유튜브 라이브가 이어져 있다 */
export function hasLinkedLive(yt: MobileYoutube): boolean {
  return yt.phase === 'ready' && (yt.link?.link ?? null) !== null
}

/** 미리 본 라이브 제목·채널 이름은 화면 자료 기억에 둔다 (영상마다 한 번만 묻고 다시 열면 바로 — 로그아웃·계정 바뀜이면 지워진다, D-UX4-77) */
type LiveNames = { readonly title: string | null; readonly channel: string | null }
const namesKey = (videoId: string): string => `link-info:preview:${videoId}`

/**
 * 유튜브 라이브 제목: 잇기 기록에는 제목이 없어 서버 미리 보기(D-UX4-08과 같은 읽기 — 유튜브에 아무것도 쓰지 않는다)로 읽는다.
 * 서버 읽기가 아니거나 못 읽으면(끝난 라이브 등) 앱의 라이브 이름으로.
 */
function useLiveNames(yt: MobileYoutube): { readonly title: string | null; readonly channel: string | null; readonly done: boolean } {
  const videoId = yt.link?.link?.videoId ?? null
  const ask = videoId !== null && yt.webChat !== null
  const [, setRead] = useState(0)
  // 못 읽은 영상 (이 화면에서만 — 다시 열면 다시 묻는다, 잠깐 실패일 수 있다)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (videoId === null || !ask || peekCached<LiveNames>(namesKey(videoId)) !== null) return
    let alive = true
    withRetry(() => post<{ title?: unknown; channelTitle?: unknown }>('/api/youtube/preview', { video: videoId })).then(
      (body) => {
        const title = typeof body.title === 'string' && body.title.trim() !== '' ? broadcastTitleText(body.title) : null
        const channel = typeof body.channelTitle === 'string' && body.channelTitle.trim() !== '' ? channelName(body.channelTitle) : null
        rememberCached<LiveNames>(namesKey(videoId), { title, channel })
        if (alive) setRead((n) => n + 1)
      },
      () => {
        if (alive) setFailed(videoId)
      },
    )
    return () => {
      alive = false
    }
  }, [videoId, ask])
  const shown = videoId === null ? null : peekCached<LiveNames>(namesKey(videoId))
  return { title: shown?.title ?? null, channel: shown?.channel ?? null, done: !ask || shown !== null || failed === videoId }
}

/** 줄 오른쪽: 작은 그림 · 글자 (글이 길면 줄여 끝에 …) */
function IconValue({ icon, text, testID }: { readonly icon: ReactNode; readonly text: string; readonly testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexShrink: 1, maxWidth: '68%' }}>
      <View testID="link-info-icon">{icon}</View>
      <View style={{ flexShrink: 1 }}>
        <Txt step="bodyLarge" weight="regular" color="primaryText" numberOfLines={1}>
          {text}
        </Txt>
      </View>
    </View>
  )
}

function TextValue({ text, testID }: { readonly text: string; readonly testID?: string }) {
  return (
    <View testID={testID} style={{ flexShrink: 1, maxWidth: '68%' }}>
      <Txt step="bodyLarge" weight="regular" color="primaryText" numberOfLines={1}>
        {text}
      </Txt>
    </View>
  )
}

function ChannelPhoto({ channelId }: { readonly channelId: string | null }) {
  const { p } = useKit()
  // 사진을 모르면 기본 그림 — 받은 적 있으면 바로 (홈 "지금 라이브 중"과 같은 경로, D-UX4-77)
  const avatar = useCachedGet<{ avatar: string | null }>(channelId === null || channelId === '' ? null : `/api/youtube/channels/${encodeURIComponent(channelId)}/avatar`).data?.avatar ?? null
  const size = LINK_INFO_ICON
  if (avatar !== null) return <Image aria-hidden testID="link-info-avatar" source={{ uri: avatar }} style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous' }} />
  return (
    <View aria-hidden testID="link-info-avatar" style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="play" color={p.textSub} size={12} />
    </View>
  )
}

export interface LinkInfoProps {
  readonly broadcastId: string
  readonly yt: MobileYoutube
  /** 끝났거나 닫힌 라이브 — 채팅 다시 받기·연결 끊기 줄이 없다 */
  readonly closed: boolean
  /** 끊은 뒤 (없으면 연결 끊기 줄이 없다 — 판매자만 준다) */
  readonly onEnded?: () => void
  /** 부모가 양옆 여백을 둔 곳(FormPage·FullSheet 안)이면 true — 줄을 화면 끝까지 넓힌다 */
  readonly bleed?: boolean
}

/** 이은 라이브 정보 줄 + 메뉴 줄 (제목 없이). 부모는 화면 끝까지 넓어야 한다 — FormPage·FullSheet 안이면 bleed */
export function LinkInfo({ broadcastId, yt, closed, onEnded, bleed = false }: LinkInfoProps) {
  const link = yt.link?.link ?? null
  const collector = yt.link?.collector ?? null
  const names = useLiveNames(yt)
  // 앱의 라이브 이름 (미리 보기를 못 읽을 때) — 홈이 받아 둔 목록이면 바로
  const list = useCachedGet<{ broadcasts: BroadcastItem[] }>(names.done && names.title === null ? '/api/broadcasts' : null).data
  const mine = list?.broadcasts.find((item) => item.id === broadcastId)
  // 읽는 동안은 빈 값 (줄이 나중에 끼어들어 들썩이지 않게)
  const title = names.title ?? (mine === undefined ? '' : broadcastTitle(mine))
  const channel = link === null ? null : (link.broadcastChannelTitle ?? '').trim() !== '' ? channelName(link.broadcastChannelTitle) : (names.channel ?? channelName(null))
  const [error, setError] = useState<string | null>(null)
  const restart = async () => {
    setError(null)
    try {
      yt.setLink(await withRetry(() => post<LinkView>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/youtube/collector/restart`, {})))
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : '다시 받지 못했어요. 다시 눌러 주세요.')
    }
  }
  const platform: LivePlatform = 'youtube'
  const padded = { paddingHorizontal: PLAIN.side }
  return (
    <View testID="link-info" style={bleed ? { marginHorizontal: -PAGE.side } : undefined}>
      {/* 채팅을 못 받는 동안의 경고 (판매자 안전 — 라이브 화면 맨 위와 같은 문장) */}
      <View style={padded}>
        <YoutubeWarning yt={yt} closed={closed} />
      </View>
      {error !== null ? (
        <View style={padded}>
          <Notice tone="danger" alert>
            {error}
          </Notice>
        </View>
      ) : null}
      <View>
        <PlainRow title={LINK_INFO_ROWS.platform} testID="link-info-platform" ariaLabel={`${LINK_INFO_ROWS.platform} ${PLATFORM_WORD[platform]}`} right={<IconValue icon={<PlatformIcon platform={platform} size={LINK_INFO_ICON} />} text={PLATFORM_WORD[platform]} />} />
        {link === null ? null : <PlainRow title={LINK_INFO_ROWS.title} testID="link-info-title" ariaLabel={`${LINK_INFO_ROWS.title} ${title}`} right={<TextValue text={title} />} />}
        {channel === null ? null : (
          <PlainRow title={LINK_INFO_ROWS.channel} testID="link-info-channel" ariaLabel={`${LINK_INFO_ROWS.channel} ${channel}`} right={<IconValue icon={<ChannelPhoto channelId={link?.broadcastChannelId ?? link?.channelId ?? null} />} text={channel} />} />
        )}
      </View>
      <View style={{ height: SPACE.lg }} />
      <View>
        {link === null ? null : <PlainRow title={LINK_INFO_ROWS.open} testID="link-info-open" onPress={() => void openExternal(liveWatchUrl(link.videoId))} />}
        {!closed && collector?.restartable === true ? <PlainRow title={LINK_INFO_ROWS.restart} testID="link-info-restart" onPress={() => void restart()} /> : null}
        {onEnded === undefined || closed ? null : <EndBroadcastRow broadcastId={broadcastId} onEnded={onEnded} plain />}
      </View>
    </View>
  )
}

/** 라이브 연결 흰 화면 (뒤로 · 큰 제목 "라이브 연결" · LinkInfo) — 쌓인 경로와 앱 안 판이 같이 쓴다 */
export function LinkInfoPage({ onBack, backLabel, ...props }: LinkInfoProps & { readonly onBack: () => void; readonly backLabel?: string }) {
  const inset = useBottomInset()
  return (
    <StackPage name={LINK_INFO_TITLE} onBack={onBack} scroll={false} testID="link-info-page" {...(backLabel === undefined ? {} : { backLabel })}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: Math.max(inset, SPACE.md) + SPACE.xxl }}>
        <PlainTitle title={LINK_INFO_TITLE} />
        <LinkInfo {...props} bleed={false} />
      </ScrollView>
    </StackPage>
  )
}
