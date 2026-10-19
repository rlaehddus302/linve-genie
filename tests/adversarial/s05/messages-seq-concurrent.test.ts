// S05 회귀 테스트 (test-domain, 라운드 2): TD-S05-005 수정 뒤, 가짜 없이 채팅이 쉼 없이 들어오는 동안
// 메시지 조회(GET /messages)·증분 조회(GET /changes)를 여러 번 겹쳐 보내도
//   - 메시지 조회(more: false): 응답 seq까지의 그 방송 메시지가 모두 응답에 있다
//   - 증분 조회: since < seq ≤ 응답 seq인 새 채팅이 모두 응답에 있다
// (AC-S05-20·21·62, dev-notes "메시지 조회 seq까지 빈틈 없음" 계약)
import { afterEach, describe, expect, it } from 'vitest'
import { harness, startBroadcast, type Harness } from '../s04/helpers.ts'

const DAY = '2026-10-18'

interface Message {
  id: string
  seq: number
  broadcast: string
}
interface MessagesBody {
  seq: number
  more: boolean
  messages: Message[]
}
interface ChangesBody {
  seq: number
  since: number
  messages: Message[]
  messagesMore: boolean
}

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

describe('TD-S05-005 회귀: 채팅이 흐르는 동안 겹친 메시지·증분 조회에 빈틈이 없다', () => {
  it('동시 채팅 60건과 겹친 조회 — 응답 seq까지의 메시지가 모두 담긴다', async () => {
    h = await harness()
    const a = await h.account('mseqc')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, DAY)
    const get = async <T>(path: string): Promise<T> => (await (await s.app.request(path, { headers: { Cookie: a.cookie } })).json()) as T

    const chats = (async () => {
      for (let i = 0; i < 60; i++) {
        await s.ingestChat(a.sellerId, { b, id: `c${String(i)}`, ch: `UC${String(i % 7)}`, nick: `손님${String(i % 7)}`, text: i % 3 === 0 ? '15번 주세요' : '안녕하세요' })
      }
    })()
    const messageViews: Promise<MessagesBody>[] = []
    const changeViews: Promise<ChangesBody>[] = []
    for (let k = 0; k < 20; k++) {
      messageViews.push(get<MessagesBody>(`/api/days/${DAY}/messages?b=${b}&limit=500`))
      changeViews.push(get<ChangesBody>(`/api/days/${DAY}/changes?since=${String(1 + k)}`))
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await chats
    const all = await get<MessagesBody>(`/api/days/${DAY}/messages?b=${b}&limit=500`)
    expect(all.messages).toHaveLength(60)

    let checked = 0
    for (const view of await Promise.all(messageViews)) {
      if (view.seq === undefined) continue
      checked++
      expect(view.more).toBe(false)
      const expected = all.messages.filter((m) => m.seq <= view.seq).map((m) => m.id)
      expect(view.messages.map((m) => m.id), `seq ${String(view.seq)}`).toEqual(expected)
    }
    for (const view of await Promise.all(changeViews)) {
      if (view.seq === undefined || view.messagesMore) continue
      checked++
      const expected = all.messages.filter((m) => m.seq > view.since && m.seq <= view.seq).map((m) => m.id)
      const got = view.messages.filter((m) => m.seq > view.since).map((m) => m.id)
      expect(got, `since ${String(view.since)} seq ${String(view.seq)}`).toEqual(expected)
    }
    expect(checked).toBeGreaterThanOrEqual(30)
  }, 60_000)
})
