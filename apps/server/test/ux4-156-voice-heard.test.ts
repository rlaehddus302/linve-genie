// D-UX4-156 음성 인식 기록 (사용자 지시 2026-11-16 "음성인식은 왜 끝난 라이브엔 볼 수 없어? 채팅처럼 다 저장해두는 거 아니야? 보이게 해줘"):
// 받아쓴 최종 글을 판매자·방송마다 voice_heard에 남기고(가린 글), GET /api/broadcasts/:id/heard가 시간순으로 돌려준다 — 판매자 자기 방송만.
// 날짜를 봉인하면 채팅 원문처럼 지운다. 복구는 지우지 않는다(백업 파일에 없다). 마이크·라이브 소리 흐름 저장은 app1-relay·lv1-stream-audio 시험이 본다.
import { afterEach, describe, expect, it } from 'vitest'
import { RESTORE_KEPT_TABLES, RESTORE_REPLACED_TABLES } from '../src/backup.ts'
import { voiceHeard } from '../src/db/schema.ts'
import { HEARD_LINE_MAX } from '../src/voice/heard.ts'
import { addSeller, client, createBroadcast, dumpAllTables, newWorld, type TestServer } from './support.ts'

const worlds: TestServer[] = []
afterEach(async () => {
  for (const world of worlds.splice(0)) { world.server.close(); await world.database.close() }
})
async function world() {
  const made = await newWorld()
  worlds.push(made)
  return made
}
const at = (s: number) => Date.parse('2026-10-29T12:00:00.000Z') + s * 1000
const heard = async (w: TestServer, cookie: string, b: string) => client(w, cookie).get(`/api/broadcasts/${encodeURIComponent(b)}/heard`)

describe('음성 인식 기록 읽기 API (D-UX4-156)', () => {
  it('그 방송의 줄을 시간순(같은 시각이면 받은 차례)으로 — 끝난 라이브도, 다른 방송 줄은 섞이지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    const other = await createBroadcast(w, seller, { title: '다른 라이브' })
    w.server.heard.add(seller.sellerId, b.id, '둘째 말', at(5))
    w.server.heard.add(seller.sellerId, b.id, '첫 말', at(1))
    w.server.heard.add(seller.sellerId, other.id, '다른 라이브 말', at(2))
    w.server.heard.add(seller.sellerId, b.id, '같은 때 뒤', at(5))
    await w.server.heard.settled()
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-heard-1' })).status).toBe(200)
    const response = await heard(w, seller.cookie, b.id)
    expect(response.status, response.text).toBe(200)
    expect(response.body).toEqual({ lines: [{ at: at(1), text: '첫 말' }, { at: at(5), text: '둘째 말' }, { at: at(5), text: '같은 때 뒤' }] })
    expect((await heard(w, seller.cookie, other.id)).body).toEqual({ lines: [{ at: at(2), text: '다른 라이브 말' }] })
  })

  it('다른 판매자의 방송·없는 방송은 404, 로그인 없으면 401 — 글은 로그에 없다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const stranger = await addSeller(w)
    const b = await createBroadcast(w, seller)
    w.server.heard.add(seller.sellerId, b.id, '남이 보면 안 되는 말', at(1))
    await w.server.heard.settled()
    const other = await heard(w, stranger.cookie, b.id)
    expect(other.status).toBe(404)
    expect(other.text).not.toContain('남이 보면 안 되는 말')
    expect((await heard(w, seller.cookie, 'no-such-broadcast')).status).toBe(404)
    expect((await heard(w, '', b.id)).status).toBe(401)
    expect(JSON.stringify(w.logs)).not.toContain('남이 보면 안 되는 말')
  })

  it('저장 전에 제어 문자를 빼고 긴 숫자(전화번호)를 가린다 · 빈 글·없는 방송·남의 방송 줄은 남기지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const stranger = await addSeller(w)
    const b = await createBroadcast(w, seller)
    w.server.heard.add(seller.sellerId, b.id, '연락은\n010-1234-5678로 주세요', at(1))
    w.server.heard.add(seller.sellerId, b.id, '   ', at(2))
    w.server.heard.add(seller.sellerId, 'no-such-broadcast', '없는 방송', at(3))
    w.server.heard.add(stranger.sellerId, b.id, '남의 방송', at(4))
    w.server.heard.add(seller.sellerId, b.id, '가'.repeat(HEARD_LINE_MAX + 50), at(5))
    await w.server.heard.settled()
    const lines = ((await heard(w, seller.cookie, b.id)).body as { lines: { text: string }[] }).lines
    expect(lines.map((line) => line.text)).toEqual(['연락은 ****로 주세요', '가'.repeat(HEARD_LINE_MAX)])
    const dump = await dumpAllTables(w.database)
    expect(dump).not.toContain('010-1234-5678')
    expect(dump).not.toContain('없는 방송')
    expect(dump).not.toContain('남의 방송')
  })

  it('날짜를 봉인하면 그 날짜(실제 라이브)의 줄을 지운다 — 다른 날짜·리허설은 그대로', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const b = await createBroadcast(w, seller)
    const other = await createBroadcast(w, seller, { date: '2026-10-20' })
    const rehearsal = await createBroadcast(w, seller, { rehearsal: true })
    w.server.heard.add(seller.sellerId, b.id, '봉인할 말', at(1))
    w.server.heard.add(seller.sellerId, other.id, '다른 날 말', at(2))
    w.server.heard.add(seller.sellerId, rehearsal.id, '리허설 말', at(3))
    await w.server.heard.settled()
    const scopeId = await w.server.service.scopeId(seller.sellerId, b.date)
    expect(await w.server.sealer.seal(seller.sellerId, scopeId as string, b.date)).toBe(true)
    expect((await heard(w, seller.cookie, b.id)).body).toEqual({ lines: [] })
    expect(((await heard(w, seller.cookie, other.id)).body as { lines: { text: string }[] }).lines.map((line) => line.text)).toEqual(['다른 날 말'])
    expect(((await heard(w, seller.cookie, rehearsal.id)).body as { lines: { text: string }[] }).lines.map((line) => line.text)).toEqual(['리허설 말'])
  })

  it('복구·가져오기는 음성 인식 기록을 지우지 않는다 (백업 파일에 없는 계정 쪽 기록)', () => {
    expect(RESTORE_KEPT_TABLES).toContain(voiceHeard)
    expect(RESTORE_REPLACED_TABLES as readonly unknown[]).not.toContain(voiceHeard)
  })
})
