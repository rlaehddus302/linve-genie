// QL2 백업 복구·가져오기의 채팅 출처 (DAT-04, DAT-06, CMT-06, D-QL2-08): AC-QL2-30·31·32
// 파일엔 출처 칸이 없다 — 복구 때 리허설 범위면 rehearsal, 메시지 ID가 ig:·tt:로 시작하면 other, 그 밖은 youtube로 되살린다.
// 범위의 유튜브 채팅 표시(봉인 대상)는 기록 경로(writer.ts)와 같은 규칙으로 되살린 출처에서 정한다.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { BACKUP_VERSION, FolderBackupStorage, createBackupBytes, restoreSeller, restoredChatSource, type BackupFile } from '../src/backup.ts'
import { randomIds } from '../src/ids.ts'
import { addSeller, expectOk, fakeClock, writeEvent, type FakeClock, type Seller, type TestServer } from './support.ts'
import { assistWorld, byText, enableAssist, reviews, sentTexts, shortsBroadcast, suggest } from './a1-support.ts'
import { kst } from './i2-support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'livejjim-ql2-backup-'))
  dirs.push(dir)
  return dir
}

const pg = (world: TestServer) => {
  const db = world.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile

async function serverWithStorage(clock: FakeClock) {
  const storage = new FolderBackupStorage(tempDir())
  const assist = await assistWorld({ clock, server: { backupStorage: storage } })
  return { ...assist, storage }
}

/** (메시지 ID 또는 채팅 아님 표시) → 출처, 판매자의 모든 이벤트 */
async function sourcesOf(world: TestServer, seller: Seller): Promise<{ type: string; id: string | null; rehearsal: boolean; source: string | null }[]> {
  const rows = await pg(world).query<{ type: string; id: string | null; rehearsal: boolean; source: string | null }>(
    'select e.type, e.chat_message_id as id, s.rehearsal, e.chat_source as source from events e join scopes s on s.id = e.scope_id where e.seller_id = $1 order by s.date, s.rehearsal, e.seq',
    [seller.sellerId],
  )
  return rows.rows
}

async function marksOf(world: TestServer, seller: Seller): Promise<[string, boolean, boolean][]> {
  const rows = await pg(world).query<{ date: string; rehearsal: boolean; y: boolean }>('select date, rehearsal, youtube_chat as y from scopes where seller_id = $1 order by date, rehearsal', [seller.sellerId])
  return rows.rows.map((row) => [row.date, row.rehearsal, row.y])
}

async function openChat(world: TestServer, seller: Seller, b: string, id: string, text: string): Promise<void> {
  const outcome = await world.server.service.ingestOpenChat(seller.sellerId, { b, id, ch: `${id.slice(0, 3)}buyer-${id}`, nick: '댓글손님', text })
  expect(outcome.status).toBe('recorded')
}

async function youtube(world: TestServer, seller: Seller, b: string, id: string, text: string): Promise<void> {
  const outcome = await world.server.ingestChat(seller.sellerId, { b, id, ch: 'UCyoutube00000000000001', nick: '유튜브손님', text })
  expect(outcome.status).toBe('recorded')
}

async function extension(world: TestServer, seller: Seller, b: string, id: string, text: string): Promise<void> {
  const outcome = await world.server.service.ingestYoutubeBatch(seller.sellerId, b, [{ id, ch: 'UCextension000000000001', nick: '확장손님', text }], undefined, 'extension')
  expect(outcome).toEqual({ status: 'ok', recorded: 1 })
}

const DAY_A = '2026-10-20'
const DAY_B = '2026-10-21'
const DAY_C = '2026-10-22'

/**
 * 실제 범위 B(옵션 방송): 유튜브·확장·인스타그램·틱톡 줄, 같은 날 리허설 범위: 리허설 채팅(접두어 없음·ig:)
 * 실제 범위 A: 인스타그램 댓글만, 실제 범위 C: 채팅 없음
 */
async function source() {
  const clock = fakeClock(kst(DAY_A, '10:00:00'))
  const s = await serverWithStorage(clock)
  const { world, seller } = s
  const a = await shortsBroadcast(world, seller)
  expect(a.date).toBe(DAY_A)
  await openChat(world, seller, a.id, 'ig:a-1', '반바지 에이인스타')
  clock.set(kst(DAY_B, '10:00:00'))
  const b = await shortsBroadcast(world, seller)
  expect(b.date).toBe(DAY_B)
  await youtube(world, seller, b.id, 'yt-1', '반바지 유튜브글')
  await extension(world, seller, b.id, 'ext-1', '반바지 확장글')
  await openChat(world, seller, b.id, 'ig:b-1', '반바지 인스타글')
  await openChat(world, seller, b.id, 'tt:b-1', '반바지 틱톡글')
  const r = await shortsBroadcast(world, seller, { rehearsal: true })
  expect([r.date, r.rehearsal]).toEqual([DAY_B, true])
  await youtube(world, seller, r.id, 'sim-1', '반바지 리허설글')
  await openChat(world, seller, r.id, 'ig:r-1', '반바지 리허설인스타')
  clock.set(kst(DAY_C, '10:00:00'))
  const c = await shortsBroadcast(world, seller)
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: c.id, no: 22, name: '청옥', price: 3000 }))
  return { ...s, clock, b }
}

const EXPECTED_CHATS: [string, boolean, string][] = [
  ['ig:a-1', false, 'other'],
  ['yt-1', false, 'youtube'],
  ['ext-1', false, 'youtube'],
  ['ig:b-1', false, 'other'],
  ['tt:b-1', false, 'other'],
  ['sim-1', true, 'rehearsal'],
  ['ig:r-1', true, 'rehearsal'],
]

function expectRestoredSources(rows: Awaited<ReturnType<typeof sourcesOf>>): void {
  const chats = rows.filter((row) => row.type === 'chat').map((row) => [row.id, row.rehearsal, row.source])
  expect([...chats].sort()).toEqual([...EXPECTED_CHATS].sort())
  // 채팅이 아닌 이벤트는 null (지금 그대로)
  const others = rows.filter((row) => row.type !== 'chat')
  expect(others.length).toBeGreaterThan(0)
  expect(others.every((row) => row.source === null)).toBe(true)
}

const EXPECTED_MARKS: [string, boolean, boolean][] = [
  [DAY_A, false, false],
  [DAY_B, false, true],
  [DAY_B, true, false],
  [DAY_C, false, false],
]

describe('restoredChatSource (D-QL2-08)', () => {
  it('리허설이면 rehearsal, ig:·tt: 접두어면 other, 그 밖(접두어 없음·ID 없음·대문자·앞 공백·sms:)은 youtube', () => {
    expect(restoredChatSource(true, 'ig:x')).toBe('rehearsal')
    expect(restoredChatSource(true, 'yt')).toBe('rehearsal')
    expect(restoredChatSource(false, 'ig:x')).toBe('other')
    expect(restoredChatSource(false, 'tt:x')).toBe('other')
    for (const id of ['yt-1', '', undefined, null, 7, 'IG:x', ' ig:x', 'ig', 'sms:x', 'TT:x']) expect(restoredChatSource(false, id)).toBe('youtube')
  })
})

describe('AC-QL2-30·31 복구·가져오기에서 채팅 출처와 유튜브 채팅 표시를 되살린다', () => {
  it('기록 때 출처 — 유튜브 youtube, 확장 extension, ig:·tt: other, 리허설 수집기 rehearsal (복구 전 모습)', async () => {
    const { world, seller } = await source()
    const rows = await sourcesOf(world, seller)
    const chats = rows.filter((row) => row.type === 'chat').map((row) => [row.id, row.source])
    expect([...chats].sort()).toEqual(
      [
        ['ig:a-1', 'other'],
        ['yt-1', 'youtube'],
        ['ext-1', 'extension'],
        ['ig:b-1', 'other'],
        ['tt:b-1', 'other'],
        ['sim-1', 'rehearsal'],
        // 리허설 방송의 인스타그램 수집 경로는 기록 때 other(a1-support) — 복구 땐 D-QL2-08대로 rehearsal(AI·봉인에서 같은 대우)
        ['ig:r-1', 'other'],
      ].sort(),
    )
    expect(await marksOf(world, seller)).toEqual(EXPECTED_MARKS)
  })

  it('같은 서버 바꾸기 복구: 출처 되살림(확장 줄은 youtube), 채팅 아닌 이벤트 null, 표시 A 없음·B 있음·C 없음 — 형식 번호 3, 파일에 출처 칸 없음', async () => {
    const { world, seller, storage } = await source()
    const before = await marksOf(world, seller)
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const file = decode(bytes)
    expect(file.version).toBe(3)
    expect(BACKUP_VERSION).toBe(3)
    for (const scope of file.scopes) {
      for (const event of scope.events) {
        expect(Object.keys(event).sort()).toEqual(['accountId', 'actor', 'at', 'body', 'digest', 'failed', 'receivedAt', 'requestId', 'seq', 'type'].sort())
        expect(event.body).not.toContain('"source"')
      }
    }
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage, clock: world.clock, ids: randomIds })
    expect(restored.ok, restored.ok ? '' : restored.reason).toBe(true)
    expectRestoredSources(await sourcesOf(world, seller))
    expect(await marksOf(world, seller)).toEqual(EXPECTED_MARKS)
    expect(await marksOf(world, seller)).toEqual(before)
  })

  it('다른 서버의 빈 판매자로 가져오기: 같은 결과', async () => {
    const { world, seller, clock } = await source()
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const other = await serverWithStorage(fakeClock(clock.now()))
    const target = await addSeller(other.world)
    const restored = await restoreSeller({ db: other.world.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.world.clock, ids: randomIds })
    expect(restored.ok, restored.ok ? '' : restored.reason).toBe(true)
    expectRestoredSources(await sourcesOf(other.world, target))
    expect(await marksOf(other.world, target)).toEqual(EXPECTED_MARKS)
  })
})

describe('AC-QL2-32 복구 뒤 AI 거르기', () => {
  it('가져온 판매자의 옵션 방송 확인 필요 항목: 유튜브·확장 줄 글은 가짜 LLM에 가지 않고 YOUTUBE_POLICY, 인스타그램·틱톡 줄은 간다 (복구 전과 같음)', async () => {
    const { world, seller, fake, clock } = await source()
    // 복구 전
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller, { rehearsal: false }))).body.result).toBe('DONE')
    const beforeSent = fake.requests.flatMap((_, index) => sentTexts(fake, index))
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())

    const other = await serverWithStorage(fakeClock(clock.now()))
    const target = await addSeller(other.world)
    const restored = await restoreSeller({ db: other.world.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.world.clock, ids: randomIds })
    expect(restored.ok, restored.ok ? '' : restored.reason).toBe(true)
    await enableAssist(other.world, target)
    expect((await expectOk(suggest(other.world, target, { rehearsal: false }))).body.result).toBe('DONE')
    const sent = other.fake.requests.flatMap((_, index) => sentTexts(other.fake, index))
    const raw = other.fake.requests.map((request) => request.raw).join('\n')
    for (const text of ['반바지 유튜브글', '반바지 확장글']) {
      expect(sent).not.toContain(text)
      expect(raw).not.toContain(text)
    }
    for (const text of ['반바지 인스타글', '반바지 틱톡글']) expect(sent).toContain(text)
    expect([...sent].sort()).toEqual([...beforeSent].sort())
    const rows = await reviews(other.world, target)
    const excluded = (text: string): unknown => (byText(rows, text) as unknown as Record<string, unknown>).excluded
    expect(excluded('반바지 유튜브글')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 확장글')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 인스타글')).toBeNull()
    expect(excluded('반바지 틱톡글')).toBeNull()
  })
})
