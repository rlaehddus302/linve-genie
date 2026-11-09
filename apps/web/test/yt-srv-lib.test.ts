// 서버가 읽는 유튜브 채팅 — 화면 낱말·판단 (YT-11 AC2·AC5·AC6·AC8, D-YT-SRV-03·06·07·09·11)
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CollectorView, ExtensionView, LiveBroadcastItem } from '../src/api/types.ts'
import { EXTENSION_ROUTE, SERVER_ROUTE, routeWords } from '../src/lib/extension.ts'
import {
  RECENT_EMPTY,
  WEB_CHAT_INTRO,
  WEB_CHAT_OFF_MESSAGE,
  WEB_CHAT_RESUMED,
  WEB_TROUBLE_FALLBACK,
  broadcastChannelLine,
  collectorWarning,
  firstChannelQuestion,
  linkedChannelName,
  readModeOf,
  recentLine,
  resumeStep,
  webChatTrouble,
  type ResumeStep,
} from '../src/lib/youtube.ts'

const collector = (patch: Partial<CollectorView> = {}): CollectorView => ({
  status: 'LIVE',
  statusMessage: '채팅을 받는 중',
  reason: null,
  reasonMessage: null,
  mode: 'WEB',
  lastMessageAt: null,
  recorded: 0,
  skippedBeforeLink: 0,
  gap: false,
  gapMessage: null,
  restartable: false,
  ...patch,
})

describe('스펙 문장 그대로 (D-YT-SRV-03·06·07·11)', () => {
  it('첫 줄·운영자 끔·다시 받음·막힘·형식 바뀜', () => {
    expect(WEB_CHAT_INTRO).toBe('라이브할 때 라이브 주소만 넣으면 채팅을 받아요.') // 문구 바뀜 (D-UX4-86)
    expect(WEB_CHAT_OFF_MESSAGE).toBe('지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.')
    expect(WEB_CHAT_RESUMED).toBe('유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.')
    expect(WEB_TROUBLE_FALLBACK).toEqual({
      BLOCKED: '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.',
      FORMAT: '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.',
      OPERATOR_OFF: WEB_CHAT_OFF_MESSAGE,
    })
    expect(firstChannelQuestion('다육이네')).toBe('처음 잇는 채널이에요 (채널: 다육이네). 이 라이브가 맞나요?') // 문구 바뀜 (D-UX4-86)
    expect(broadcastChannelLine('다육이네')).toBe('유튜브 라이브 · 다육이네') // 문구 바뀜 (D-UX4-86)
    expect(RECENT_EMPTY).toBe('최근 이은 채널에 지금 하는 라이브가 없어요. 라이브 주소를 붙여 넣어 주세요.') // 문구 바뀜 (D-UX4-86)
  })

  it('화면 낱말에 영어 상태값·개발 용어가 없다', () => {
    const words = [WEB_CHAT_INTRO, WEB_CHAT_OFF_MESSAGE, WEB_CHAT_RESUMED, ...Object.values(WEB_TROUBLE_FALLBACK), RECENT_EMPTY, firstChannelQuestion('가'), SERVER_ROUTE.SERVER, SERVER_ROUTE.BOTH]
    for (const word of words) expect(word, word).not.toMatch(/[A-Za-z]/)
  })
})

describe('바로 경고 (AC5·AC6)', () => {
  it('막힘·형식 바뀜(다시 연결하는 중)·운영자 끔(멈춤)은 10초를 기다리지 않고 서버 문장 그대로 + 대비 경로', () => {
    const blocked = collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'BLOCKED', reasonMessage: WEB_TROUBLE_FALLBACK.BLOCKED })
    expect(webChatTrouble(blocked)).toBe(true)
    expect(collectorWarning(blocked, false)).toEqual({ message: WEB_TROUBLE_FALLBACK.BLOCKED, reconnect: false, restartable: false, fallback: true })
    const format = collector({ status: 'RETRYING', reason: 'FORMAT', reasonMessage: null })
    expect(collectorWarning(format, false)?.message).toBe(WEB_TROUBLE_FALLBACK.FORMAT)
    const off = collector({ status: 'STOPPED', reason: 'OPERATOR_OFF', reasonMessage: WEB_CHAT_OFF_MESSAGE, restartable: false })
    expect(collectorWarning(off, false)).toEqual({ message: WEB_CHAT_OFF_MESSAGE, reconnect: false, restartable: false, fallback: true })
  })

  it('서버 읽기의 연결 오류는 10초 넘게 이어질 때만, 멈춤은 지금처럼 — 둘 다 대비 경로, "다시 연결하기"는 없다', () => {
    const retrying = collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중' })
    expect(webChatTrouble(retrying)).toBe(false)
    expect(collectorWarning(retrying, false)).toBeNull()
    expect(collectorWarning(retrying, true)).toEqual({ message: '유튜브 채팅을 받지 못하고 있어요 — 다시 연결하는 중', reconnect: false, restartable: false, fallback: true })
    const lost = collector({ status: 'STOPPED', reason: 'CHAT_NOT_FOUND', reasonMessage: '채팅을 찾을 수 없어요.', restartable: true })
    expect(collectorWarning(lost, false)).toEqual({ message: '유튜브 채팅을 받지 못하고 있어요 — 채팅을 찾을 수 없어요.', reconnect: false, restartable: true, fallback: true })
  })

  it('옛 공식 읽기의 경고에는 대비 경로 표시가 없다', () => {
    const official = collector({ mode: 'STREAM', status: 'STOPPED', reason: 'RECONNECT', reasonMessage: '유튜브 연결을 다시 해 주세요.', restartable: true })
    expect(collectorWarning(official, false)).toEqual({ message: '유튜브 채팅을 받지 못하고 있어요 — 유튜브 연결을 다시 해 주세요.', reconnect: true, restartable: false })
    expect(collectorWarning(official, false)?.fallback).toBeUndefined()
  })

  it('받는 중·시작하는 중·끊음·채팅 끝남은 바로 경고가 아니다', () => {
    for (const view of [collector(), collector({ status: 'STARTING', reason: 'NOT_STARTED' }), collector({ status: 'STOPPED', reason: 'UNLINKED' }), collector({ status: 'CHAT_ENDED' }), null]) {
      expect(webChatTrouble(view)).toBe(false)
    }
    // 이유가 막힘이어도 멈춤이 아닌 받는 중이면 경고 아님
    expect(webChatTrouble(collector({ status: 'LIVE', reason: 'BLOCKED' }))).toBe(false)
  })
})

describe('다시 받기 시작함 (AC5 — 상태 전환으로만)', () => {
  const start: ResumeStep = { trouble: false, resumed: false }
  const run = (views: (CollectorView | null)[]) => views.reduce((step, view) => resumeStep(step, view), start)

  it('막힘·형식 바뀜·운영자 끔을 본 뒤 받는 중이 되면', () => {
    expect(run([collector({ status: 'RETRYING', reason: 'BLOCKED' }), collector()]).resumed).toBe(true)
    expect(run([collector({ status: 'RETRYING', reason: 'FORMAT' }), collector({ status: 'RETRYING' }), collector({ status: 'STARTING' }), collector()]).resumed).toBe(true)
    expect(run([collector({ status: 'STOPPED', reason: 'OPERATOR_OFF' }), collector({ status: 'STARTING' }), collector()]).resumed).toBe(true)
    // 받는 중이 이어져도 한 줄은 남는다
    expect(run([collector({ status: 'RETRYING', reason: 'BLOCKED' }), collector(), collector({ recorded: 5 })]).resumed).toBe(true)
  })

  it('처음부터 받는 중·연결 오류만·끊음·다시 막힘이면 없다', () => {
    expect(run([collector()]).resumed).toBe(false)
    expect(run([collector({ status: 'RETRYING' }), collector()]).resumed).toBe(false)
    expect(run([collector({ status: 'RETRYING', reason: 'BLOCKED' }), null, collector()]).resumed).toBe(false)
    expect(run([collector({ status: 'RETRYING', reason: 'BLOCKED' }), collector({ status: 'STOPPED', reason: 'UNLINKED' })]).resumed).toBe(false)
    expect(run([collector({ status: 'RETRYING', reason: 'BLOCKED' }), collector(), collector({ status: 'RETRYING', reason: 'FORMAT' })]).resumed).toBe(false)
  })
})

describe('채널 이름·최근 채널 줄 (D-YT-SRV-03, D-INV1-03)', () => {
  const item = (patch: Partial<LiveBroadcastItem> = {}): LiveBroadcastItem => ({ videoId: 'V', title: '경매', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC', channelTitle: '다육이네', ...patch })

  it('"{채널 이름} · {방송 제목}" — 이름이 비면 "(이름 없음)", 제목이 비면 "(제목 없음)", 긴 이름은 줄임표', () => {
    expect(recentLine(item())).toBe('다육이네 · 경매')
    expect(recentLine(item({ channelTitle: null, title: '  ' }))).toBe('(이름 없음) · (제목 없음)')
    expect(recentLine(item({ channelTitle: '가'.repeat(41) }))).toBe(`${'가'.repeat(40)}… · 경매`)
    expect(recentLine(item({ channelTitle: '<b>굵게</b>' }))).toBe('<b>굵게</b> · 경매')
  })

  it('이은 방송 채널 이름: 이은 것이 없으면 null, 이름이 없으면 "(이름 없음)"', () => {
    expect(linkedChannelName(null)).toBeNull()
    expect(linkedChannelName({ videoId: 'V', channelId: 'UC', linkedAt: '', chatEnded: false, broadcastChannelTitle: '다육이네' })).toBe('다육이네')
    expect(linkedChannelName({ videoId: 'V', channelId: 'UC', linkedAt: '', chatEnded: false })).toBe('(이름 없음)')
  })
})

describe('연결 응답 읽기 (webChat·oauth)', () => {
  it('webChat은 { on: boolean }일 때만, oauth는 false일 때만 끔 (옛 서버는 둘 다 없다)', () => {
    expect(readModeOf({ webChat: { on: true }, oauth: true })).toEqual({ webChat: { on: true }, oauth: true })
    expect(readModeOf({ webChat: { on: false }, oauth: false })).toEqual({ webChat: { on: false }, oauth: false })
    expect(readModeOf({})).toEqual({ webChat: null, oauth: true })
    expect(readModeOf({ webChat: null })).toEqual({ webChat: null, oauth: true })
    expect(readModeOf({ webChat: { on: 'yes' } as unknown, oauth: 'no' as unknown })).toEqual({ webChat: null, oauth: true })
  })
})

describe('받는 길 문장 (YT-10 서버 수집과 함께, D-YT-SRV-11)', () => {
  const ext: ExtensionView = { connected: true, connectedAt: null, lastUsedAt: null, state: 'RECEIVING', message: null, manual: null, broadcasts: ['b1'], statusAt: null, lastChatAt: null, dropped: 0 }

  it('서버가 읽으면 "서버 연결로 받는 중" / "서버 연결·확장 둘 다로 받는 중", 옛 공식 읽기는 그대로', () => {
    expect(routeWords(collector(), null, 'b1')).toBe('서버 연결로 받는 중')
    expect(routeWords(collector(), ext, 'b1')).toBe('서버 연결·확장 둘 다로 받는 중')
    expect(routeWords(collector({ status: 'RETRYING', reason: 'BLOCKED' }), ext, 'b1')).toBe(EXTENSION_ROUTE.EXTENSION)
    expect(routeWords(collector({ mode: 'STREAM' }), null, 'b1')).toBe(EXTENSION_ROUTE.OFFICIAL)
    expect(routeWords(collector({ mode: 'STREAM' }), ext, 'b1')).toBe(EXTENSION_ROUTE.BOTH)
  })
})
