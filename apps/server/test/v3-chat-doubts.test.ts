// D-V3-129 채팅 의심 표시: 등록 뒤 창 안의 손님 채팅이 그 번호를 한 번도 안 가리키고 그 방송에 없는 다른 번호를 셋 넘게 가리킬 때만.
import { describe, expect, it } from 'vitest'
import { DOUBT_WINDOW_MS, doubtWords, findChatDoubts } from '../src/voice/doubts.ts'

const T = 1_000_000
const msg = (at: number, numbers: number[], owner = false) => ({ at, owner, numbers })

describe('D-V3-129 채팅 의심 표시', () => {
  it('82번을 등록했는데 창 안 채팅이 81만 셋 넘게 가리키고 81번 상품이 없으면 "채팅은 81번을 찾아요"', () => {
    const doubts = findChatDoubts({
      registrations: [{ no: 82, at: T }],
      messages: [msg(T + 20_000, [81]), msg(T + 25_000, [81]), msg(T + 30_000, [81]), msg(T + 40_000, [81])],
      existing: new Set([82]),
      now: T + DOUBT_WINDOW_MS,
    })
    expect(doubts).toEqual([{ no: 82, suspected: 81, count: 4 }])
    expect(doubtWords(doubts[0]!)).toBe('채팅은 81번을 찾아요 (4명). 번호를 확인해 주세요.')
  })
  it('변수들: 81·82 연달아(82 채팅 있음)·섞인 채팅·채팅 없음·둘 미만·판매자 글·창 밖·이미 있는 번호·창이 아직 안 지남 — 모두 표시 없음', () => {
    const base = { existing: new Set([82]), now: T + DOUBT_WINDOW_MS }
    // 82를 한 번이라도 가리키면 없음 (연달아 소개·섞임)
    expect(findChatDoubts({ ...base, registrations: [{ no: 82, at: T }], messages: [msg(T + 10_000, [81]), msg(T + 12_000, [81]), msg(T + 14_000, [81]), msg(T + 20_000, [82])] })).toEqual([])
    // 채팅이 없음
    expect(findChatDoubts({ ...base, registrations: [{ no: 82, at: T }], messages: [] })).toEqual([])
    // 셋 미만
    expect(findChatDoubts({ ...base, registrations: [{ no: 82, at: T }], messages: [msg(T + 10_000, [81]), msg(T + 12_000, [81])] })).toEqual([])
    // 판매자 글은 세지 않음
    expect(findChatDoubts({ ...base, registrations: [{ no: 82, at: T }], messages: [msg(T + 10_000, [81], true), msg(T + 12_000, [81], true), msg(T + 14_000, [81], true)] })).toEqual([])
    // 창 밖(등록 전·60초 뒤)은 세지 않음
    expect(findChatDoubts({ ...base, registrations: [{ no: 82, at: T }], messages: [msg(T - 1_000, [81]), msg(T - 2_000, [81]), msg(T - 3_000, [81]), msg(T + 61_000, [81])] })).toEqual([])
    // 81번이 이미 있는 상품이면 늦은 찜일 수 있어 없음
    expect(findChatDoubts({ ...base, existing: new Set([81, 82]), registrations: [{ no: 82, at: T }], messages: [msg(T + 10_000, [81]), msg(T + 12_000, [81]), msg(T + 14_000, [81])] })).toEqual([])
    // 창이 아직 안 지났으면 판단하지 않음
    expect(findChatDoubts({ ...base, now: T + 30_000, registrations: [{ no: 82, at: T }], messages: [msg(T + 10_000, [81]), msg(T + 12_000, [81]), msg(T + 14_000, [81])] })).toEqual([])
    // 한 사람이 같은 글에 81을 두 번 써도 한 번
    expect(findChatDoubts({ ...base, registrations: [{ no: 82, at: T }], messages: [msg(T + 10_000, [81, 81]), msg(T + 12_000, [81]), msg(T + 14_000, [81])] })).toEqual([{ no: 82, suspected: 81, count: 3 }])
  })
})
