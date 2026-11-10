// 새 방송 (D-UX3-09·10, 사용자 지시 2026-11-03): 쌓인 경로 화면 두 장 — 밀어서 뒤로 가기가 된다.
// 1) "어떤 방송인가요?" — 판매 종류(다육이·화분·기타) 하나를 누른다. 제목 칸은 없다: 제목은 `2026-11-03 화요일 다육이 방송`(기타는 종류 없이).
// 2) "방송 주소를 넣어 주세요" — 방송 주소 칸(클립보드에 유튜브 주소가 있으면 미리 채움), 주소를 넣으면 맨 아래 [확인]가
//    방송을 만들고 바로 잇는다. [방송 주소를 모르겠어요] → 유튜브·틱톡·밴드 고르기 → 그 앱(없으면 앱 안 브라우저)에서 내 방송의
//    공유 → 링크 복사 후 돌아오면 주소가 저절로 들어간다. 틱톡·밴드는 주소가 아니라 가게 계정으로 잇는다 — 그 안내와 [방송 만들기].
// 유튜브를 이을 수 없는 서버(읽기 꺼짐·구글 연결 없음)면 종류를 누르는 대로 방송을 만들고 방송 화면으로 간다(그 화면이 연결 안내를 보인다).
import { useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import type { WriteResult, YoutubeConnectionResponse, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'
import { kstToday } from '@livejjim/web/src/lib/kst.ts'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { LIVE_PLATFORMS, openPlatform, type PlatformTarget } from '../lib/open-app.ts'
import { readModeOf } from '../lib/youtube.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { BottomSheet, FormPage, Icon, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { defaultBroadcastTitle, startErrorMessage } from './HomeScreen.tsx'
import { LINK_ASK_DESCRIPTION, LINK_ASK_TITLE, LinkSideButtons, markLinkAsked, sendLiveLink, useAddressLinker, type LiveLinkRequest } from './console/YoutubeSection.tsx'

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
      const result = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId, title, draft: true }))
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
    if (linked.current?.key !== key) {
      if (linked.current !== null) {
        await unlinkLive(id, linked.current.platform)
        linked.current = null
      }
      await sendLiveLink(id, request)
      linked.current = { key, platform: request.platform }
    }
    // 방송 화면 전에 라벨을 뽑을지 묻는다 (D-UX3-19)
    if (nav.openLabelSetup !== undefined) nav.openLabelSetup(id)
    else nav.openConsole(id)
  }
  const linker = useAddressLinker({ enabled: route !== undefined, webChat: route?.webChat ?? null, broadcastId: madeId, submit: linkNew, disabled: busy, onEdit: clearError })

  return (
    <FormPage
      title={LINK_ASK_TITLE}
      description={LINK_ASK_DESCRIPTION}
      name="새 라이브"
      onBack={nav.back}
      overlay={linker.popup}
      actions={linker.action}
    >
      {route !== undefined ? linker.fields : null}
      <LinkSideButtons onUnknown={() => setFinder(true)} paste={route !== undefined ? linker.paste : null} />
      <MakeError error={error} />
      <PlatformFinder visible={finder} onClose={() => setFinder(false)} onReturned={() => void linker.recheck()} />
    </FormPage>
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
 * [링크를 모르겠어요] 판 (D-UX3-10·14): 플랫폼 셋(아이콘 + 이름). 누르면 그 앱(없으면 앱 안 브라우저)을 열고, 내 방송에서
 * 공유 → 링크 복사 후 돌아오면 [붙여넣기]로 넣는다. 유튜브·틱톡·밴드 모두 같다(전에는 틱톡·밴드는 계정으로 잇는다는 안내만).
 */
export function PlatformFinder({ visible, onClose, onReturned }: { readonly visible: boolean; readonly onClose: () => void; readonly onReturned: () => void }) {
  const { p } = useKit()
  const pick = async (target: PlatformTarget) => {
    onClose()
    const opened = await openPlatform(target)
    // 앱 안 브라우저는 닫힐 때 끝난다 — 앱이 뒤로 가지 않았으니 여기서 클립보드를 다시 본다(앱으로 갔다 오면 앞으로 옴 알림이 본다)
    if (opened === 'browser') onReturned()
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} title="어디서 라이브하나요?">
      <Txt color="textSub">내 라이브의 링크를 복사해 돌아오세요.</Txt>
      <View role="group" aria-label="라이브 플랫폼" style={{ gap: SPACE.xs, marginHorizontal: -SPACE.sm }}>
        {LIVE_PLATFORMS.map((target) => (
          <Tap key={target.key} role="button" aria-label={target.word} onPress={() => void pick(target)} style={({ pressed }) => ({ minHeight: TOUCH.min + 16, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
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
  )
}

export { PlatformIcon } from '../ui/PlatformIcon.tsx'
