// N5 합친 뒤 회귀: PGlite를 진행 중인 쿼리 한가운데서 닫으면 WASM 안에서 끝없이 돌아 이벤트 루프가 멈췄다.
// (서버 close() 직후 DB를 닫을 때 출력 알림의 대기열 개수 조회가 아직 돌던 경우 — tests/adversarial/i1/print-attacks.test.ts 로그 시험이 멈춤)
// 멈추면 이 시험 프로세스도 같이 멈추므로, 자식 프로세스에서 돌리고 시간 제한으로 잰다.
// 열 때마다 initdb를 다시 돌리면(한 번 0.4초 남짓) 12번 여는 데 시간이 거의 다 들어, 부하가 큰 전체 검증에서 닫기와 상관없이
// 시간 제한을 넘었다. 그래서 한 번 만든 빈 DB를 복제해 연다(시험 지원의 openTestDb와 같은 방법). 닫기 경합은 DB 내용과 상관없다.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DATABASE = new URL('../src/db/database.ts', import.meta.url).href

const SCRIPT = `
import { PGlite } from '@electric-sql/pglite'
import { openPglite } from ${JSON.stringify(DATABASE)}
const template = await PGlite.create()
let ok = 0
let rejected = 0
for (let ticks = 0; ticks < 12; ticks++) {
  const database = await openPglite(await template.clone(), { migrate: false })
  await database.pglite.query('select 1')
  const pending = [
    database.pglite.query('select count(*) filter (where x > $1)::int as n from generate_series(1, 10) x', [3]),
    database.pglite.transaction(async (tx) => {
      await tx.query('select 1')
      await tx.query('select 2')
    }),
  ]
  for (let i = 0; i < ticks; i++) await Promise.resolve()
  await database.close()
  await database.close()
  for (const r of await Promise.allSettled(pending)) r.status === 'fulfilled' ? ok++ : rejected++
}
await template.close()
process.stdout.write(JSON.stringify({ done: true, ok, rejected }))
`

describe('PGlite 닫기 (openPglite().close)', () => {
  it('진행 중인 쿼리·트랜잭션이 있어도 멈추지 않고 닫힌다 — 진행 중인 것은 끝나거나 오류로 끝난다', () => {
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
    })
    expect(res.signal, `닫기가 멈춤 (stderr: ${res.stderr.slice(0, 500)})`).toBeNull()
    expect(res.status, res.stderr.slice(0, 500)).toBe(0)
    const out = JSON.parse(res.stdout) as { done: boolean; ok: number; rejected: number }
    expect(out.done).toBe(true)
    expect(out.ok + out.rejected).toBe(24)
  }, 90_000)
})
