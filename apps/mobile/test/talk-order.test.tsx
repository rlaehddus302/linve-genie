// 채팅·문자 차례는 서버가 정한다 (D-RETRO-140, 사용자 메모 11-13 "라이브 채팅 순서가 기기마다 다름"):
// 채팅은 서버 순번(seq) 차례 — 뒤섞여 도착해도, 한 묶음이라 시각이 같아도, 늦게 받아도 모든 기기가 같은 차례로 본다. 문자는 받은 시각으로 사이에 끼운다.
import { describe, expect, it } from 'vitest'
import type { SmsFeedView } from '@livejjim/web/src/api/inbox-types.ts'
import type { MessagesView } from '@livejjim/web/src/api/types.ts'
import { talkRows } from '../src/screens/console/LiveTalk.tsx'
import type { ScopeData } from '../src/lib/scope-data.ts'

const NO_DATA = { claims: new Map(), products: new Map() } as unknown as ScopeData
type Message = MessagesView['messages'][number]
const SAME_MS = '2026-11-13T05:13:00.123Z'
const message = (seq: number, id: string, at = SAME_MS): Message =>
  ({ id, broadcast: 'b1', channel: `ch${String(seq)}`, nick: `손님${String(seq)}`, text: `${String(seq)}번째`, owner: false, seq, at, publishedAt: at, ignored: false, order: false, cancel: false, orders: [], cancels: [], mentions: [], converted: [], claims: [], failed: false }) as Message
const view = (messages: readonly Message[]): MessagesView => ({ date: '2026-11-13', rehearsal: false, seq: 99, messages, more: false })
const sms = (id: string, at: string): SmsFeedView => ({ id, at, last4: '1234', sender: null, text: '문자', result: 'none', numbers: [] })

// 한 번에 받은 채팅 묶음: 시각이 모두 같은 밀리초이고, ID는 대소문자·'-'·'_'가 섞여 기기 언어 견주기(localeCompare)로는 차례가 기기마다 갈린다
const BATCH = [
  message(11, 'ChwKGkNPX-abc'),
  message(12, 'chwKGkNP_abc'),
  message(13, 'ChwKGkNP-Abc'),
  message(14, 'Chwkgknp_ABC'),
  message(15, 'ChwKGkNPxabc'),
]
const keys = (rows: readonly { key: string }[]) => rows.map((row) => row.key)
const SEQ_ORDER = ['c:ChwKGkNPxabc', 'c:Chwkgknp_ABC', 'c:ChwKGkNP-Abc', 'c:chwKGkNP_abc', 'c:ChwKGkNPX-abc']

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items]
    return
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) yield [items[i] as T, ...tail]
  }
}

describe('채팅 차례는 서버 순번 (D-RETRO-140)', () => {
  it('같은 밀리초에 온 묶음이 어떤 차례로 도착해도 늘 순번 차례(최신이 위)로 보인다', () => {
    let seen = 0
    for (const order of permutations(BATCH)) {
      expect(keys(talkRows(view(order), [], NO_DATA))).toEqual(SEQ_ORDER)
      seen++
    }
    expect(seen).toBe(120)
  })

  it('늦게 받은 채팅은 맨 아래가 아니라 순번 자리에 끼워진다', () => {
    const first = talkRows(view([message(1, 'a1', '2026-11-13T05:13:00.000Z'), message(2, 'a2', '2026-11-13T05:13:01.000Z'), message(4, 'a4', '2026-11-13T05:13:03.000Z')]), [], NO_DATA)
    expect(keys(first)).toEqual(['c:a4', 'c:a2', 'c:a1'])
    const later = talkRows(view([message(4, 'a4', '2026-11-13T05:13:03.000Z'), message(1, 'a1', '2026-11-13T05:13:00.000Z'), message(3, 'a3', '2026-11-13T05:13:02.000Z'), message(2, 'a2', '2026-11-13T05:13:01.000Z')]), [], NO_DATA)
    expect(keys(later)).toEqual(['c:a4', 'c:a3', 'c:a2', 'c:a1'])
  })

  it('문자는 받은 시각으로 채팅 사이에 끼우고, 같은 시각이면 채팅이 먼저 — 섞여 와도 같은 차례', () => {
    const chats = [message(1, 'x1', '2026-11-13T05:13:00.000Z'), message(2, 'x2', '2026-11-13T05:13:02.000Z'), message(3, 'x3', '2026-11-13T05:13:04.000Z')]
    const texts = [sms('s-b', '2026-11-13T05:13:02.000Z'), sms('s-a', '2026-11-13T05:13:01.000Z'), sms('S-c', '2026-11-13T05:13:02.000Z')]
    const expected = ['c:x3', 's:s-b', 's:S-c', 'c:x2', 's:s-a', 'c:x1']
    expect(keys(talkRows(view(chats), texts, NO_DATA))).toEqual(expected)
    expect(keys(talkRows(view([...chats].reverse()), [...texts].reverse(), NO_DATA))).toEqual(expected)
  })
})
