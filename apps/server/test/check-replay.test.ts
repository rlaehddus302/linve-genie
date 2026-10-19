// AC-S04-29 재생 무결성 검사 명령: 범위마다 처음부터 재생해 스냅샷·발송함·불변식·seq 빈틈을 대조한다. DB를 바꾸지 않는다.
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEvent } from '@livejjim/core'
import { afterAll, describe, expect, it } from 'vitest'
import { checkReplay, formatCheck } from '../src/check-replay.ts'
import { openPglite } from '../src/db/database.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { addSeller, createBroadcast, dumpAllTables, expectOk, newWorld, startServer, writeEvent, type TestServer } from './support.ts'

async function busy(world: TestServer) {
  const seller = await addSeller(world)
  const b = await createBroadcast(world, seller)
  await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: '비밀품종', price: 10000 }))
  for (let i = 0; i < 4; i++) await world.server.ingestChat(seller.sellerId, { b: b.id, id: `m${String(i)}`, ch: `UC${String(i)}`, nick: `닉네임${String(i)}`, text: '1' })
  await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received: '12:00', phone: '010-4444-5555', memo: '메모표식' }))
  await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 1, buyer: 'UC0', reason: '사유표식' }))
  return { seller, b }
}

describe('AC-S04-29 재생 무결성 검사', () => {
  it('모두 같으면 범위마다 "일치" 한 줄 (스냅샷·발송함·실패 표시 수 보고)', async () => {
    const world = await newWorld({ snapshotEvery: 3 })
    const { seller, b } = await busy(world)
    const other = await addSeller(world)
    await createBroadcast(world, other, { date: '2026-10-18' })
    const results = await checkReplay(world.database.db)
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.ok)).toBe(true)
    const mine = results.find((result) => result.sellerId === seller.sellerId)
    expect(mine).toMatchObject({ date: b.date, events: 8, snapshots: 2, outbox: 4, failedMarked: 0, firstDiff: null })
    expect(formatCheck(mine as NonNullable<typeof mine>)).toBe(`판매자 ${seller.sellerId} · ${b.date} · 일치 (이벤트 8 · 스냅샷 2 · 발송함 4 · 실패 표시 0)`)
    // 판매자·날짜로 고르기
    expect(await checkReplay(world.database.db, { sellerId: other.sellerId })).toHaveLength(1)
    expect(await checkReplay(world.database.db, { date: '2026-10-18' })).toHaveLength(1)
    expect(await checkReplay(world.database.db, { sellerId: seller.sellerId, date: '2026-10-18' })).toHaveLength(0)
  })

  it('실패 표시 입력은 건너뛰고 수만 보고한다', async () => {
    let boom = false
    const world = await newWorld({
      engine: {
        applyEvent: (state, event) => {
          if (boom) throw new Error('x')
          return applyEvent(state, event)
        },
      },
    })
    const { seller, b } = await busy(world)
    boom = true
    await writeEvent(world, seller, { type: 'product.register', b: b.id, no: 2, name: 'x', price: 1 })
    boom = false
    const [result] = await checkReplay(world.database.db)
    expect(result).toMatchObject({ ok: true, failedMarked: 1, events: 9 })
  })

  const tamper: [string, string, string][] = [
    ['스냅샷 상태', `update snapshots set state = regexp_replace(state, '"subtotal":[1-9][0-9]*', '"subtotal":1', 'g') where seq = 6`, '스냅샷'],
    ['스냅샷 확인 필요 목록', `update snapshots set attention = '[{"seq":1,"message":"x"}]' where seq = 3`, '스냅샷'],
    ['발송함 내용', `update outbox set body = replace(body, '"confirmVersion":1', '"confirmVersion":9') where effect_id like '%PRINT%' and seq = 3`, '발송함'],
    ['발송함 행 지우기', `delete from outbox where seq = 3 and effect_id like '%THANKS%'`, '발송함'],
    ['발송함 행 더하기', `insert into outbox (seller_id, scope_id, effect_id, seq, kind, body, created_at) select seller_id, scope_id, 'c9:VOID_LABEL:-:1', 5, 'VOID_LABEL', '{}', now() from outbox limit 1`, '발송함'],
    ['이벤트 본문', `update events set body = replace(body, '"text":"1"', '"text":"2"') where seq = 5`, '이벤트'],
    ['이벤트 실패 표시', `update events set failed = true where seq = 4`, '이벤트'],
    ['이벤트 지우기(seq 빈틈)', `delete from events where seq = 6`, 'seq'],
    // S05: 범위 행의 지금 seq(8)와 기록의 마지막 seq(7)가 달라 잡힌다 — S04의 "마지막 이벤트를 지우면 모를 수 있음" 한계를 닫는다 (AC-S05-60)
    ['마지막 이벤트 지우기', `delete from events where seq = 8`, '범위 seq'],
    ['범위 행의 seq만 바꾸기', `update scopes set seq = seq + 1`, '범위 seq'],
    ['범위 행의 seq를 줄이기', `update scopes set seq = seq - 2`, '범위 seq'],
  ]
  for (const [label, sql, part] of tamper) {
    it(`행 하나를 바꿔 두면(${label}) 그 범위가 불일치로 보고된다 — 처음 다른 seq와 부분`, async () => {
      const world = await newWorld({ snapshotEvery: 3 })
      await busy(world)
      expect((await checkReplay(world.database.db))[0]?.ok).toBe(true)
      await world.database.pglite?.exec(sql)
      const [result] = await checkReplay(world.database.db)
      expect(result?.ok, label).toBe(false)
      expect(result?.firstDiff?.part, label).toBe(part)
      expect(formatCheck(result as NonNullable<typeof result>)).toMatch(new RegExp(`불일치 — 처음 다른 곳: seq \\d+ \\(${part}\\)`))
    })
  }

  it('검사는 DB를 바꾸지 않는다', async () => {
    const world = await newWorld({ snapshotEvery: 3 })
    await busy(world)
    await world.database.pglite?.exec(`update outbox set body = '{}' where seq = 3`)
    const before = await dumpAllTables(world.database)
    await checkReplay(world.database.db)
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('표시 없는 재생 오류(지금 코드가 기록 당시와 다르게 처리)도 불일치로 보고한다', async () => {
    const world = await newWorld()
    const { seller, b } = await busy(world)
    void seller
    void b
    // 기록 당시엔 받았지만 지금 코어는 거절하는 이벤트를 흉내: 본문을 바꾸고 요약값도 맞춰 둔다
    const { eventDigest } = await import('../src/writer.ts')
    const pg = world.database.pglite
    const row = (await pg?.query<{ scope_id: string; body: string }>(`select scope_id, body from events where seq = 5`))?.rows[0]
    const body = (row?.body ?? '').replace('"text":"1"', '"text":1')
    await pg?.query(`update events set body = $1, digest = $2 where seq = 5`, [body, eventDigest(row?.scope_id ?? '', 5, 'chat', body, false)])
    const [result] = await checkReplay(world.database.db)
    expect(result?.firstDiff).toEqual({ seq: 5, part: '재생 오류' })
  })
})

describe('검사 명령 (프로세스)', () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  const command = fileURLToPath(new URL('../src/commands/check-replay.ts', import.meta.url))
  const run = (dataDir: string, args: string[] = []) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [command, ...args], { env: { PATH: process.env.PATH, TZ: process.env.TZ, LIVEJJIM_PGLITE_DIR: dataDir }, timeout: 60_000 }, (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr })
      })
    })

  it('일치면 종료 코드 0, 하나라도 다르면 0이 아니고, 출력에 이벤트 내용·개인정보가 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-check-'))
    dirs.push(dir)
    const database = await openPglite(dir)
    const world = startServer(database, generateMasterKey(), { snapshotEvery: 3 })
    await busy(world)
    await database.close()

    const ok = await run(dir)
    expect(ok.code, ok.stderr).toBe(0)
    expect(ok.stdout).toMatch(/· 일치 \(이벤트 8 · 스냅샷 2 · 발송함 4 · 실패 표시 0\)/)
    expect(ok.stdout).toContain('범위 1개 모두 일치해요.')

    const reopened = await openPglite(dir, { migrate: false })
    await reopened.pglite?.exec(`update outbox set body = replace(body, '"confirmVersion":1', '"confirmVersion":2') where seq = 3`)
    await reopened.close()
    const bad = await run(dir)
    expect(bad.code).toBe(1)
    expect(bad.stdout).toMatch(/불일치 — 처음 다른 곳: seq 3 \(발송함\)/)
    for (const secret of ['비밀품종', '닉네임', '010', '4444', '5555', '메모표식', '사유표식', 'UC0', 'PRINT']) {
      expect(bad.stdout + bad.stderr, secret).not.toContain(secret)
    }

    const wrong = await run(dir, ['--date', '2026-13-01'])
    expect(wrong.code).toBe(2)
    const unknown = await run(dir, ['--everything'])
    expect(unknown.code).toBe(2)
  }, 120_000)
})
