// PL1A 적대 시험 (test-domain, AC-PL1A-91): 형식 3 백업 파일(봉인 범위 포함)을 무작위·의도적으로 고쳐 검사·복구·가져오기를 공격한다.
// - 실제 봉인 작업으로 날짜 A를 봉인한 판매자의 전체 기록 파일(apps/server/test/pl1a-support.ts 장면)을 한 번 만들고 그것을 고친다.
// - 고친 파일은 파일 요약값(backupDigest)을 다시 맞춘다 — 요약값 검사 하나에만 기대는 구현을 잡는다.
// - 모든 고친 파일: 검사·바꾸기 복구·빈 판매자 가져오기가 예외 없이 거절(쉬운 한국어 까닭)하고 두 서버의 모든 표·백업 목록이 그대로.
// - 같은 시험 안에서 바르게 만든 파일은 통과한다(늘 거절하는 구현을 잡는다).
import { rmSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FolderBackupStorage,
  SEALED_BACKUP_MESSAGES,
  backupDigest,
  backupEventDigest,
  checkBackupBytes,
  restoreSeller,
  type BackupEvent,
  type BackupFile,
  type BackupScope,
  type BackupSealed,
} from '../../../apps/server/src/backup.ts'
import { randomIds } from '../../../apps/server/src/ids.ts'
import { JSON_VALUE_MAX_LENGTH } from '../../../apps/server/src/json-stream.ts'
import { sha256Hex } from '../../../apps/server/src/secrets.ts'
import { getFile } from '../../../apps/server/test/i2-support.ts'
import { A, AFTER_SEAL, B, sealA, scenario, tempDir, tempDirs, type Scenario } from '../../../apps/server/test/pl1a-support.ts'
import { addSeller, client, dumpAllTables, fakeClock, newWorld, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const FILE_DIGEST = '파일 요약값이 맞지 않아요(파일이 손상됐거나 바뀌었어요).'
const SCOPE_SHAPE = '범위의 형식이 올바르지 않아요.'
const VERSION = '이 서버가 읽을 수 없는 형식 번호예요(2·3만 읽어요).'

const decode = (bytes: Uint8Array): BackupFile => JSON.parse(gunzipSync(bytes).toString('utf8')) as BackupFile
const gzipText = (text: string): Uint8Array => new Uint8Array(gzipSync(Buffer.from(text, 'utf8')))
/** 파일 요약값을 다시 계산해 맞춘다 */
const resign = (file: BackupFile): Uint8Array => gzipText(JSON.stringify({ ...file, digest: backupDigest(file) }))
const scopeOf = (file: BackupFile, date: string, rehearsal = false): BackupScope => file.scopes.find((scope) => scope.date === date && scope.rehearsal === rehearsal) as BackupScope
const withScope = (file: BackupFile, date: string, change: (scope: BackupScope) => unknown, rehearsal = false): BackupFile =>
  ({ ...file, scopes: file.scopes.map((scope) => (scope.date === date && scope.rehearsal === rehearsal ? change(scope) : scope)) }) as BackupFile
const withSealed = (file: BackupFile, sealed: unknown): BackupFile => withScope(file, A, (scope) => ({ ...scope, sealed }))
/** 이벤트의 seq를 바꾸고 이벤트 요약값을 다시 계산한다 (본문은 그대로) */
const reseq = (event: BackupEvent, seq: number, date = A): BackupEvent => ({ ...event, seq, digest: backupEventDigest(date, false, seq, event.type, event.body, event.failed) })
/** 장부 글을 바꾸고 장부 요약값을 다시 계산한 봉인 칸 */
const ledgerOf = (sealed: BackupSealed, ledger: string): BackupSealed => ({ ...sealed, ledger, ledgerDigest: sha256Hex(ledger) })
const flip = (text: string, index: number): string => {
  const c = text[index] as string
  const next = c === 'a' ? 'b' : c === '1' ? '2' : c === '"' ? '\'' : 'a'
  return `${text.slice(0, index)}${next}${text.slice(index + 1)}`
}

type Outcome = { ok: boolean; reason?: string } | { thrown: string }
async function settle(run: () => Promise<{ ok: boolean; reason?: string }>): Promise<Outcome> {
  try {
    const outcome = await run()
    return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason as string }
  } catch (error) {
    return { thrown: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
}

let s: Scenario
let file: BackupFile
let good: Uint8Array
let sealed: BackupSealed
let other: TestServer
let empty: Seller

beforeAll(async () => {
  s = await scenario()
  s.world.clock.set(AFTER_SEAL)
  await sealA(s.world)
  const response = await getFile(s.world, s.seller.cookie, '/api/export/records.json.gz')
  expect(response.status).toBe(200)
  good = response.bytes
  file = decode(good)
  expect(file.version).toBe(3)
  sealed = scopeOf(file, A).sealed as BackupSealed
  expect(sealed).not.toBeNull()
  other = await newWorld({ clock: fakeClock(s.world.clock.now()), backupStorage: new FolderBackupStorage(tempDir()) })
  empty = await addSeller(other)
}, 120_000)

/** 고친 파일 하나: 검사·바꾸기 복구·빈 판매자 가져오기 모두 예외 없이 같은 까닭으로 거절 (까닭이 주어지면 그 문장) */
async function expectRejected(label: string, bytes: Uint8Array, reason?: string): Promise<void> {
  const outcomes = [
    await settle(async () => checkBackupBytes(bytes)),
    await settle(async () => restoreSeller({ db: s.world.database.db, sellerId: s.seller.sellerId, bytes, replace: true, storage: s.storage, clock: s.world.clock, ids: randomIds })),
    await settle(async () => restoreSeller({ db: other.database.db, sellerId: empty.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })),
  ]
  for (const outcome of outcomes) {
    expect(outcome, label).toMatchObject({ ok: false })
    const text = (outcome as { reason: string }).reason
    if (reason !== undefined) expect(text, label).toBe(reason)
    // 판매자·운영자가 읽을 수 있는 한국어 (개발 오류 문장이 아니다)
    expect(text, label).toMatch(/[가-힣]/)
    expect(text, label).not.toMatch(/TypeError|undefined|null|Cannot|Unexpected|SyntaxError/)
  }
}

/** 공격 묶음 하나: 시작 전·끝난 뒤 두 서버의 모든 표와 백업 목록이 같고, 바른 파일은 같은 시험 안에서 통과한다 */
async function unchangedAround(run: () => Promise<void>): Promise<void> {
  const before = await dumpAllTables(s.world.database)
  const listBefore = await s.storage.list(s.seller.sellerId)
  const otherBefore = await dumpAllTables(other.database)
  await run()
  expect(await dumpAllTables(s.world.database)).toBe(before)
  expect(await s.storage.list(s.seller.sellerId)).toEqual(listBefore)
  expect(await dumpAllTables(other.database)).toBe(otherBefore)
  const checked = await checkBackupBytes(good)
  expect(checked.ok, JSON.stringify(checked)).toBe(true)
}

describe('TD-PL1A 봉인 칸 모양 변조 (AC-PL1A-91)', () => {
  it('sealed: {} · "x" · 숫자 · 목록 · ledger: null · 칸 하나 더 · 칸 하나 빠짐 · 봉인 시각이 글이 아님 · 날짜뿐인 봉인 시각 — 모두 봉인 칸 형식 문장으로 거절', async () => {
    await unchangedAround(async () => {
      const shape = SEALED_BACKUP_MESSAGES.shape(A)
      const cases: [string, unknown][] = [
        ['{}', {}],
        ['"x"', 'x'],
        ['숫자', 1],
        ['true', true],
        ['목록', [sealed.sealedAt, sealed.ledger, sealed.ledgerDigest]],
        ['ledger: null', { ...sealed, ledger: null }],
        ['ledgerDigest: null', { ...sealed, ledgerDigest: null }],
        ['sealedAt: null', { ...sealed, sealedAt: null }],
        ['칸 하나 더', { ...sealed, extra: 1 }],
        ['칸 하나 빠짐', { sealedAt: sealed.sealedAt, ledger: sealed.ledger }],
        ['봉인 시각 숫자', { ...sealed, sealedAt: Date.parse(sealed.sealedAt) }],
        ['봉인 시각 날짜만', { ...sealed, sealedAt: sealed.sealedAt.slice(0, 10) }],
        ['장부가 객체', { ...sealed, ledger: JSON.parse(sealed.ledger) as unknown }],
        ['__proto__ 칸', JSON.parse(`{"sealedAt":${JSON.stringify(sealed.sealedAt)},"ledger":${JSON.stringify(sealed.ledger)},"ledgerDigest":${JSON.stringify(sealed.ledgerDigest)},"__proto__":{"x":1}}`) as unknown],
      ]
      for (const [label, value] of cases) await expectRejected(label, resign(withSealed(file, value)), shape)
    })
  })

  it('봉인 안 한 범위(B)에 sealed를 끼움 — A의 봉인 칸 그대로·장부 날짜를 B로 고친 것(요약값 다시 계산) 모두 거절', async () => {
    await unchangedAround(async () => {
      await expectRejected('B에 A의 봉인 칸', resign(withScope(file, B, (scope) => ({ ...scope, sealed }))), SEALED_BACKUP_MESSAGES.unreadable(B))
      const asB = sealed.ledger.replace(`"date":"${A}"`, `"date":"${B}"`)
      expect(asB).not.toBe(sealed.ledger)
      await expectRejected('B에 날짜만 B로 고친 A의 장부', resign(withScope(file, B, (scope) => ({ ...scope, sealed: ledgerOf(sealed, asB) }))))
      // 리허설 범위에 끼움
      await expectRejected('리허설에 봉인 칸', resign(withScope(file, B, (scope) => ({ ...scope, sealed }), true)), SEALED_BACKUP_MESSAGES.rehearsal)
    })
  })

  it('같은 범위에 sealed 칸 두 번(JSON 키 중복) — 앞이 null·뒤가 봉인, 앞이 봉인·뒤가 null, 둘 다 봉인. 파일 요약값은 마지막 값으로 맞춰도 거절', async () => {
    await unchangedAround(async () => {
      const text = JSON.stringify({ ...file, digest: backupDigest(file) })
      const real = `"sealed":${JSON.stringify(sealed)}`
      expect(text.split(real)).toHaveLength(2)
      const nulled = withSealed(file, null)
      const variants: [string, string, string][] = [
        ['null 다음 봉인', `"sealed":null,${real}`, backupDigest(file)],
        ['봉인 다음 null', `${real},"sealed":null`, backupDigest(nulled)],
        ['봉인 두 번', `${real},${real}`, backupDigest(file)],
      ]
      for (const [label, replacement, digest] of variants) {
        const forged = text.replace(real, replacement).replace(/"digest":"[0-9a-f]+"}$/, `"digest":"${digest}"}`)
        expect(forged).not.toBe(text)
        await expectRejected(label, gzipText(forged), SCOPE_SHAPE)
      }
    })
  })

  it('형식 번호 4 · 형식 번호 3인데 sealed 칸이 없음 · 형식 번호 2인데 sealed 칸이 있음 — 거절', async () => {
    await unchangedAround(async () => {
      await expectRejected('형식 번호 4', resign({ ...file, version: 4 } as unknown as BackupFile), VERSION)
      await expectRejected('형식 번호 "3"', resign({ ...file, version: '3' } as unknown as BackupFile), VERSION)
      const withoutSealed = { ...file, scopes: file.scopes.map(({ sealed: _drop, ...rest }) => rest) } as unknown as BackupFile
      await expectRejected('형식 3 · sealed 칸 없음', resign(withoutSealed))
      await expectRejected('형식 2 · sealed 칸 있음', resign({ ...file, version: 2 } as unknown as BackupFile))
      // 봉인 칸 한 글자만 바꾸고 파일 요약값은 그대로 — 파일 요약값이 봉인 칸까지 덮는다
      const touched = withSealed(file, { ...sealed, sealedAt: sealed.sealedAt.replace(/\d(?=Z$)/, (c) => (c === '1' ? '2' : '1')) })
      await expectRejected('봉인 시각 한 글자(파일 요약값 그대로)', gzipText(JSON.stringify({ ...touched, digest: file.digest })), FILE_DIGEST)
    })
  })
})

describe('TD-PL1A 봉인 범위 이벤트의 seq 변조 (AC-PL1A-91)', () => {
  it('seq 0 · 음수 · 순서 뒤집음(seq 그대로) · 뒤집고 seq를 1부터 다시 매김 · 두 개 맞바꿈 — 이벤트 요약값을 다시 계산해도 거절', async () => {
    await unchangedAround(async () => {
      const events = scopeOf(file, A).events
      expect(events.length).toBeGreaterThan(3)
      const swap = [...events]
      ;[swap[1], swap[2]] = [swap[2] as BackupEvent, swap[1] as BackupEvent]
      const cases: [string, readonly BackupEvent[], string | undefined][] = [
        ['seq 0', events.map((event, i) => (i === 0 ? reseq(event, 0) : event)), undefined],
        ['seq -1', events.map((event, i) => (i === 0 ? reseq(event, -1) : event)), undefined],
        ['순서 뒤집음', [...events].reverse(), undefined],
        ['뒤집고 다시 매김', [...events].reverse().map((event, i) => reseq(event, i + 1)), undefined],
        ['두 개 맞바꿈 (다시 매김)', swap.map((event, i) => reseq(event, i + 1)), undefined],
        ['seq 두 번', events.map((event, i) => (i === 1 ? reseq(event, 1) : event)), undefined],
        ['seq 1.5', events.map((event, i) => (i === 0 ? { ...event, seq: 1.5 } : event)), undefined],
      ]
      for (const [label, list, reason] of cases) await expectRejected(label, resign(withScope(file, A, (scope) => ({ ...scope, events: list }))), reason)
      // 범위 끝의 seq만 바꿈
      await expectRejected('범위 seq + 1', resign(withScope(file, A, (scope) => ({ ...scope, seq: scope.seq + 1 }))))
      await expectRejected('범위 seq 0', resign(withScope(file, A, (scope) => ({ ...scope, seq: 0 }))))
      // 이벤트 0개인 봉인 범위
      await expectRejected('이벤트 없음', resign(withScope(file, A, (scope) => ({ ...scope, events: [], seq: 0 }))))
    })
  })
})

describe('TD-PL1A 장부 바꿔치기 (AC-PL1A-91)', () => {
  it('다른 날짜의 장부 — 파일 요약값만 맞춤(장부 요약값 그대로)은 장부 요약값 문장, 장부 요약값까지 맞춤은 읽을 수 없는 장부 문장', async () => {
    await unchangedAround(async () => {
      const other = sealed.ledger.replace(`"date":"${A}"`, '"date":"2026-08-15"')
      expect(other).not.toBe(sealed.ledger)
      await expectRejected('파일 요약값만 맞춤', resign(withSealed(file, { ...sealed, ledger: other })), SEALED_BACKUP_MESSAGES.digest(A))
      await expectRejected('장부 요약값까지 맞춤', resign(withSealed(file, ledgerOf(sealed, other))), SEALED_BACKUP_MESSAGES.unreadable(A))
      // 장부 요약값을 대문자로(같은 값의 다른 글)
      await expectRejected('장부 요약값 대문자', resign(withSealed(file, { ...sealed, ledgerDigest: sealed.ledgerDigest.toUpperCase() })), SEALED_BACKUP_MESSAGES.digest(A))
      // 장부가 JSON이 아님 · 빈 글
      await expectRejected('장부가 JSON 아님', resign(withSealed(file, ledgerOf(sealed, sealed.ledger.slice(0, -1)))), SEALED_BACKUP_MESSAGES.unreadable(A))
      await expectRejected('빈 장부', resign(withSealed(file, ledgerOf(sealed, ''))), SEALED_BACKUP_MESSAGES.unreadable(A))
      await expectRejected('장부 = null 글', resign(withSealed(file, ledgerOf(sealed, 'null'))), SEALED_BACKUP_MESSAGES.unreadable(A))
    })
  })

  it('속성: 장부 글 아무 한 글자를 바꾸면(장부 요약값 그대로, 파일 요약값 맞춤) 늘 장부 요약값 문장으로 거절된다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: sealed.ledger.length - 1 }), async (index) => {
        const touched = flip(sealed.ledger, index)
        if (touched === sealed.ledger) return
        expect(await checkBackupBytes(resign(withSealed(file, { ...sealed, ledger: touched })))).toEqual({ ok: false, reason: SEALED_BACKUP_MESSAGES.digest(A) })
      }),
      { numRuns: 25, seed: 20261024 },
    )
  })

  it('속성: 봉인 범위 이벤트 본문 아무 한 글자를 바꾸면(이벤트 요약값 그대로) 그 이벤트의 요약값 문장으로 거절된다', async () => {
    const events = scopeOf(file, A).events
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: events.length - 1 }), fc.nat(), async (which, at) => {
        const event = events[which] as BackupEvent
        const body = flip(event.body, at % event.body.length)
        const forged = withScope(file, A, (scope) => ({ ...scope, events: scope.events.map((item, i) => (i === which ? { ...item, body } : item)) }))
        expect(await checkBackupBytes(resign(forged))).toEqual({ ok: false, reason: `범위 ${A}의 seq ${String(event.seq)} 이벤트 요약값이 맞지 않아요(기록이 바뀌었어요).` })
      }),
      { numRuns: 25, seed: 20261024 },
    )
  })
})

describe('TD-PL1A 장부 안의 이상한 값 (AC-PL1A-91)', () => {
  it('TD-PL1A-001: 장부의 방송 목록에 null·숫자가 든 장부(요약값 모두 다시 계산) — 예외로 멈추지 않고 읽을 수 없는 장부 문장으로 거절', async () => {
    await unchangedAround(async () => {
      const ledger = JSON.parse(sealed.ledger) as Record<string, unknown>
      for (const [label, broadcasts] of [
        ['방송 목록에 null', [null, ...(ledger.broadcasts as unknown[])]],
        ['방송 목록에 숫자', [1, ...(ledger.broadcasts as unknown[])]],
      ] as const) {
        await expectRejected(label, resign(withSealed(file, ledgerOf(sealed, JSON.stringify({ ...ledger, broadcasts })))), SEALED_BACKUP_MESSAGES.unreadable(A))
      }
    })
  })

  it('TD-PL1A-002: 장부 맨 위·판매 행 안에 __proto__ 칸을 끼운 장부(요약값 모두 다시 계산)는 거절된다', async () => {
    await unchangedAround(async () => {
      const top = sealed.ledger.replace(/^\{/, '{"__proto__":{"date":"2026-08-15","format":"livejjim-ledger/2"},')
      expect(top).not.toBe(sealed.ledger)
      await expectRejected('장부 맨 위 __proto__', resign(withSealed(file, ledgerOf(sealed, top))))
      const inSale = sealed.ledger.replace('"sales":[{', '"sales":[{"__proto__":{"amount":1},')
      expect(inSale).not.toBe(sealed.ledger)
      await expectRejected('판매 행 안 __proto__', resign(withSealed(file, ledgerOf(sealed, inSale))))
    })
    // 끼운 칸이 어디에도 번지지 않았다
    expect(({} as Record<string, unknown>).amount).toBeUndefined()
    expect(({} as Record<string, unknown>).date).toBeUndefined()
  })

  it('아주 긴 장부(값 글 상한 64Mi 글자 넘음) — 멈추지 않고 거절, 기록 그대로', async () => {
    await unchangedAround(async () => {
      // 상한은 글자 수 — 봉인 칸 값 하나의 글이 상한을 넘게 한 글자 글자를 채운다
      const huge = sealed.ledger.replace(/^\{/, `{"pad":"${'a'.repeat(JSON_VALUE_MAX_LENGTH + 16)}",`)
      expect(huge.length).toBeGreaterThan(JSON_VALUE_MAX_LENGTH)
      // 64Mi 글자 파일은 한 번 읽는 데도 오래 걸려 바꾸기 복구 하나만 (검사·빈 판매자 가져오기와 같은 읽기 함수 walkBackup이 먼저 돈다)
      const bytes = resign(withSealed(file, ledgerOf(sealed, huge)))
      const restored = await settle(async () => restoreSeller({ db: s.world.database.db, sellerId: s.seller.sellerId, bytes, replace: true, storage: s.storage, clock: s.world.clock, ids: randomIds }))
      expect(restored).toMatchObject({ ok: false })
      expect((restored as { reason: string }).reason).toMatch(/[가-힣]/)
    })
  }, 180_000)
})

describe('TD-PL1A 바른 파일은 통과한다 (늘 거절하는 구현을 잡는다)', () => {
  it('고치지 않은 파일 · 요약값을 다시 계산하기만 한 파일 모두 검사를 통과하고 빈 판매자로 가져와진다(A는 봉인된 채)', async () => {
    expect((await checkBackupBytes(good)).ok).toBe(true)
    const again = resign(file)
    const checked = await checkBackupBytes(again)
    expect(checked.ok, JSON.stringify(checked)).toBe(true)
    if (!checked.ok) return
    expect(checked.value.file.scopes.map((scope) => [scope.date, scope.rehearsal, scope.sealed, scope.snapshots, scope.outbox])).toEqual([
      [A, false, true, 0, 0],
      [B, false, false, 1, expect.any(Number)],
      [B, true, false, 1, expect.any(Number)],
    ])
    const world = await newWorld({ clock: fakeClock(s.world.clock.now()), backupStorage: new FolderBackupStorage(tempDir()) })
    const target = await addSeller(world)
    const restored = await restoreSeller({ db: world.database.db, sellerId: target.sellerId, bytes: again, replace: false, storage: null, clock: world.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    world.server.writer.forgetSeller(target.sellerId)
    expect((await client(world, target.cookie).get(`/api/days/${A}`)).body.sealed).toBe(true)
  })
})
