// RA-V3-010: 시청 페이지 안 채팅 iframe의 영상 ID — continuation이 다른 영상 것이면 쓰지 않는다
import { describe, expect, it } from 'vitest'
import { continuationMatches, frameVideoOf } from '../src/reader.ts'
import { continuationFor } from './continuation.ts'

const LIVE = 'kkNQY46VpXU'
const OTHER = 'JbBfRCRKtE8'
const chatOf = (video: string) => `https://www.youtube.com/live_chat?continuation=${continuationFor(video)}`
const watch = (video: string) => `https://www.youtube.com/watch?v=${video}`

describe('continuationMatches', () => {
  it('continuation 안의 영상 ID와 같으면 true, 다른 영상 것이면 false', () => {
    expect(continuationMatches(chatOf(LIVE), LIVE)).toBe(true)
    expect(continuationMatches(chatOf(OTHER), LIVE)).toBe(false)
  })

  it('continuation이 없거나 풀 수 없으면 null', () => {
    expect(continuationMatches('https://www.youtube.com/live_chat', LIVE)).toBeNull()
    expect(continuationMatches('https://www.youtube.com/live_chat?continuation=%%%', LIVE)).toBeNull()
  })
})

describe('frameVideoOf', () => {
  it('채팅 주소의 v=가 먼저', () => {
    expect(frameVideoOf(`https://www.youtube.com/live_chat?v=${LIVE}`, [watch(OTHER)])).toBe(LIVE)
  })

  it('v=가 없으면 바깥 주소에서 — continuation이 맞을 때', () => {
    expect(frameVideoOf(chatOf(LIVE), [watch(LIVE)])).toBe(LIVE)
    expect(frameVideoOf(chatOf(LIVE), [null, watch(LIVE)])).toBe(LIVE)
  })

  it('SPA로 다른 영상으로 옮긴 뒤의 옛 채팅 프레임(continuation이 다른 영상)은 바깥 주소 영상을 받지 않는다', () => {
    expect(frameVideoOf(chatOf(OTHER), [watch(LIVE)])).toBeNull()
  })
})
