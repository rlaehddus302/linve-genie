// PL1A AC-PL1A-02 봉인 범위는 재생하지 않고 검사한다 (D-PL1-01) — 엔진 재생 함수(applyEvent)를 감시해 봉인 범위의 이벤트가 엔진에 들어가지 않는지 본다
import { rmSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as core from '@livejjim/core'
import { checkBackupBytes, type BackupFile } from '../src/backup.ts'
import { checkReplay } from '../src/check-replay.ts'
import { A, AFTER_SEAL, B, scenario, sealA, tempDirs } from './pl1a-support.ts'
import { getFile } from './i2-support.ts'

vi.mock('@livejjim/core', async (importOriginal) => {
  const actual = await importOriginal<typeof core>()
  return { ...actual, applyEvent: vi.fn(actual.applyEvent) }
})

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AC-PL1A-02 봉인 범위는 재생하지 않고 검사한다', () => {
  it('검사 통과 — A는 봉인 표시·이벤트 수·스냅샷 0·발송함 0, A의 이벤트는 엔진에 넣지 않는다. B·리허설은 재생. 재생 검사 명령과 판정이 같다', async () => {
    const s = await scenario()
    s.world.clock.set(AFTER_SEAL)
    await sealA(s.world)
    const response = await getFile(s.world, s.seller.cookie, '/api/export/records.json.gz')
    const file = JSON.parse(gunzipSync(response.bytes).toString('utf8')) as BackupFile
    const aBodies = new Set(file.scopes.filter((scope) => scope.date === A && !scope.rehearsal).flatMap((scope) => scope.events.map((event) => event.body)))
    const replayed = file.scopes.filter((scope) => scope.sealed === null).reduce((sum, scope) => sum + scope.events.filter((event) => !event.failed).length, 0)
    const spy = vi.mocked(core.applyEvent)
    spy.mockClear()
    const checked = await checkBackupBytes(response.bytes)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    // 엔진은 봉인 안 한 범위의 이벤트만 받았다 (A의 본문으로 불린 적 0번)
    expect(spy.mock.calls.length).toBe(replayed)
    expect(spy.mock.calls.filter(([, event]) => aBodies.has(JSON.stringify(event))).length).toBe(0)
    const summary = checked.value.file.scopes.map(({ date, rehearsal, events, sealed, snapshots, outbox }) => ({ date, rehearsal, events, sealed, snapshots, outbox }))
    const aCount = file.scopes.find((scope) => scope.date === A)?.events.length
    expect(summary[0]).toEqual({ date: A, rehearsal: false, events: aCount, sealed: true, snapshots: 0, outbox: 0 })
    expect(summary.slice(1).map(({ date, rehearsal, sealed, snapshots }) => [date, rehearsal, sealed, snapshots])).toEqual([
      [B, false, false, 1],
      [B, true, false, 1],
    ])
    // 재생 검사 명령도 A를 장부 요약값으로 (요금 대조 없음) — 같은 판정
    const checks = await checkReplay(s.world.database.db, { sellerId: s.seller.sellerId })
    expect(checks.map((check) => [check.date, check.rehearsal, check.ok, check.sealed, check.events])).toEqual([
      [A, false, true, true, aCount],
      [B, false, true, false, file.scopes[1]?.events.length],
      [B, true, true, false, file.scopes[2]?.events.length],
    ])
  })
})
