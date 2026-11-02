// 새 방송 (D-UX3-09·10, 사용자 지시 2026-11-03): 쌓인 경로 화면 두 장 — 밀어서 뒤로 가기가 된다.
// 1) "어떤 방송인가요?" — 판매 종류(다육이·화분·기타) 하나를 누른다. 제목 칸은 없다: 제목은 `2026-11-03 화요일 다육이 방송`(기타는 종류 없이).
// 2) "방송 주소를 넣어 주세요" — 방송 주소 칸(클립보드에 유튜브 주소가 있으면 미리 채움), 주소를 넣으면 맨 아래 [이 방송에 잇기]가
//    방송을 만들고 바로 잇는다. [방송 주소를 모르겠어요] → 유튜브·틱톡·밴드 고르기 → 그 앱(없으면 앱 안 브라우저)에서 내 방송의
//    공유 → 링크 복사 후 돌아오면 주소가 저절로 들어간다. 틱톡·밴드는 주소가 아니라 가게 계정으로 잇는다 — 그 안내와 [방송 만들기].
// 유튜브를 이을 수 없는 서버(읽기 꺼짐·구글 연결 없음)면 종류를 누르는 대로 방송을 만들고 방송 화면으로 간다(그 화면이 연결 안내를 보인다).
import { useEffect, useRef, useState } from 'react'
import { Image, Pressable, Text, View, type ImageSourcePropType } from 'react-native'
import youtubeLogo from '../../assets/platforms/youtube.png'
import tiktokLogo from '../../assets/platforms/tiktok.png'
import bandLogo from '../../assets/platforms/band.png'
import type { WriteResult, YoutubeConnectionResponse, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'
import { kstToday } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { LIVE_PLATFORMS, openPlatform, type LivePlatform, type PlatformTarget } from '../lib/open-app.ts'
import { readModeOf } from '../lib/youtube.ts'
import { BigButton, BottomSheet, FormPage, Icon, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { defaultBroadcastTitle, startErrorMessage } from './HomeScreen.tsx'
import { markLinkAsked, useAddressLinker, type LinkBody } from './console/YoutubeSection.tsx'

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
  return category.inTitle ? plain.replace(/ 방송$/, ` ${category.word} 방송`) : plain
}

export interface NewBroadcastNavigation {
  readonly back: () => void
  /** 주소 단계로 (쌓인 화면) */
  readonly openAddress: (category: string) => void
  /** 만든 방송 화면으로 — 새 방송 화면들은 걷어 내고 홈 위에 쌓는다 */
  readonly openConsole: (id: string) => void
}

/** 이 서버에서 유튜브 방송을 주소로 이을 수 있나. undefined = 확인 중, null = 못 잇는다 */
function useLinkRoute(): { readonly webChat: YoutubeWebChat | null } | null | undefined {
  const [route, setRoute] = useState<{ readonly webChat: YoutubeWebChat | null } | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    get<YoutubeConnectionResponse>('/api/youtube/connection').then(
      (body) => {
        if (!alive) return
        const { webChat } = readModeOf(body)
        if (webChat !== null) setRoute(webChat.on ? { webChat } : null)
        else setRoute(body.connection?.status === 'CONNECTED' ? { webChat: null } : null)
      },
      () => {
        if (alive) setRoute(null)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return route
}

/** 방송 만들기 (요청 번호는 같은 입력을 다시 보낼 때 그대로 — 두 번 만들지 않는다). 거절이면 문장을 남기고 null */
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
      const result = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId, title }))
      pending.current = null
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
  const route = useLinkRoute()
  const { make, error, busy } = useMakeBroadcast()
  const [picked, setPicked] = useState<string | null>(null)

  const go = async (key: string) => {
    if (route !== null) {
      nav.openAddress(key)
      return
    }
    // 주소로 이을 수 없는 서버 — 바로 만들고 방송 화면이 연결 안내를 보인다
    const id = await make(categoryBroadcastTitle(kstToday(), key))
    if (id !== null) nav.openConsole(id)
  }
  // 확인이 끝나기 전에 눌렀으면 끝나는 대로 이어 간다(눌렀는데 아무 일 없는 단추가 되지 않게)
  useEffect(() => {
    if (picked === null || route === undefined) return
    setPicked(null)
    void go(picked)
    // go는 누른 그때 값으로 충분하다 — 확인이 끝날 때 한 번만
  }, [picked, route])

  return (
    <FormPage title="어떤 방송인가요?" name="새 방송" onBack={nav.back}>
      <View role="group" aria-label="판매 종류" style={{ gap: SPACE.sm, marginHorizontal: -SPACE.sm }}>
        {SALE_CATEGORIES.map((item) => (
          <Pressable
            key={item.key}
            role="button"
            aria-label={item.word}
            aria-busy={busy || picked === item.key}
            disabled={busy}
            onPress={() => (route === undefined ? setPicked(item.key) : void go(item.key))}
            style={({ pressed }) => ({ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, backgroundColor: pressed ? p.pressed : 'transparent' })}
          >
            {/* 토스처럼 둥근 바탕 위 그림 글자 (장식) */}
            <View aria-hidden style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
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
          </Pressable>
        ))}
      </View>
      <MakeError error={error} />
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
  const linkNew = async (body: LinkBody) => {
    const id = await ensureMade()
    if (id === null) return
    await withRetry(() => post(`/api/broadcasts/${encodeURIComponent(id)}/youtube`, body))
    nav.openConsole(id)
  }
  const makeOnly = async () => {
    const id = await ensureMade()
    if (id !== null) nav.openConsole(id)
  }
  const linker = useAddressLinker({ enabled: route !== null && route !== undefined, webChat: route?.webChat ?? null, broadcastId: madeId, submit: linkNew, autoFocus: true, disabled: busy, onEdit: clearError })

  return (
    <FormPage
      title="방송 링크를 넣어 주세요"
      name="새 방송"
      onBack={nav.back}
      overlay={linker.popup}
      actions={route === null ? <BigButton label="방송 만들기" busy={busy} onPress={() => void makeOnly()} /> : linker.action}
    >
      {route === null ? <Txt color="textSub">지금은 링크로 이을 수 없어요. 방송을 만든 뒤 방송 화면에서 이어 주세요.</Txt> : null}
      {route !== null && route !== undefined ? linker.fields : null}
      {route !== null ? <BigButton kind="outline" label="링크를 모르겠어요" onPress={() => setFinder(true)} /> : null}
      <MakeError error={error} />
      <PlatformFinder
        visible={finder}
        onClose={() => setFinder(false)}
        busy={busy}
        onReturned={() => void linker.recheck()}
        onMakeWithoutAddress={() => {
          setFinder(false)
          void makeOnly()
        }}
      />
    </FormPage>
  )
}

/**
 * [방송 주소를 모르겠어요] 판 (D-UX3-10): 플랫폼 셋(아이콘 + 이름). 유튜브는 앱(없으면 앱 안 브라우저)을 열고, 내 방송에서
 * 공유 → 링크 복사 후 돌아오면 주소 칸이 저절로 채워진다. 틱톡·밴드는 주소로 잇지 않는다 — 계정으로 잇는다는 안내와 [이 방송 만들기].
 */
export function PlatformFinder({ visible, onClose, busy = false, onReturned, onMakeWithoutAddress }: { readonly visible: boolean; readonly onClose: () => void; readonly busy?: boolean; readonly onReturned: () => void; readonly onMakeWithoutAddress?: () => void }) {
  const { p } = useKit()
  const [account, setAccount] = useState<PlatformTarget | null>(null)
  useEffect(() => {
    if (!visible) setAccount(null)
  }, [visible])
  const pick = async (target: PlatformTarget) => {
    if (target.key !== 'youtube') {
      setAccount(target)
      return
    }
    onClose()
    const opened = await openPlatform(target)
    // 앱 안 브라우저는 닫힐 때 끝난다 — 앱이 뒤로 가지 않았으니 여기서 클립보드를 다시 본다(앱으로 갔다 오면 앞으로 옴 알림이 본다)
    if (opened === 'browser') onReturned()
  }
  if (account !== null) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title={`${account.word} 방송`} actions={<>{onMakeWithoutAddress === undefined ? null : <BigButton label="이 방송 만들기" busy={busy} onPress={onMakeWithoutAddress} />}<BigButton kind="outline" label="뒤로" onPress={() => setAccount(null)} /></>}>
        <Txt>{`${account.word} 방송은 링크 대신 가게 계정으로 이어요.`}</Txt>
        <Txt step="caption" color="textSub">
          {onMakeWithoutAddress === undefined ? '컴퓨터의 방송 화면에서 이어 주세요.' : '방송을 만든 뒤 컴퓨터의 방송 화면에서 이어 주세요.'}
        </Txt>
      </BottomSheet>
    )
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} title="어디서 방송하나요?">
      <Txt color="textSub">내 방송의 링크를 복사해 돌아오세요.</Txt>
      <View role="group" aria-label="방송 플랫폼" style={{ gap: SPACE.xs, marginHorizontal: -SPACE.sm }}>
        {LIVE_PLATFORMS.map((target) => (
          <Pressable key={target.key} role="button" aria-label={target.word} onPress={() => void pick(target)} style={({ pressed }) => ({ minHeight: TOUCH.min + 16, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <PlatformIcon platform={target.key} />
            <View style={{ flex: 1 }}>
              <Txt step="bodyLarge" weight="bold">
                {target.word}
              </Txt>
            </View>
            <Icon name="chevron" color={p.textSub} size={20} />
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  )
}

const PLATFORM_LOGO: Readonly<Record<LivePlatform, ImageSourcePropType | string>> = { youtube: youtubeLogo, tiktok: tiktokLogo, band: bandLogo }

/** 플랫폼 아이콘 — 각 앱의 정식 앱 아이콘(앱스토어 그림, D-UX3-12). 장식이라 이름은 옆 글자 */
export function PlatformIcon({ platform, size = 40 }: { readonly platform: LivePlatform; readonly size?: number }) {
  const { p } = useKit()
  const logo = PLATFORM_LOGO[platform]
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size * 0.24, overflow: 'hidden', borderWidth: 1, borderColor: p.line }}>
      <Image source={typeof logo === 'string' ? { uri: logo } : logo} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
    </View>
  )
}
