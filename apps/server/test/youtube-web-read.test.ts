// YT-11 AC4·AC3·AC6 서버 웹 읽기 — 순수 함수 (D-YT-SRV-04·05·07): get_live_chat 응답·방송 페이지·채팅 페이지 읽기, 간격·백오프, 끄기 스위치.
// 녹화본(test/fixtures/youtube-web): 2026-10-31 실제 공개 라이브 두 곳(상시 음악·뉴스)의 응답을 녹화 도구가 메모리에서 가린 것 —
// 닉네임(시청자N)·채널 ID(UCfakeviewer…)·글(글N)·사진 주소(example.invalid)·메시지 ID(msg-N)·방문 값·지점(CONT-N)·추적 값(…)을 바꿨고 게시 시각은 2026-01-01로 옮겼다.
// 녹화본에 없는 종류(슈퍼챗·멤버십·주인·운영자·바꿔 넣기·작성자 글 모두 지움·끝·모르는 모양)는 공개된 모양을 본뜬 자료로 시험한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readYoutubeWebChat } from '../src/config.ts'
import { WEB_BLOCKED_BACKOFF_MS, WEB_FAILURE_BACKOFF_MS, backoffMs, nextWaitMs } from '../src/youtube/web-chat-source.ts'
import { parseChatPage, parseLiveChat, parseWatchPage, textOf, usecToMs } from '../src/youtube/web-chat.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/youtube-web/${name}`, import.meta.url), 'utf8')

const ok = (json: unknown) => {
  const parsed = parseLiveChat(json)
  if (parsed.kind !== 'ok') throw new Error(`ok가 아님: ${parsed.kind}`)
  return parsed
}

/** 응답 하나 (본뜬 모양) */
const response = (actions: unknown[], continuations: unknown[] | null = [{ invalidationContinuationData: { continuation: 'NEXT', timeoutMs: 7000 } }]) => ({
  responseContext: {},
  continuationContents: { liveChatContinuation: { ...(continuations === null ? {} : { continuations }), actions } },
})
const text = (id: string, extra: Record<string, unknown> = {}) => ({
  addChatItemAction: { item: { liveChatTextMessageRenderer: { id, timestampUsec: '1767225600123456', authorExternalChannelId: `UC_${id}`, authorName: { simpleText: `이름${id}` }, message: { runs: [{ text: '15번' }] }, ...extra } } },
})

describe('AC4 녹화본 읽기 (실제 응답 모양)', () => {
  it('녹화본 A: 일반 채팅 56개 — ID·작성자 채널 ID·이름·글·게시 시각(마이크로초 → 밀리초 내림), 지움 10개, 선물·시스템 글은 기록하지 않음, 다음 지점·timeoutMs', () => {
    const parsed = ok(JSON.parse(fixture('get-live-chat-a.json')))
    expect(parsed.chats).toHaveLength(56)
    expect(parsed.deleted).toHaveLength(10)
    expect(parsed.removedAuthors).toEqual([])
    expect(parsed.next).toBe('CONT-0001')
    expect(parsed.timeoutMs).toBe(10_000)
    expect(parsed.unreadable).toBe(0)
    // 선물(giftMessageViewModel)·시스템 글(liveChatViewerEngagementMessageRenderer)은 아는 종류 — 모르는 종류로 세지 않는다
    expect(parsed.unknown).toEqual([])
    expect(parsed.chats[0]).toEqual({ id: 'msg-0004', ch: 'UCfakeviewer000000000001', nick: '시청자1', text: '글1', owner: false, publishedAt: 1767225600000, timestampUsec: '1767225600000000', kind: 'TEXT' })
    // 마이크로초는 받은 글 그대로, 밀리초는 내림
    expect(parsed.chats[1]).toMatchObject({ timestampUsec: '1767225610442182', publishedAt: 1767225610442, text: '글2🧐' })
    for (const chat of parsed.chats) {
      expect(chat.ch).toMatch(/^UCfakeviewer\d{12}$/)
      expect(chat.publishedAt).toBe(Number(BigInt(chat.timestampUsec) / 1000n))
    }
    // 유튜브 전용 이모지는 첫 줄임말
    expect(parsed.chats.some((chat) => chat.text.includes(':_custom:'))).toBe(true)
    expect(new Set(parsed.chats.map((chat) => chat.id)).size).toBe(56)
  })

  it('녹화본 B: 일반 채팅 63개, 자리 표시는 기록하지 않음(모르는 종류도 아님), 표준 이모지는 그 글자', () => {
    const parsed = ok(JSON.parse(fixture('get-live-chat-b.json')))
    expect(parsed.chats).toHaveLength(63)
    expect(parsed.unknown).toEqual([])
    expect(parsed.unreadable).toBe(0)
    expect(parsed.next).toBe('CONT-0001')
    expect(parsed.timeoutMs).toBe(3000)
    expect(parsed.chats.some((chat) => chat.text.includes('🔥'))).toBe(true)
    expect(parsed.chats.every((chat) => chat.kind === 'TEXT' && !chat.owner)).toBe(true)
  })

  it('채팅 페이지 녹화본: 기본으로 고른 인기 채팅(Top chat)이 아니라 전체 채팅(Live chat) 지점, 호출 정보는 페이지 값', () => {
    expect(parseChatPage(fixture('chat-page.html'))).toEqual({
      state: 'OK',
      session: { apiKey: 'fake-key', clientName: 'WEB', clientVersion: '2.20261029.01.00', visitorData: 'fake-visitor' },
      continuation: 'CONT-0006',
    })
  })
})

describe('AC4 종류별 읽기 (본뜬 모양)', () => {
  it('슈퍼챗·멤버십은 시청자 글이 있을 때만, 스티커·말없는 슈퍼챗·새 멤버 알림은 기록하지 않음', () => {
    const paid = (id: string, message: unknown) => ({ addChatItemAction: { item: { liveChatPaidMessageRenderer: { id, timestampUsec: '1767225600000000', authorExternalChannelId: 'UCa', authorName: { simpleText: 'A' }, purchaseAmountText: { simpleText: '₩1,000' }, ...(message === null ? {} : { message }) } } } })
    const member = (id: string, message: unknown) => ({ addChatItemAction: { item: { liveChatMembershipItemRenderer: { id, timestampUsec: '1767225600000000', authorExternalChannelId: 'UCb', authorName: { simpleText: 'B' }, headerSubtext: { simpleText: 'Welcome!' }, ...(message === null ? {} : { message }) } } } })
    const sticker = { addChatItemAction: { item: { liveChatPaidStickerRenderer: { id: 's1', timestampUsec: '1767225600000000', authorExternalChannelId: 'UCc', authorName: { simpleText: 'C' } } } } }
    const parsed = ok(response([paid('p1', { runs: [{ text: '16번 주세요' }] }), paid('p2', null), member('m1', { runs: [{ text: '17' }] }), member('m2', null), sticker]))
    expect(parsed.chats.map((chat) => [chat.id, chat.kind, chat.text])).toEqual([
      ['p1', 'SUPER_CHAT', '16번 주세요'],
      ['m1', 'MEMBERSHIP', '17'],
    ])
    expect(parsed.unknown).toEqual([])
    expect(parsed.unreadable).toBe(0)
  })

  it('owner는 채널 주인 배지만 — 운영자·인증·멤버 배지는 시청자', () => {
    const badge = (iconType: string | null) => ({ liveChatAuthorBadgeRenderer: iconType === null ? { customThumbnail: { thumbnails: [] }, tooltip: 'Member (2 months)' } : { icon: { iconType }, tooltip: iconType } })
    const parsed = ok(response([text('a', { authorBadges: [badge('OWNER')] }), text('b', { authorBadges: [badge('MODERATOR')] }), text('c', { authorBadges: [badge('VERIFIED'), badge(null)] }), text('d')]))
    expect(parsed.chats.map((chat) => chat.owner)).toEqual([true, false, false, false])
  })

  it('글 조각: 글은 그대로, 표준 이모지는 그 글자, 유튜브 전용 이모지는 첫 줄임말', () => {
    expect(textOf({ runs: [{ text: '15번 ' }, { emoji: { emojiId: '😀', shortcuts: [':grinning:'] } }, { text: ' 주세요 ' }, { emoji: { emojiId: 'UCx/abc', shortcuts: [':_cat:', ':cat:'], isCustomEmoji: true } }] })).toBe('15번 😀 주세요 :_cat:')
    expect(textOf({ simpleText: '그대로' })).toBe('그대로')
    expect(textOf(undefined)).toBe('')
  })

  it('바꿔 넣기로 온 메시지도 같은 규칙, 지움(두 모양)·한 작성자 글 모두 지움(두 모양)', () => {
    const replaced = { replaceChatItemAction: { targetItemId: 'r1', replacementItem: text('r1').addChatItemAction.item } }
    const parsed = ok(
      response([
        replaced,
        { markChatItemAsDeletedAction: { targetItemId: 'x1', deletedStateMessage: { runs: [{ text: '[message deleted]' }] } } },
        { removeChatItemAction: { targetItemId: 'x2' } },
        { markChatItemsByAuthorAsDeletedAction: { externalChannelId: 'UCbad1' } },
        { removeChatItemByAuthorAction: { externalChannelId: 'UCbad2' } },
      ]),
    )
    expect(parsed.chats.map((chat) => chat.id)).toEqual(['r1'])
    expect(parsed.deleted).toEqual(['x1', 'x2'])
    expect(parsed.removedAuthors).toEqual(['UCbad1', 'UCbad2'])
  })

  it('ID·작성자 채널 ID·게시 시각 중 하나라도 없으면 기록하지 않고 읽지 못함으로 센다', () => {
    const parsed = ok(response([text('a', { id: undefined }), text('b', { authorExternalChannelId: undefined }), text('c', { timestampUsec: undefined }), text('d', { timestampUsec: 'not-a-number' }), text('e')]))
    expect(parsed.chats.map((chat) => chat.id)).toEqual(['e'])
    expect(parsed.unreadable).toBe(4)
  })

  it('채팅 줄 넣기 안의 모르는 항목 종류는 버리고 이름만 센다 — 다른 모르는 동작(고정 글·띠)은 무시', () => {
    const parsed = ok(response([{ addChatItemAction: { item: { liveChatFutureRenderer: { id: 'f1' } } } }, { addChatItemAction: { item: { liveChatFutureRenderer: {} } } }, { addBannerToLiveChatCommand: {} }, { someNewAction: {} }, text('a')]))
    expect(parsed.unknown).toEqual(['liveChatFutureRenderer', 'liveChatFutureRenderer'])
    expect(parsed.chats).toHaveLength(1)
  })

  it('다음 지점: invalidation·timed 지점과 timeoutMs, 없거나 숫자가 아니면 null, 다시 보기 지점만 있으면 다음 지점 없음(끝 확인 대상)', () => {
    expect(ok(response([], [{ timedContinuationData: { continuation: 'T', timeoutMs: 1500 } }]))).toMatchObject({ next: 'T', timeoutMs: 1500 })
    expect(ok(response([], [{ invalidationContinuationData: { continuation: 'I' } }]))).toMatchObject({ next: 'I', timeoutMs: null })
    expect(ok(response([], [{ invalidationContinuationData: { continuation: 'I', timeoutMs: '5000' } }]))).toMatchObject({ next: 'I', timeoutMs: null })
    expect(ok(response([], [{ liveChatReplayContinuationData: { continuation: 'R' } }]))).toMatchObject({ next: null })
    expect(ok(response([], null))).toMatchObject({ next: null, chats: [] })
  })

  it('모르는 모양·빈 응답·인기 채팅 응답', () => {
    expect(parseLiveChat(null)).toEqual({ kind: 'unknown_shape' })
    expect(parseLiveChat('text')).toEqual({ kind: 'unknown_shape' })
    expect(parseLiveChat({ somethingNew: {} })).toEqual({ kind: 'unknown_shape' })
    expect(parseLiveChat({ continuationContents: { otherContinuation: {} } })).toEqual({ kind: 'unknown_shape' })
    expect(parseLiveChat({ continuationContents: { liveChatContinuation: { actions: {} } } })).toEqual({ kind: 'unknown_shape' })
    expect(parseLiveChat({ responseContext: {} })).toEqual({ kind: 'no_contents' })
    expect(parseLiveChat({ continuationContents: { liveChatContinuation: { liveChatCurrentFilter: 'LIVE_CHAT_FILTER_MODE_DEFAULT', actions: [] } } })).toEqual({ kind: 'unknown_shape' })
    expect(parseLiveChat({ continuationContents: { liveChatContinuation: { liveChatCurrentFilter: 'LIVE_CHAT_FILTER_MODE_UNFILTERED', actions: [] } } })).toMatchObject({ kind: 'ok' })
  })

  it('마이크로초 → 밀리초는 정수 나눗셈 내림', () => {
    expect(usecToMs('1767225600999999')).toBe(1767225600999)
    expect(usecToMs('12.5')).toBeNull()
    expect(usecToMs(null)).toBeNull()
  })
})

describe('AC2·AC3 방송·채팅 페이지 읽기', () => {
  const page = (player: unknown, data: unknown = { contents: {} }) => `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`
  const details = { videoId: 'abcdefghijk', channelId: 'UCchannel', author: '채널 이름', title: '방송 제목', isLiveContent: true }
  const withChat = { contents: { twoColumnWatchNextResults: { conversationBar: { liveChatRenderer: { continuations: [] } } } } }

  it('진행 중·예정·끝남·라이브 아님·없음·채팅 꺼짐', () => {
    const live = parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: { ...details, isLive: true }, microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: true, startTimestamp: '2026-10-31T01:00:00+00:00' } } } }, withChat))
    expect(live).toEqual({ state: 'LIVE', videoId: 'abcdefghijk', channelId: 'UCchannel', channelTitle: '채널 이름', title: '방송 제목', startedAt: Date.parse('2026-10-31T01:00:00Z') })
    expect(parseWatchPage(page({ playabilityStatus: { status: 'LIVE_STREAM_OFFLINE' }, videoDetails: { ...details, isUpcoming: true } }, withChat)).state).toBe('UPCOMING')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: details, microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false, endTimestamp: '2026-10-31T02:00:00Z' } } } })).state).toBe('ENDED')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'This live stream recording is not available.' }, videoDetails: details })).state).toBe('ENDED')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: { ...details, isLiveContent: false } })).state).toBe('NOT_LIVE')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'ERROR', reason: 'This video is unavailable' } })).state).toBe('NOT_FOUND')
    const off = { contents: { twoColumnWatchNextResults: { conversationBar: { conversationBarRenderer: {} } } } }
    expect(parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: { ...details, isLive: true } }, off)).state).toBe('CHAT_DISABLED')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: { ...details, isLive: true }, microformat: {} }, { contents: { twoColumnWatchNextResults: { conversationBar: { liveChatRenderer: { isReplay: true } } } } })).state).toBe('ENDED')
  })

  it('로그인 없이 볼 수 없음(비공개·멤버 전용·연령 제한) → NOT_PUBLIC, 봇 확인·그 밖의 로그인 요구 화면 → 막힘, 모르는 상태 → 모르는 모양', () => {
    expect(parseWatchPage(page({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'This video is private' } })).state).toBe('NOT_PUBLIC')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' } })).state).toBe('NOT_PUBLIC')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Join this channel to get access to members-only content like this video.' } })).state).toBe('NOT_PUBLIC')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'AGE_CHECK_REQUIRED' } })).state).toBe('NOT_PUBLIC')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } })).state).toBe('BLOCKED')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Please sign in' } })).state).toBe('BLOCKED')
    expect(parseWatchPage('<html>Sign in to confirm you’re not a bot</html>').state).toBe('BLOCKED')
    expect(parseWatchPage('<html>new layout</html>').state).toBe('UNKNOWN_SHAPE')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'SOMETHING_NEW' }, videoDetails: details })).state).toBe('UNKNOWN_SHAPE')
    // 바깥 글(방송 제목) 안의 괄호·표시 글자에 흔들리지 않는다 — 스크립트 맨 앞의 표시만 본다
    expect(parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: { ...details, title: '}{ "var ytInitialData = " }', isLive: true } }, withChat)).state).toBe('LIVE')
    expect(parseWatchPage(page({ playabilityStatus: { status: 'OK' }, videoDetails: { ...details, title: 'var ytInitialData = {}', isLive: true } }, withChat)).state).toBe('LIVE')
  })

  it('채팅 페이지: 전체 채팅 지점 없음(인기 채팅만) → 모르는 모양, 채팅 칸 없음 → NO_CHAT, 봇 확인 → 막힘', () => {
    const chatPage = (renderer: unknown) => `<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.1","VISITOR_DATA":"v"});</script><script>window["ytInitialData"] = ${JSON.stringify({ contents: renderer })};</script>`
    const item = (title: string, continuation: string) => ({ title, continuation: { reloadContinuationData: { continuation } } })
    const header = (items: unknown[]) => ({ liveChatRenderer: { header: { liveChatHeaderRenderer: { viewSelector: { sortFilterSubMenuRenderer: { subMenuItems: items } } } }, continuations: [{ invalidationContinuationData: { continuation: 'TOP-INV' } }] } })
    expect(parseChatPage(chatPage(header([item('Top chat', 'TOP'), item('Live chat', 'ALL')])))).toMatchObject({ state: 'OK', continuation: 'ALL', session: { apiKey: null, clientName: 'WEB', clientVersion: '2.1', visitorData: 'v' } })
    expect(parseChatPage(chatPage(header([item('Top chat', 'TOP')])))).toMatchObject({ state: 'UNKNOWN_SHAPE', continuation: null })
    expect(parseChatPage(chatPage({ messageRenderer: {} }))).toMatchObject({ state: 'NO_CHAT' })
    expect(parseChatPage('<html>Sign in to confirm you’re not a bot</html>')).toMatchObject({ state: 'BLOCKED' })
    expect(parseChatPage('<html></html>')).toMatchObject({ state: 'UNKNOWN_SHAPE' })
  })
})

describe('AC3 간격·백오프, AC6 끄기 스위치', () => {
  it('다음 부름 = timeoutMs를 1~10초로 자름, 없으면 5초', () => {
    expect(nextWaitMs(10_000)).toBe(10_000)
    expect(nextWaitMs(30_000)).toBe(10_000)
    expect(nextWaitMs(200)).toBe(1000)
    expect(nextWaitMs(0)).toBe(1000)
    expect(nextWaitMs(3000)).toBe(3000)
    expect(nextWaitMs(null)).toBe(5000)
  })

  it('실패 뒤: 연결 오류·모르는 모양 5·10·20·30초 그 뒤 30초씩, 막힘 30·60·120·300초 그 뒤 300초씩', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffMs('OTHER', n))).toEqual([5000, 10_000, 20_000, 30_000, 30_000, 30_000])
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffMs('BLOCKED', n))).toEqual([30_000, 60_000, 120_000, 300_000, 300_000, 300_000])
    expect(WEB_FAILURE_BACKOFF_MS).toEqual([5000, 10_000, 20_000, 30_000])
    expect(WEB_BLOCKED_BACKOFF_MS).toEqual([30_000, 60_000, 120_000, 300_000])
  })

  it('LIVEJJIM_YT_WEB_CHAT: 다듬고 소문자로 off일 때만 끔 — 없음·빈 값·on은 켬, 그 밖은 켬 + 경고(값 없음)', () => {
    expect(readYoutubeWebChat({})).toEqual({ on: true, warning: null })
    expect(readYoutubeWebChat({ LIVEJJIM_YT_WEB_CHAT: '' })).toEqual({ on: true, warning: null })
    expect(readYoutubeWebChat({ LIVEJJIM_YT_WEB_CHAT: ' On ' })).toEqual({ on: true, warning: null })
    expect(readYoutubeWebChat({ LIVEJJIM_YT_WEB_CHAT: ' OFF ' })).toEqual({ on: false, warning: null })
    expect(readYoutubeWebChat({ LIVEJJIM_YT_WEB_CHAT: 'false' })).toEqual({ on: true, warning: 'YT_WEB_CHAT_INVALID' })
    expect(readYoutubeWebChat({ LIVEJJIM_YT_WEB_CHAT: '0' })).toEqual({ on: true, warning: 'YT_WEB_CHAT_INVALID' })
  })
})
