// AIY1 RA-AIY1-01: 출처를 넘기지 않은 채팅 기록은 출처 모름(null)으로 남고, AI로 보내지 않으며 유튜브 채팅처럼 봉인 대상이 된다 (D-AIY1-01).
// 새 수집 경로가 출처를 빠뜨려도 'other'(AI 허용)로 새지 않는지 기록 경로(writer)를 직접 불러 확인한다.
import { describe, expect, it } from 'vitest'
import { fillScope } from '../src/e2e.ts'
import { expectOk, type TestServer } from './support.ts'
import { assistWorld, byText, chat, enableAssist, reviews, sentTexts, shortsBroadcast, suggest } from './a1-support.ts'

const pg = (world: TestServer) => {
  const db = world.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

async function sourceOf(world: TestServer, id: string): Promise<string | null | undefined> {
  const rows = await pg(world).query<{ source: string | null }>('select chat_source as source from events where chat_message_id = $1', [id])
  return rows.rows[0]?.source
}

async function youtubeMarked(world: TestServer, sellerId: string, date: string, rehearsal: boolean): Promise<boolean | undefined> {
  const rows = await pg(world).query<{ y: boolean }>('select youtube_chat as y from scopes where seller_id = $1 and date = $2 and rehearsal = $3', [sellerId, date, rehearsal])
  return rows.rows[0]?.y
}

describe('RA-AIY1-01 출처를 빠뜨린 채팅 기록', () => {
  it('Draft에 source가 없으면 chat_source는 null, AI 요청에 그 글이 없고 excluded YOUTUBE_POLICY, 범위는 유튜브 채팅 봉인 표시', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    expect(await youtubeMarked(world, seller.sellerId, b.date, b.rehearsal)).toBe(false)
    const id = 'nosrc-1'
    const outcome = await world.server.writer.write({
      sellerId: seller.sellerId,
      date: b.date,
      rehearsal: b.rehearsal,
      createScope: false,
      requestId: null,
      chat: { b: b.id, id },
      build: () => [{ fields: { type: 'chat', b: b.id, id, ch: 'UCnosource0000000000001', nick: '시청자', text: '반바지 출처없음' }, actor: { kind: 'collector' }, chat: { b: b.id, id } }],
    })
    expect(outcome.kind).toBe('ok')
    expect(await sourceOf(world, id)).toBeNull()
    expect(await youtubeMarked(world, seller.sellerId, b.date, b.rehearsal)).toBe(true)

    const other = await chat(world, seller, b.id, '반바지 인스타글')
    expect(await sourceOf(world, other)).toBe('other')

    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 인스타글'])
    expect(fake.requests.map((request) => request.raw).join('\n')).not.toContain('출처없음')
    const rows = await reviews(world, seller)
    expect((byText(rows, '반바지 출처없음') as unknown as Record<string, unknown>).excluded).toBe('YOUTUBE_POLICY')
    expect((byText(rows, '반바지 인스타글') as unknown as Record<string, unknown>).excluded).toBeNull()
  })

  it('e2e 채우기(fillScope)의 채팅은 유튜브 흉내라 출처 youtube', async () => {
    const { world, seller } = await assistWorld()
    const filled = await fillScope(world.server, seller.sellerId, { products: 3, chats: 5 })
    const rows = await pg(world).query<{ source: string | null }>('select distinct chat_source as source from events where type = $1 and seller_id = $2', ['chat', seller.sellerId])
    expect(rows.rows.map((row) => row.source)).toEqual(['youtube'])
    expect(await youtubeMarked(world, seller.sellerId, filled.date, false)).toBe(true)
  })
})
