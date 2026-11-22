// 새 방송 (D-UX3-09·10, 사용자 지시 2026-11-03): 쌓인 경로 화면 두 장 — 밀어서 뒤로 가기가 된다.
// 1) "어떤 방송인가요?" — 판매 종류(다육이·화분·기타) 하나를 누른다. 제목 칸은 없다: 제목은 `2026-11-03 화요일 다육이 방송`(기타는 종류 없이).
// 2) "방송 주소를 넣어 주세요" — 방송 주소 칸(클립보드에 유튜브 주소가 있으면 미리 채움), 주소를 넣으면 맨 아래 [확인]가
//    방송을 만들고 바로 잇는다. [링크를 모르겠어요] → 유튜브·틱톡·밴드 고르기 → 앱 안 브라우저에서 내 라이브에 들어가
//    [이 라이브예요]를 누르면 그 링크로 [다음]과 똑같이 이어진다 (D-UX4-160~162). 틱톡·밴드는 주소가 아니라 가게 계정으로 잇는다 — 그 안내와 [방송 만들기].
// 유튜브를 이을 수 없는 서버(읽기 꺼짐·구글 연결 없음)면 종류를 누르는 대로 방송을 만들고 방송 화면으로 간다(그 화면이 연결 안내를 보인다).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import type { WriteResult, YoutubeConnectionResponse, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'
import { kstToday } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { recheckSession } from '../services.tsx'
import { LIVE_PLATFORMS, type PlatformTarget } from '../lib/open-app.ts'
import { browserStart, type BrowserHints } from '../lib/live-browser.ts'
import { readModeOf } from '../lib/youtube.ts'
import { peekCached, useCachedGet } from '../lib/cached-get.ts'
import { trackNewLink } from '../lib/new-link.ts'
import { LiveBrowser, type LiveBrowserOpen } from './LiveBrowser.tsx'
import { useSheetHandoff } from './console/claim-actions.ts'
import { BottomSheet, FormPage, Icon, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { defaultBroadcastTitle, startErrorMessage } from './HomeScreen.tsx'
import { LINK_ASK_TITLE, LinkPages, markLinkAsked, prefetchRecentLives, sendLiveLink, useAddressLinker, type LiveLinkRequest } from './console/YoutubeSection.tsx'

/** 판매 종류 — 늘릴 때는 여기에 한 줄 (word가 제목에 들어간다. 기타는 제목에 넣지 않는다) */
export const SALE_CATEGORIES: readonly { readonly key: string; readonly word: string; readonly inTitle: boolean; readonly icon: string }[] = [
  { key: 'succulent', word: '다육이', inTitle: true, icon: '🌵' },
  { key: 'pot', word: '화분', inTitle: true, icon: '🪴' },
  { key: 'other', word: '기타', inTitle: false, icon: '📦' },
]

export function categoryOf(key: string | undefined): (typeof SALE_CATEGORIES)[number] {
  return SALE_CATEGORIES.find((item) => item.key === key) ?? (SALE_CATEGORIES[SALE_CATEGORIES.length - 1] as (typeof SALE_CATEGORIES)[number])
}

/** 새 방송 제목: `2026-11-03 화요일 다육이 방송` (기타는 `2026-11-03 화요일 방송`) */
export function categoryBroadcastTitle(date: string, categoryKey: string | undefined): string {
  const category = categoryOf(categoryKey)
  const plain = defaultBroadcastTitle(date)
  return category.inTitle ? plain.replace(/ 라이브$/, ` ${category.word} 라이브`) : plain
}

export interface NewBroadcastNavigation {
  readonly back: () => void
  /** 주소 단계로 (쌓인 화면) */
  readonly openAddress: (category: string) => void
  /** 만든 방송 화면으로 — 새 방송 화면들은 걷어 내고 홈 위에 쌓는다 */
  readonly openConsole: (id: string) => void
  /** 링크를 이은 뒤 라벨 단계로 (D-UX3-19, 쌓인 화면) — 없으면 바로 방송 화면 */
  readonly openLabelSetup?: (id: string) => void
}

/** 이 서버에서 유튜브 방송을 주소로 이을 수 있나. undefined = 확인 중, null = 못 잇는다 */
function useLinkRoute(): { readonly webChat: YoutubeWebChat | null } | null | undefined {
  // 기억해 둔 연결 상태로 바로 정하고 뒤에서 다시 받는다 (D-UX4-77) — 못 받으면 못 잇는다
  const { data: body, error } = useCachedGet<YoutubeConnectionResponse>('/api/youtube/connection')
  return useMemo(() => {
    if (body === null) return error === null ? undefined : null
    const { webChat } = readModeOf(body)
    if (webChat !== null) return webChat.on ? { webChat } : null
    return body.connection?.status === 'CONNECTED' ? { webChat: null } : null
  }, [body, error])
}

/** 방송 만들기 — 방송 화면에 들어오기 전까지 목록에 보이지 않게 만드는 중으로 (D-UX3-25). (요청 번호는 같은 입력을 다시 보낼 때 그대로 — 두 번 만들지 않는다). 거절이면 문장을 남기고 null */
function useMakeBroadcast() {
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const make = async (title: string): Promise<string | null> => {
    if (pending.current?.key !== title) pending.current = { key: title, requestId: newRequestId() }
    const { requestId } = pending.current
    setError(null)
    setBusy(true)
    try {
      const result = await withRetry(() => post<WriteResult & { left?: boolean }>('/api/broadcasts', { requestId, title, draft: true }))
      pending.current = null
      // 같이 보던 다른 계정의 라이브에서 나와 내 가게에 만들었다 — 내 정보를 다시 읽어 내 가게 자료로 돌아온다 (D-SHARE-LIVE-01)
      if (result.left === true) await recheckSession()
      return result.broadcast?.id ?? null
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setError(caught)
      return null
    } finally {
      setBusy(false)
    }
  }
  return { make, error, busy, clearError: () => setError(null) }
}

function MakeError({ error }: { readonly error: ApiError | null }) {
  return error === null ? null : (
    <Notice tone="danger" alert>
      {startErrorMessage(error)}
    </Notice>
  )
}

/** 1단계: 판매 종류 고르기 */
export function NewBroadcastCategoryScreen({ nav }: { readonly nav: NewBroadcastNavigation }) {
  const { p } = useKit()
  // 다음 링크 화면의 최근 연결한 채널을 고르는 동안 미리 받는다 (D-RECENT-PREFETCH-01)
  useEffect(() => {
    prefetchRecentLives()
  }, [])
  // 유튜브·틱톡·밴드 모두 링크로 이을 수 있어 늘 링크 단계로 간다 (D-UX3-14 — 전에는 유튜브를 이을 수 없는 서버면 바로 만들었다)
  return (
    <FormPage title="어떤 라이브인가요?" name="새 라이브" onBack={nav.back}>
      <View role="group" aria-label="판매 종류" style={{ gap: SPACE.sm, marginHorizontal: -SPACE.sm }}>
        {SALE_CATEGORIES.map((item) => (
          <Tap
            key={item.key}
            role="button"
            aria-label={item.word}
            onPress={() => nav.openAddress(item.key)}
            style={({ pressed }) => ({ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}
          >
            {/* 토스처럼 둥근 바탕 위 그림 글자 (장식) */}
            <View aria-hidden style={{ width: 44, height: 44, borderRadius: 22, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Text allowFontScaling={false} style={{ fontSize: 24, lineHeight: 30 }}>
                {item.icon}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Txt step="lead" weight="bold">
                {item.word}
              </Txt>
            </View>
            <Icon name="chevron" color={p.textSub} size={20} />
          </Tap>
        ))}
      </View>
    </FormPage>
  )
}

/** 2단계: 방송 주소 */
export function NewBroadcastAddressScreen({ category, nav }: { readonly category: string | undefined; readonly nav: NewBroadcastNavigation }) {
  const route = useLinkRoute()
  const { make, error, busy, clearError } = useMakeBroadcast()
  const made = useRef<string | null>(null)
  const [madeId, setMadeId] = useState<string | null>(null)
  const [finder, setFinder] = useState(false)
  const title = categoryBroadcastTitle(kstToday(), category)

  /** 아직 안 만들었으면 만든다 (한 번만 — 잇기를 다시 눌러도 방송을 또 만들지 않는다) */
  const ensureMade = async (): Promise<string | null> => {
    if (made.current !== null) return made.current
    const id = await make(title)
    if (id !== null) {
      made.current = id
      setMadeId(id)
      // 주소 단계를 거쳤다 — 방송 화면이 연결 판을 다시 저절로 열지 않는다
      markLinkAsked(id)
    }
    return id
  }
  // 이 방송에 이은 링크 (D-UX3-19 고침, 사용자 지시 2026-11-03 "다음 화면 넘어갔다가 다시 뒤로가면 다시 그 링크로 연결을 못하는 버그 —
  // 방송이 확정돼 홈에 보이기 전까지는 링크 막으면 안 돼"): 라벨 단계에서 뒤로 와 [확인]을 다시 누르면 같은 링크는 다시 보내지 않고(서버는
  // '이미 이어져 있어요'로 거절한다) 그대로 다음으로, 다른 링크면 먼저 이은 것을 끊고 새 링크를 잇는다.
  const linked = useRef<{ readonly key: string; readonly platform: LiveLinkRequest['platform'] } | null>(null)
  const linkNew = async (request: LiveLinkRequest) => {
    const id = await ensureMade()
    if (id === null) return
    const key = linkKey(request)
    const openLabels = nav.openLabelSetup
    if (linked.current?.key === key) {
      if (openLabels !== undefined) openLabels(id)
      else nav.openConsole(id)
      return
    }
    const work = (async () => {
      if (linked.current !== null) {
        await unlinkLive(id, linked.current.platform)
        linked.current = null
      }
      await sendLiveLink(id, request)
      linked.current = { key, platform: request.platform }
    })()
    // 방송 화면 전에 라벨을 뽑을지 묻는다 (D-UX3-19) — 잇기를 기다리지 않고 바로 연다 (D-LINK-ASYNC-01): 서버가 유튜브를 다시 읽는 1~3초 동안
    // 판매자는 프린터를 잇는다. 못 이으면 프린터 화면이 이 화면으로 돌아오고, 까닭(옮길까요·처음 채널·오류)은 아래 await가 던져 이 화면이 보인다.
    // 라벨 단계가 없으면(바로 방송 화면 — 이 화면이 닫힌다) 옛처럼 이은 뒤에 간다
    if (openLabels !== undefined) {
      trackNewLink(id, work)
      openLabels(id)
      await work
    } else {
      await work
      nav.openConsole(id)
    }
  }
  const linker = useAddressLinker({ enabled: route !== undefined, webChat: route?.webChat ?? null, broadcastId: madeId, submit: linkNew, disabled: busy, onEdit: clearError, onUnknown: () => setFinder(true), confirmNotice: <MakeError error={error} /> })

  // 링크 화면 → [다음] → 연결 확인 화면 (D-UX4-117)
  return (
    <LinkPages linker={linker} name="새 라이브">
      <FormPage title={LINK_ASK_TITLE} name="새 라이브" onBack={nav.back} overlay={linker.popup} actions={linker.action}>
        {route !== undefined ? linker.fields : null}
        <MakeError error={error} />
        <PlatformFinder visible={finder} onClose={() => setFinder(false)} onFound={linker.submitFound} knownChannel={linker.knownChannel} />
      </FormPage>
    </LinkPages>
  )
}

/** 같은 링크인지 견줄 열쇠 (요청 번호는 빼고) */
export function linkKey(request: LiveLinkRequest): string {
  if (request.platform === 'youtube') return `youtube ${request.body.video}`
  if (request.platform === 'tiktok') return `tiktok ${request.body.url}`
  return `band ${request.body.bandKey}/${request.body.postKey}`
}

/** 새 방송 화면에서 먼저 이은 연결 끊기 (다른 링크로 바꿀 때) */
async function unlinkLive(broadcastId: string, platform: LiveLinkRequest['platform']): Promise<void> {
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}`
  const requestId = newRequestId()
  if (platform === 'youtube') await withRetry(() => post(`${base}/youtube/unlink`, { requestId }))
  else if (platform === 'tiktok') await withRetry(() => post(`${base}/live/unlink`, { requestId, platform: 'TIKTOK' }))
  else await withRetry(() => post(`${base}/band/unlink`, { requestId }))
}

/**
 * [링크를 모르겠어요] 판 (D-UX3-10·14 → D-UX4-160, 사용자 지시 2026-11-16 "그냥 우리 앱 안에서 브라우저 띄워서 해당 라이브 들어간 다음에,
 * 밑에 [이 라이브에요] 버튼을 누르면 자동으로 그 라이브로 연결되도록"): 플랫폼 셋(아이콘 + 이름). 누르면 판을 닫고 앱 안 브라우저(LiveBrowser)를
 * 그 플랫폼의 시작 주소로 연다 — 판매자의 채널·계정을 알면 그 라이브 쪽, 모르면 모바일 웹 첫 화면(browserStart).
 * [이 라이브예요]를 누르면 브라우저를 닫고 onFound(링크) — 화면이 링크 칸에 넣고 [다음]과 똑같이 진행한다(linker.submitFound).
 * 옛 흐름(그 앱이나 앱 밖 브라우저를 열고 공유 → 링크 복사 → 돌아와 [붙여넣기])은 없앴다. [붙여넣기] 칩은 그대로.
 */
/** 플랫폼 고르기 판 제목·설명 (D-UX4-114 → 설명 D-UX4-160) */
export const FINDER_TITLE = '어디서 라이브하시나요?'
export const FINDER_DESCRIPTION = '내 라이브 화면에 들어가서\n‘이 라이브예요’를 눌러 주세요'

/** 판이 열릴 때 브라우저 시작 주소에 쓸 것을 미리 받는다 — 못 받으면 첫 화면에서 시작 (새 서버 요청 없음: 이미 있는 읽기만) */
function useBrowserHints(visible: boolean, knownChannel: string | null): BrowserHints {
  const [hints, setHints] = useState<{ youtubeChannel: string | null; tiktokId: string | null }>({ youtubeChannel: null, tiktokId: null })
  useEffect(() => {
    if (!visible) return
    let alive = true
    const cached = peekCached<YoutubeConnectionResponse>('/api/youtube/connection')
    const connection = cached === null ? get<YoutubeConnectionResponse>('/api/youtube/connection').catch(() => null) : Promise.resolve(cached)
    void connection.then((body) => {
      // 연결 칸이 비어 오는 서버도 있다(구글 연결 없이 읽는 서버)
      const id = (body?.connection as YoutubeConnectionResponse['connection'] | null | undefined)?.channel?.id ?? null
      if (alive && id !== null) setHints((now) => ({ ...now, youtubeChannel: id }))
    })
    void get<{ tiktok?: { tiktokId?: string | null } }>('/api/tiktok').then(
      (body) => {
        const id = body.tiktok?.tiktokId ?? null
        if (alive && typeof id === 'string' && id !== '') setHints((now) => ({ ...now, tiktokId: id }))
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [visible])
  // 구글 연결 채널이 없으면 최근 연결한 채널 (남의 채널에서 라이브하는 판매자도 많다 — 최근 이은 채널이 더 맞을 때가 많다)
  return { youtubeChannel: knownChannel ?? hints.youtubeChannel, tiktokId: hints.tiktokId }
}

export function PlatformFinder({ visible, onClose, onFound, knownChannel = null }: { readonly visible: boolean; readonly onClose: () => void; readonly onFound: (url: string) => void; readonly knownChannel?: string | null }) {
  const { p } = useKit()
  const hints = useBrowserHints(visible, knownChannel)
  const [browser, setBrowser] = useState<LiveBrowserOpen | null>(null)
  const opened = useRef(0)
  // 아이폰은 판(Modal)이 닫히는 동안 새 판을 띄우지 못한다 — 다 닫힌 뒤 연다 (웹은 바로)
  const handoff = useSheetHandoff()
  const pick = (target: PlatformTarget) => {
    const url = browserStart(target.key, hints)
    onClose()
    handoff(() => {
      opened.current += 1
      setBrowser({ id: opened.current, url })
    })
  }
  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title={FINDER_TITLE} description={FINDER_DESCRIPTION}>
        <View role="group" aria-label="라이브 플랫폼" style={{ gap: SPACE.xs, marginHorizontal: -SPACE.sm }}>
          {LIVE_PLATFORMS.map((target) => (
            <Tap key={target.key} role="button" aria-label={target.word} onPress={() => pick(target)} style={({ pressed }) => ({ minHeight: TOUCH.min + 16, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
              <PlatformIcon platform={target.key} />
              <View style={{ flex: 1 }}>
                <Txt step="bodyLarge" weight="bold">
                  {target.word}
                </Txt>
              </View>
              <Icon name="chevron" color={p.textSub} size={20} />
            </Tap>
          ))}
        </View>
      </BottomSheet>
      <LiveBrowser
        open={browser}
        onClose={() => setBrowser(null)}
        onPick={(url) => {
          setBrowser(null)
          // 브라우저 판이 다 내려간 뒤 잇기를 시작한다 (틱톡 옮기기 팝업 등이 판 위에 뜰 수 있게)
          handoff(() => onFound(url))
        }}
      />
    </>
  )
}

export { PlatformIcon } from '../ui/PlatformIcon.tsx'
