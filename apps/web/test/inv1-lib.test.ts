// 초대받은 방송 화면 낱말·판단 (INV1 AC-INV1-05·10, D-INV1-01~04)
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import type { ExtensionView } from '../src/api/types.ts'
import { thanksWarnings } from '../src/lib/extension.ts'
import { CHANNEL_NAME_MAX, INVITED_CONFIRM_CODE, NO_CHANNEL_NAME, channelName, invitedChannelName, invitedConfirmOf, invitedLine, invitedQuestion } from '../src/lib/youtube.ts'

const base = { videoId: 'VID00000001', channelId: 'UC_A', linkedAt: '2026-10-30T05:00:00.000Z', chatEnded: false }

describe('채널 이름 (D-INV1-03)', () => {
  it('비거나 글자가 아니면 "(이름 없음)", 앞뒤 빈칸은 뺀다', () => {
    expect(NO_CHANNEL_NAME).toBe('(이름 없음)')
    for (const title of ['', '   ', null, undefined, 3, {}]) expect(channelName(title)).toBe(NO_CHANNEL_NAME)
    expect(channelName('  다육이유튜버 ')).toBe('다육이유튜버')
  })

  it('길면 줄임표로 자른다 — 글자 단위(그림 글자도 쪼개지 않음)', () => {
    const long = '🌵'.repeat(CHANNEL_NAME_MAX + 5)
    const shown = channelName(long)
    expect(Array.from(shown)).toHaveLength(CHANNEL_NAME_MAX + 1)
    expect(shown.endsWith('…')).toBe(true)
    expect(channelName('가'.repeat(CHANNEL_NAME_MAX))).toBe('가'.repeat(CHANNEL_NAME_MAX))
  })

  it('확인 줄·콘솔 한 줄 문장 (AC-INV1-05)', () => {
    expect(invitedQuestion('다육이유튜버')).toBe('내 채널 라이브가 아니에요 (채널: 다육이유튜버). 초대받은 라이브가 맞나요?') // 문구 바뀜 (D-UX4-86)
    expect(invitedLine('다육이유튜버')).toBe('초대받은 라이브 · 다육이유튜버') // 문구 바뀜 (D-UX4-86)
  })
})

describe('확인 필요 응답 (D-INV1-02·04)', () => {
  const error = (code: string, details: Record<string, unknown>) => new ApiError({ status: 409, code, message: 'x', details })

  it('확인 필요 코드면 채널 이름과 영상, 다른 코드(발송함의 NOT_MY_CHANNEL 포함)는 null', () => {
    expect(invitedConfirmOf(error(INVITED_CONFIRM_CODE, { videoId: 'VID00000002', channel: { id: 'UC_B', title: '다육이유튜버' } }))).toEqual({ videoId: 'VID00000002', name: '다육이유튜버' })
    expect(invitedConfirmOf(error(INVITED_CONFIRM_CODE, {}))).toEqual({ videoId: null, name: NO_CHANNEL_NAME })
    expect(invitedConfirmOf(error('NOT_MY_CHANNEL', { channel: { title: '다육이유튜버' } }))).toBeNull()
    expect(invitedConfirmOf(error('VIDEO_IN_USE', {}))).toBeNull()
  })
})

describe('이은 방송이 초대 방송인가 (D-INV1-01)', () => {
  it('방송 채널이 없거나 비거나 글 올리는 계정과 같으면 내 방송', () => {
    expect(invitedChannelName(null)).toBeNull()
    expect(invitedChannelName(base)).toBeNull()
    expect(invitedChannelName({ ...base, broadcastChannelId: null, broadcastChannelTitle: '누구' })).toBeNull()
    expect(invitedChannelName({ ...base, broadcastChannelId: '', broadcastChannelTitle: '누구' })).toBeNull()
    expect(invitedChannelName({ ...base, broadcastChannelId: 'UC_A', broadcastChannelTitle: '내 채널' })).toBeNull()
  })

  it('다르면 그 채널 이름 (비면 "(이름 없음)")', () => {
    expect(invitedChannelName({ ...base, broadcastChannelId: 'UC_B', broadcastChannelTitle: '다육이유튜버' })).toBe('다육이유튜버')
    expect(invitedChannelName({ ...base, broadcastChannelId: 'UC_B', broadcastChannelTitle: null })).toBe(NO_CHANNEL_NAME)
  })

  it('서버가 invited를 알려 주면 그 판단을 따른다', () => {
    expect(invitedChannelName({ ...base, broadcastChannelId: 'UC_B', broadcastChannelTitle: '다육이유튜버', invited: false })).toBeNull()
    expect(invitedChannelName({ ...base, broadcastChannelId: 'UC_B', broadcastChannelTitle: '다육이유튜버', invited: true })).toBe('다육이유튜버')
    expect(invitedChannelName({ ...base, broadcastChannelId: 'UC_B', broadcastChannelTitle: '', invited: true })).toBe(NO_CHANNEL_NAME)
  })
})

describe('확장 감사 경고 (AC-INV1-10 (3))', () => {
  const view: ExtensionView = {
    connected: true,
    connectedAt: null,
    lastUsedAt: null,
    state: 'RECEIVING',
    message: null,
    manual: null,
    broadcasts: ['b1'],
    statusAt: null,
    lastChatAt: null,
    dropped: 0,
    thanks: {
      enabled: true,
      enabledAt: null,
      warnings: [
        { broadcast: 'b1', kind: 'OWNER', message: '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요' },
        { broadcast: 'b1', kind: 'PAUSED', message: '확장으로 감사 글을 올리지 못하고 있어요' },
      ],
    },
  }

  it('초대 방송이면 로그인 경고를 빼고, 내 방송이면 그대로', () => {
    expect(thanksWarnings(view, 'b1').map((w) => w.kind)).toEqual(['OWNER', 'PAUSED'])
    expect(thanksWarnings(view, 'b1', true).map((w) => w.kind)).toEqual(['PAUSED'])
  })
})
