// AIY1 적대 시험 (test-domain, CMT-06, D-AIY1-01~04·06): 서버 API·가짜 LLM 서버로 "유튜브 채팅은 AI로 보내지 않는다"를 공격한다.
// - 출처 비틀기: DB의 chat_source를 대소문자·공백·제로폭으로 바꾼 줄은 유튜브 줄로 다뤄 보내지 않는다(모르면 보내지 않는 쪽)
// - 백업 복구: 실제 범위의 채팅은 복구 뒤 출처 youtube로 적힌다 — 복구 전 인스타 줄이었어도 복구 뒤엔 보내지 않는다(AC-AIY1-03). 리허설 범위 줄은 그대로 보낸다
// - 무작위 섞기: 유튜브·확장·인스타 줄을 무작위로 섞어 여러 번 제안 받기 — 가짜 LLM이 받은 원문 어디에도 유튜브 줄의 글이 없고, 묶음 수를 넘지 않고, 목록의 excluded가 출처와 맞다
import { randomIds } from '../../../apps/server/src/ids.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FolderBackupStorage, createBackupBytes, restoreSeller } from '../../../apps/server/src/backup.ts'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { assistWorld, byText, chat, enableAssist, reviews, sentTexts, shortsBroadcast, suggest, youtubeChat, type ReviewRow } from '../../../apps/server/test/a1-support.ts'
import { expectOk, type Seller, type TestServer } from '../../../apps/server/test/support.ts'
import type { FakeLlm } from '../../../apps/server/src/assist/fake-llm.ts'

const backupDir = mkdtempSync(join(tmpdir(), 'livejjim-aiy1-restore-'))
afterAll(() => rmSync(backupDir, { recursive: true, force: true }))

const pg = (world: TestServer) => {
  const db = world.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

async function setSource(world: TestServer, text: string, source: string | null): Promise<void> {
  const rows = await pg(world).query<{ seq: number }>(
    `update events set chat_source = $1 where id in (select e.id from events e left join chat_raw r on r.seller_id = e.seller_id and r.scope_id = e.scope_id and r.seq = e.seq where e.chat_message_id is not null and coalesce(r.text, e.body::json->>'text') = $2) returning seq`,
    [source, text],
  )
  expect(rows.rows.length, text).toBeGreaterThan(0)
}

const excludedOf = (row: ReviewRow): unknown => (row as unknown as Record<string, unknown>).excluded
const allRaw = (fake: FakeLlm): string => fake.requests.map((request) => request.raw).join('\n')

async function extensionChat(world: TestServer, seller: Seller, b: string, id: string, text: string): Promise<void> {
  const outcome = await world.server.service.ingestYoutubeBatch(seller.sellerId, b, [{ id, ch: `UCext${id.padStart(18, '0')}`, nick: '확장시청자', text }], undefined, 'extension')
  expect(outcome).toEqual({ status: 'ok', recorded: 1 })
}

describe('TD-AIY1-01 출처 값 비틀기', () => {
  it('chat_source가 OTHER·Other·" other"·제로폭·전각·Rehearsal이면 유튜브 줄 — 보내지 않고 excluded YOUTUBE_POLICY', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    const twisted: readonly [string, string][] = [
      ['반바지 대문자출처', 'OTHER'],
      ['반바지 첫대문자출처', 'Other'],
      ['반바지 앞공백출처', ' other'],
      ['반바지 제로폭출처', 'other​'],
      ['반바지 전각출처', 'ｏｔｈｅｒ'],
      ['반바지 리허설대문자', 'Rehearsal'],
      ['반바지 유튜브대문자', 'YouTube'],
    ]
    for (const [text] of twisted) await chat(world, seller, b.id, text)
    await chat(world, seller, b.id, '반바지 진짜인스타')
    for (const [text, source] of twisted) await setSource(world, text, source)
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 진짜인스타'])
    for (const [text] of twisted) expect(allRaw(fake), text).not.toContain(text.split(' ')[1])
    const rows = await reviews(world, seller)
    for (const [text] of twisted) expect(excludedOf(byText(rows, text)), text).toBe('YOUTUBE_POLICY')
    expect(excludedOf(byText(rows, '반바지 진짜인스타'))).toBeNull()
  })
})

describe('TD-AIY1-02 백업 복구 뒤', () => {
  it('실제 범위의 인스타 줄은 복구 뒤 출처 youtube — 보내지 않고 YOUTUBE_POLICY. 리허설 범위 줄은 그대로 보낸다', async () => {
    const { world, fake, seller } = await assistWorld()
    const real = await shortsBroadcast(world, seller)
    const rehearsal = await shortsBroadcast(world, seller, { rehearsal: true })
    await chat(world, seller, real.id, '반바지 복구전인스타')
    await youtubeChat(world, seller, real.id, '반바지 복구전유튜브')
    await youtubeChat(world, seller, rehearsal.id, '반바지 복구전리허설')
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    // 같은 판매자로 바꾸기 복구 (복구 전 출처 기록은 버려지고 백업 파일에서 다시 만든다)
    const target = seller
    const restored = await restoreSeller({ db: world.database.db, sellerId: target.sellerId, bytes, replace: true, storage: new FolderBackupStorage(backupDir), clock: world.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    // 운영 명령은 서버를 다시 켠다 — 같은 프로세스에서는 범위 상태 캐시를 비운다(backup.ts restoreSeller 설명)
    world.server.writer.forgetSeller(target.sellerId)
    const sources = await pg(world).query<{ chat_source: string | null; rehearsal: boolean }>(
      'select e.chat_source, s.rehearsal from events e join scopes s on s.id = e.scope_id where e.seller_id = $1 and e.chat_message_id is not null order by s.rehearsal, e.seq',
      [target.sellerId],
    )
    expect(sources.rows).toEqual([
      { chat_source: 'youtube', rehearsal: false },
      { chat_source: 'youtube', rehearsal: false },
      { chat_source: 'rehearsal', rehearsal: true },
    ])
    await enableAssist(world, target)
    expect((await expectOk(suggest(world, target))).body).toEqual({ result: 'DONE', called: 0 })
    expect(fake.calls).toBe(0)
    const rows = await reviews(world, target)
    expect(rows.map((row) => [row.text, excludedOf(row), row.suggestion])).toEqual(
      expect.arrayContaining([
        ['반바지 복구전인스타', 'YOUTUBE_POLICY', null],
        ['반바지 복구전유튜브', 'YOUTUBE_POLICY', null],
      ]),
    )
    expect(rows).toHaveLength(2)
    expect((await expectOk(suggest(world, target, { rehearsal: true }))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 복구전리허설'])
    expect(allRaw(fake)).not.toContain('복구전인스타')
    expect(allRaw(fake)).not.toContain('복구전유튜브')
  })
})

describe('TD-AIY1-03 무작위로 섞은 출처', () => {
  it('속성: 유튜브·확장·인스타 줄을 섞어 여러 번 받아도 유튜브 줄 글은 가짜 LLM에 가지 않고, excluded는 출처와 맞다', async () => {
    const lineArb = fc.record({ kind: fc.constantFrom<'youtube' | 'extension' | 'other'>('youtube', 'extension', 'other'), word: fc.constantFrom('가나다', '라마바', '사아자', '차카타', '파하가') })
    await fc.assert(
      fc.asyncProperty(fc.array(lineArb, { minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 3 }), async (lines, rounds) => {
        const { world, fake, seller } = await assistWorld()
        const b = await shortsBroadcast(world, seller)
        const kinds = new Map<string, 'youtube' | 'extension' | 'other'>()
        for (const [index, line] of lines.entries()) {
          // 같은 낱말을 출처마다 다른 글로 (원문 포함 검사를 위해 줄마다 고유 표시)
          const text = `반바지 ${line.word}${String(index)}호${line.kind === 'other' ? '인' : '유'}`
          kinds.set(text, line.kind)
          if (line.kind === 'youtube') await youtubeChat(world, seller, b.id, text)
          else if (line.kind === 'extension') await extensionChat(world, seller, b.id, `ext-${String(index)}`, text)
          else await chat(world, seller, b.id, text)
        }
        await enableAssist(world, seller)
        for (let round = 0; round < rounds; round++) await expectOk(suggest(world, seller))
        const raw = allRaw(fake)
        const sent = fake.requests.flatMap((_, index) => sentTexts(fake, index))
        for (const [text, kind] of kinds) {
          const marker = text.split(' ')[1] as string
          if (kind !== 'other') {
            expect(raw, text).not.toContain(marker)
            expect(sent).not.toContain(text)
          }
        }
        const otherCount = [...kinds.values()].filter((kind) => kind === 'other').length
        expect(fake.calls).toBe(otherCount === 0 ? 0 : 1)
        const rows = await reviews(world, seller)
        for (const row of rows) {
          const kind = kinds.get(row.text ?? '')
          expect(kind, row.text ?? '').toBeDefined()
          expect(excludedOf(row), row.text ?? '').toBe(kind === 'other' ? null : 'YOUTUBE_POLICY')
          if (kind !== 'other') expect(row.suggestion === null || row.suggestion.source === 'RULE', row.text ?? '').toBe(true)
        }
      }),
      { numRuns: 6 },
    )
  }, 120_000)
})
