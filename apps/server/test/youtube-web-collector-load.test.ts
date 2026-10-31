// YT-11 서버 웹 읽기 — 옛 공식 읽기의 AC-Y1-23(이어받기 — 누락·중복 없음)·AC-Y1-29(많은 채팅, NFR-04)를 같은 강도로 (CH-26).
// 가짜 유튜브 웹 서버(127.0.0.1)에 실제 통신 방식으로 붙고, 응답 묶음 중간에서 연결을 끊고(5번), 기록 직후·지점 저장 직전에 서버를 죽였다 살린다.
import { applyEvent, initEngine, type EngineEvent, type EngineState } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { MERGED_BODY, RAW_JOIN, expectOk, writeEvent } from './support.ts'
import { collectorOfWorld, pass, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const worlds: WebWorld[] = []
async function world(options: Parameters<typeof webWorld>[0] = {}): Promise<WebWorld> {
  const created = await webWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of new Set(closing.map((w) => w.web))) await item.close()
})

async function chatIds(w: WebWorld): Promise<string[]> {
  const rows = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat' order by seq`)
  return (rows?.rows ?? []).map((row) => row.id)
}

async function replayDb(w: WebWorld, date: string): Promise<EngineState> {
  const rows = await w.database.pglite?.query<{ body: string; failed: boolean }>(
    `select ${MERGED_BODY} as body, e.failed from events e ${RAW_JOIN} join scopes s on s.id = e.scope_id where s.date = $1 and s.rehearsal = false order by e.seq`,
    [date],
  )
  let state = initEngine({ broadcasts: [], settings: {} })
  for (const row of rows?.rows ?? []) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return state
}

describe('AC-Y1-23 이어받기 — 누락·중복 없음 (웹 읽기)', () => {
  it('메시지 2,000건을 흘리는 동안 응답 묶음 중간에서 연결을 5번 끊고, 묶음 기록 직후·지점 저장 직전에 수집기(서버)를 죽였다 살린다', async () => {
    let killed = false
    const holder: { kill?: () => void; ready?: () => boolean; token?: string } = {}
    const w = await world({
      overrides: {
        collectorHooks: {
          beforeSaveToken: () => {
            // 메시지가 900건 넘게 흐른 뒤 처음 맞는 묶음: 기록은 커밋됐고 지점은 아직 — 여기서 서버가 죽는다
            if (!killed && holder.ready?.() === true) {
              killed = true
              // 죽을 때 막 읽은 묶음의 지점 (저장되지 않았다)
              holder.token = w.web.continuations.at(-1)
              holder.kill?.()
              throw new Error('죽음')
            }
          },
        },
      },
    })
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    const managerA = w.server.youtube?.collectors
    if (managerA === undefined) throw new Error('유튜브가 없다')
    holder.kill = () => void managerA.kill()
    holder.ready = () => w.web.video(video.videoId).actions.length >= 900
    managerA.start()
    // 수집기가 붙은 뒤에 흘린다 (첫 지점은 실제처럼 최근 동작만 준다 — RA-I3-001)
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).status === 'LIVE')
    const sent: string[] = []
    let cuts = 0
    let revived: WebWorld | null = null
    for (let batch = 0; batch < 20 || cuts < 5 || (killed && revived === null); batch++) {
      // 죽은 서버를 다시 살린다 (새 서버 B — A의 임대가 지난 뒤 이어받는다)
      if (killed && revived === null) {
        revived = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'B' })
        revived.server.youtube?.collectors.start()
      }
      if (batch >= 60) break
      for (let i = 0; i < 100; i++) {
        if (batch >= 20) break
        const id = `msg${String(batch * 100 + i).padStart(5, '0')}`
        sent.push(id)
        w.web.addMessage(video.videoId, { id, author: `UCv${String(i % 37)}`, name: `시청자${String(i % 37)}`, text: i % 9 === 0 ? `${String((i % 5) + 1)}` : '안녕하세요', publishedAt: w.timer.now() })
      }
      // 다음 응답 묶음을 중간에서 끊는다 (5번 — 그 묶음은 받지 못한 채 같은 지점으로 다시)
      if (batch % 3 === 1 && cuts < 5 && w.web.pendingFaults('poll') === 0) {
        w.web.fail('poll', { kind: 'cut' })
        cuts += 1
      }
      await pass(w, 4000, 1000)
    }
    expect(cuts).toBe(5)
    expect(killed).toBe(true)
    await waitFor(w, async () => (await chatIds(w)).length >= sent.length, { step: 1000, max: 2000 })
    await pass(w, 10_000, 1000)
    expect(w.web.pendingFaults('poll')).toBe(0)
    const ids = await chatIds(w)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(sent)
    const checks = await checkReplay(w.database.db)
    expect(checks.every((check) => check.ok)).toBe(true)
    // 처음 + 죽은 뒤 다시: 채팅 페이지(호출 정보)를 적어도 두 번 받았다. 같은 영상에 동시에 열린 채팅 요청은 늘 하나
    expect(w.web.calls('chatPage')).toBeGreaterThanOrEqual(2)
    // 기록했지만 지점을 저장하지 못한 묶음은 새 서버가 같은 지점으로 다시 읽었다 (기록은 메시지 ID로 한 번)
    expect(holder.token).toEqual(expect.any(String))
    expect(w.web.continuations.filter((token) => token === holder.token).length).toBeGreaterThanOrEqual(2)
    expect(w.web.maxInflightPolls).toBe(1)
    expect(await collectorOfWorld(w, seller.cookie, b.id)).toMatchObject({ recorded: 2000, gap: false })
  }, 120_000)
})

describe('AC-Y1-29 많은 채팅 (NFR-04, 웹 읽기)', () => {
  it('한 방송 채팅 1만 건(초당 50건 몰림 포함): 빠짐·중복 없이 모두 기록, 재생 상태 = 서버 범위 상태', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    for (let no = 1; no <= 20; no++) await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no, name: `상품${String(no)}`, price: 1000 * no }))
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    // 수집기가 붙은 뒤에 몰린다 (첫 지점은 실제처럼 최근 동작만 준다 — RA-I3-001)
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).status === 'LIVE')
    const sent: string[] = []
    for (let second = 0; second < 200; second++) {
      for (let i = 0; i < 50; i++) {
        const n = second * 50 + i
        const id = `big${String(n).padStart(6, '0')}`
        sent.push(id)
        w.web.addMessage(video.videoId, { id, author: `UCbig${String(n % 400)}`, name: `시청자${String(n % 400)}`, text: n % 7 === 0 ? String((n % 20) + 1) : '안녕하세요', publishedAt: w.timer.now() + 1 })
      }
      if (second % 20 === 0) await pass(w, 1000, 500)
    }
    await waitFor(w, async () => (await chatIds(w)).length === sent.length, { step: 500, max: 4000 })
    const ids = await chatIds(w)
    expect(ids).toEqual(sent)
    const server = (await w.server.writer.read(seller.sellerId, b.date)).state
    expect(server).toEqual(await replayDb(w, b.date))
  }, 180_000)
})
