// 두 자리 교대 (D-RETRO-35~37, 복기 E2·E4): 자리 설정 읽기, 자리 상태, 건강 확인(/health·/health/active), 대기로 만든 서버, 뒤 작업만 멈추기,
// 그리고 운영 시작(main.ts)을 진짜 프로세스로 띄워 대기 → 올리기(SIGUSR2) → 넘기기(SIGHUP) → 내리기(SIGTERM)를 본다.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { generateMasterKey } from '../src/secrets.ts'
import type { PGlite } from '@electric-sql/pglite'
import { SMOKE_LOGIN_ID, runSlotSmoke, type SmokeFetch } from '../src/slot-smoke.ts'
import { SlotState, readSlotSetting, takesTraffic, type SlotMode } from '../src/slot.ts'
import { ORIGIN, addSeller, countRows, createBroadcast, expectOk, newWorld, waitFor, writeEvent, type TestServer } from './support.ts'

const COMMIT = '63fb1cf8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5'

describe('자리 설정 읽기 (LIVEJJIM_SLOT · LIVEJJIM_SLOT_FILE · LIVEJJIM_COMMIT)', () => {
  const file = (content: string | null) => (path: string) => {
    if (content === null) throw new Error(`없는 파일 ${path}`)
    return content
  }

  it('자리 이름이 없으면 한 대 구성 — 늘 운영으로 뜬다 (지금까지와 같다)', () => {
    expect(readSlotSetting({}, file(null))).toEqual({ ok: true, slot: null, commit: null, standby: false, notice: null })
    expect(readSlotSetting({ LIVEJJIM_COMMIT: COMMIT }, file(null))).toMatchObject({ ok: true, slot: null, commit: COMMIT, standby: false })
  })

  it('자리 표시 파일이 이 자리를 가리키면 운영, 다른 자리를 가리키면 대기', () => {
    const env = { LIVEJJIM_SLOT: 'a', LIVEJJIM_SLOT_FILE: '/run/livegenie-slot/active', LIVEJJIM_COMMIT: COMMIT }
    expect(readSlotSetting(env, file('a\n'))).toEqual({ ok: true, slot: 'a', commit: COMMIT, standby: false, notice: null })
    expect(readSlotSetting(env, file('b\n'))).toEqual({ ok: true, slot: 'a', commit: COMMIT, standby: true, notice: null })
    expect(readSlotSetting({ ...env, LIVEJJIM_SLOT: 'b' }, file(' b \n'))).toMatchObject({ ok: true, slot: 'b', standby: false })
    // 빈 파일·모르는 이름도 "내 자리가 아님" — 대기
    expect(readSlotSetting(env, file(''))).toMatchObject({ ok: true, standby: true })
    expect(readSlotSetting(env, file('app-a'))).toMatchObject({ ok: true, standby: true })
  })

  it('자리 표시 파일을 못 읽으면 대기로 뜨고 알림 한 줄을 남긴다 — 운영이 둘이 되지 않게', () => {
    const result = readSlotSetting({ LIVEJJIM_SLOT: 'a', LIVEJJIM_SLOT_FILE: '/nowhere/active' }, file(null))
    expect(result).toMatchObject({ ok: true, slot: 'a', standby: true })
    expect(result.ok && result.notice).toBe('자리 표시 파일을 읽지 못해 대기로 떠요.')
  })

  it('반만 적으면 시작하지 않는다 — 값은 문장에 넣지 않는다', () => {
    const onlySlot = readSlotSetting({ LIVEJJIM_SLOT: 'a' }, file('a'))
    expect(onlySlot).toEqual({ ok: false, message: '자리 이름(LIVEJJIM_SLOT)을 적었으면 자리 표시 파일(LIVEJJIM_SLOT_FILE)도 적어 주세요.' })
    const onlyFile = readSlotSetting({ LIVEJJIM_SLOT_FILE: '/secret/place/active' }, file('a'))
    expect(onlyFile).toEqual({ ok: false, message: '자리 표시 파일(LIVEJJIM_SLOT_FILE)을 쓰려면 자리 이름(LIVEJJIM_SLOT)도 적어 주세요.' })
    for (const bad of ['A', '1a', 'a b', 'app/a', 'a'.repeat(17), '../x']) {
      const result = readSlotSetting({ LIVEJJIM_SLOT: bad, LIVEJJIM_SLOT_FILE: '/secret/place/active' }, file('a'))
      expect(result.ok, bad).toBe(false)
      expect(JSON.stringify(result)).not.toContain('secret')
    }
  })

  it('판(커밋)은 모양이 맞을 때만 싣는다 — 틀려도 서버를 막지 않는다', () => {
    for (const bad of ['main', 'v1.2.3', '$(rm -rf /)', 'ABCDEF1', '12345', 'g'.repeat(40)]) {
      expect(readSlotSetting({ LIVEJJIM_COMMIT: bad }, file(null)), bad).toMatchObject({ ok: true, commit: null })
    }
    expect(readSlotSetting({ LIVEJJIM_COMMIT: ' 63fb1cf ' }, file(null))).toMatchObject({ ok: true, commit: '63fb1cf' })
  })
})

describe('자리 상태 — 한 방향으로만: 대기 → 운영 → 넘기는 중 → 내리는 중', () => {
  it('대기에서만 올릴 수 있다', () => {
    const slot = new SlotState({ slot: 'b', commit: COMMIT, standby: true })
    expect(slot.view()).toEqual({ slot: 'b', commit: COMMIT, mode: 'standby' })
    expect(slot.promote()).toBe(true)
    expect(slot.mode).toBe('active')
    expect(slot.promote()).toBe(false)
    expect(slot.mode).toBe('active')
  })

  it('운영에서만 넘길 수 있고, 넘긴 자리·내리는 자리는 다시 올라가지 않는다', () => {
    const slot = new SlotState({ slot: 'a', commit: null, standby: false })
    expect(slot.mode).toBe('active')
    expect(slot.handover()).toBe(true)
    expect(slot.handover()).toBe(false)
    expect(slot.promote()).toBe(false)
    expect(slot.mode).toBe('handover')
    expect(slot.drain()).toBe(true)
    expect(slot.drain()).toBe(false)
    expect(slot.promote()).toBe(false)
    expect(slot.handover()).toBe(false)
    expect(slot.mode).toBe('draining')
  })

  it('대기 자리는 넘길 것이 없다. 바로 내릴 수는 있다', () => {
    const slot = new SlotState({ slot: 'a', commit: null, standby: true })
    expect(slot.handover()).toBe(false)
    expect(slot.mode).toBe('standby')
    expect(slot.drain()).toBe(true)
    expect(slot.mode).toBe('draining')
  })

  it('앞단이 보내도 되는 상태는 운영·넘기는 중뿐이다', () => {
    const expected: Record<SlotMode, boolean> = { standby: false, active: true, handover: true, draining: false }
    for (const [mode, ok] of Object.entries(expected)) expect(takesTraffic(mode as SlotMode), mode).toBe(ok)
  })
})

describe('건강 확인에 자리 이름·판·상태 싣기', () => {
  it('자리 정보를 넘기지 않으면 /health는 그대로이고 /health/active는 없다', async () => {
    const app = createApp()
    expect(await (await app.request('/health')).text()).toBe('{"status":"ok"}')
    expect((await app.request('/health/active')).status).toBe(404)
  })

  it('/health는 어떤 상태든 200이고 자리 이름·판·상태만 더 싣는다 (비밀값 없음)', async () => {
    const slot = new SlotState({ slot: 'b', commit: COMMIT, standby: true })
    const app = createApp({ slot: () => slot.view() })
    const read = async () => {
      const response = await app.request('/health')
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      return (await response.json()) as Record<string, unknown>
    }
    expect(await read()).toEqual({ status: 'ok', slot: 'b', commit: COMMIT, mode: 'standby' })
    slot.promote()
    expect(await read()).toEqual({ status: 'ok', slot: 'b', commit: COMMIT, mode: 'active' })
    slot.handover()
    expect((await read()).mode).toBe('handover')
    slot.drain()
    expect((await read()).mode).toBe('draining')
    expect(Object.keys(await read()).sort()).toEqual(['commit', 'mode', 'slot', 'status'])
  })

  it('/health/active는 운영·넘기는 중에만 200, 대기·내리는 중은 503 — 앞단이 그 자리로 보내지 않는다', async () => {
    const slot = new SlotState({ slot: 'a', commit: null, standby: true })
    const app = createApp({ slot: () => slot.view() })
    const read = async () => {
      const response = await app.request('/health/active')
      return { status: response.status, body: (await response.json()) as unknown }
    }
    expect(await read()).toEqual({ status: 503, body: { status: 'standby' } })
    slot.promote()
    expect(await read()).toEqual({ status: 200, body: { status: 'active' } })
    slot.handover()
    expect(await read()).toEqual({ status: 200, body: { status: 'handover' } })
    slot.drain()
    expect(await read()).toEqual({ status: 503, body: { status: 'draining' } })
    expect((await app.request('/health/active', { method: 'HEAD' })).status).toBe(503)
    const post = await app.request('/health/active', { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })
})

describe('대기로 만든 서버 · 뒤 작업만 멈추기', () => {
  const worlds: TestServer[] = []
  afterEach(() => {
    for (const item of worlds.splice(0)) item.server.close()
  })
  /** 휴대폰 알림 정리(만들 때 바로 걸던 주기 작업)가 걸렸는지 세는 타이머 */
  const countingTimer = () => {
    const calls: number[] = []
    return { calls, timer: { schedule: (ms: number, _fn: () => void) => (calls.push(ms), () => {}) } }
  }

  it('보통 서버는 만들 때 주기 작업을 건다 (지금까지와 같다)', async () => {
    const { calls, timer } = countingTimer()
    worlds.push(await newWorld({ inbox: { sweepTimer: timer } }))
    expect(calls.length).toBe(1)
  })

  it('대기로 만든 서버는 start() 전에는 주기 작업을 걸지 않고, 요청은 받는다', async () => {
    const { calls, timer } = countingTimer()
    const world = await newWorld({ standby: true, inbox: { sweepTimer: timer } })
    worlds.push(world)
    expect(calls.length).toBe(0)
    // 대기 자리에서도 로그인·방송 만들기·기록이 된다 (연습 방송 확인이 이것을 쓴다)
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { rehearsal: true })).id
    await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 1, name: '핑크프릴', price: 10000 }))
    expect(calls.length).toBe(0)
    world.server.start()
    expect(calls.length).toBe(1)
    // 두 번 걸지 않는다
    world.server.start()
    expect(calls.length).toBe(1)
  })

  it('quiesce는 워커가 멈출 때까지 기다리고, 그 뒤에도 요청은 그대로 받는다', async () => {
    const world = await newWorld()
    worlds.push(world)
    const seller = await addSeller(world)
    world.server.start()
    await world.server.quiesce()
    const b = (await createBroadcast(world, seller, { rehearsal: true })).id
    await expectOk(writeEvent(world, seller, { type: 'product.register', b, no: 7, name: '창녹금', price: 5000 }))
    expect((await world.server.app.request('/health')).status).toBe(200)
    // 두 번 불러도 된다 (넘길 때 한 번, 내릴 때 한 번)
    await world.server.quiesce()
  })
})

describe('연습 방송 한 바퀴 (slot-smoke) — 점검용 가게의 리허설 범위만 쓴다', () => {
  const worlds: TestServer[] = []
  afterEach(() => {
    for (const item of worlds.splice(0)) item.server.close()
  })
  const through = (world: TestServer): SmokeFetch => async (path, init) => {
    const response = await world.server.app.request(path, init)
    return { status: response.status, json: () => response.json() as Promise<unknown> }
  }
  const rows = async <T>(world: TestServer, sql: string): Promise<T[]> => (await (world.database.pglite as PGlite).query<T>(sql)).rows

  it('대기 자리에서 방송 만들기 → 상품 등록 → 찜 → 확정 → 끝내기가 돌고, 다른 판매자 기록과 실제 범위는 그대로다', async () => {
    const world = await newWorld({ standby: true })
    worlds.push(world)
    // 진짜 판매자의 실제 방송 하나 (건드리면 안 되는 것)
    const seller = await addSeller(world)
    const real = (await createBroadcast(world, seller)).id
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: real, no: 1, name: '핑크프릴', price: 10000 }))
    const before = await rows<{ n: number }>(world, `select count(*)::int as n from events where seller_id = '${seller.sellerId}'`)
    const sessionsBefore = await countRows(world.database, 'sessions')

    const deps = { db: world.database.db, masterKey: Buffer.from(world.masterKey, 'base64'), origin: ORIGIN, fetch: through(world) }
    const first = await runSlotSmoke(deps)
    expect(first).toEqual({ ok: true, steps: ['점검용 가게', '리허설 방송 만들기', '상품 등록', '시청자 찜', '확정 확인', '방송 끝내기'] })

    // 점검용 가게가 하나 생겼고, 그 가게의 범위는 리허설뿐이다
    const smoke = await rows<{ seller_id: string }>(world, `select seller_id from accounts where login_id = '${SMOKE_LOGIN_ID}'`)
    expect(smoke.length).toBe(1)
    const smokeSeller = smoke[0]?.seller_id ?? ''
    expect(smokeSeller).not.toBe(seller.sellerId)
    expect(await rows(world, `select rehearsal from scopes where seller_id = '${smokeSeller}'`)).toEqual([{ rehearsal: true }])
    // 감사 채팅 같은 바깥으로 나갈 것이 실제 발송 대상으로 남지 않는다 (리허설 표시)
    expect(await rows(world, `select 1 from outbox where seller_id = '${smokeSeller}' and not rehearsal`)).toEqual([])
    // 진짜 판매자의 기록은 한 줄도 바뀌지 않았다
    expect(await rows(world, `select count(*)::int as n from events where seller_id = '${seller.sellerId}'`)).toEqual(before)
    // 쓰고 난 세션은 지운다
    expect(await countRows(world.database, 'sessions')).toBe(sessionsBefore)

    // 다시 돌려도 가게를 또 만들지 않는다
    expect((await runSlotSmoke(deps)).ok).toBe(true)
    expect((await rows(world, `select 1 from accounts where login_id = '${SMOKE_LOGIN_ID}'`)).length).toBe(1)
    expect(await countRows(world.database, 'sessions')).toBe(sessionsBefore)
  })

  it('어느 걸음이든 실패하면 그 걸음과 HTTP 상태·오류 코드만 알리고(값 없음) 세션을 지운다', async () => {
    const world = await newWorld({ standby: true })
    worlds.push(world)
    const real = through(world)
    const broken: SmokeFetch = async (path, init) => {
      if (path.endsWith('/rehearsal/chat')) return { status: 503, json: async () => ({ error: { code: 'UNAVAILABLE', message: '비밀 secret-detail' } }) }
      return real(path, init)
    }
    const result = await runSlotSmoke({ db: world.database.db, masterKey: Buffer.from(world.masterKey, 'base64'), origin: ORIGIN, fetch: broken })
    expect(result).toEqual({ ok: false, step: '시청자 찜', message: 'HTTP 503 UNAVAILABLE', steps: ['점검용 가게', '리허설 방송 만들기', '상품 등록'] })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(await countRows(world.database, 'sessions')).toBe(0)
  })

  it('서버에 닿지 못해도 던지지 않고 실패로 돌려준다', async () => {
    const world = await newWorld({ standby: true })
    worlds.push(world)
    const down: SmokeFetch = async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.9:3000')
    }
    const result = await runSlotSmoke({ db: world.database.db, masterKey: Buffer.from(world.masterKey, 'base64'), origin: ORIGIN, fetch: down })
    expect(result).toMatchObject({ ok: false, step: '리허설 방송 만들기', message: '예상하지 못한 오류가 났어요.' })
    expect(await countRows(world.database, 'sessions')).toBe(0)
  })

  it('앱 주소(Origin)가 다르면 쓰기가 거절돼 통과하지 못한다 — 검사를 돌아가는 길이 아니다', async () => {
    const world = await newWorld({ standby: true })
    worlds.push(world)
    const result = await runSlotSmoke({ db: world.database.db, masterKey: Buffer.from(world.masterKey, 'base64'), origin: 'https://evil.example', fetch: through(world) })
    expect(result).toMatchObject({ ok: false, step: '리허설 방송 만들기', message: 'HTTP 403 FORBIDDEN_ORIGIN' })
  })
})

describe('운영 시작(main)을 프로세스로: 대기 → 올리기 → 넘기기 → 내리기', () => {
  const dirs: string[] = []
  const children: ChildProcess[] = []
  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL')
  })
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createNetServer()
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        probe.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('포트를 얻지 못함'))))
      })
    })

  async function boot(slotName: string, activeName: string | null) {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-slot-'))
    dirs.push(dir)
    const slotFile = join(dir, 'active')
    if (activeName !== null) writeFileSync(slotFile, `${activeName}\n`)
    const port = await freePort()
    const key = generateMasterKey()
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/main.ts', import.meta.url))], {
      env: {
        PATH: process.env['PATH'] ?? '',
        TZ: process.env['TZ'] ?? 'Pacific/Honolulu',
        PORT: String(port),
        LIVEJJIM_MASTER_KEY: key,
        LIVEJJIM_APP_ORIGIN: 'https://shop.example.com',
        LIVEJJIM_PGLITE_DIR: join(dir, 'db'),
        LIVEJJIM_YT_WEB_CHAT: 'off',
        LIVEJJIM_STREAM_AUDIO: 'off',
        LIVEJJIM_SLOT: slotName,
        LIVEJJIM_SLOT_FILE: slotFile,
        LIVEJJIM_COMMIT: COMMIT,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    const base = `http://127.0.0.1:${String(port)}`
    const health = async () => {
      try {
        const response = await fetch(`${base}/health`)
        return (await response.json()) as { status: string; slot: string; commit: string; mode: SlotMode }
      } catch {
        return null
      }
    }
    const activeStatus = async () => {
      try {
        return (await fetch(`${base}/health/active`)).status
      } catch {
        return 0
      }
    }
    await waitFor(async () => (await health()) !== null, 90_000)
    return { child, key, base, health, activeStatus, exited, output: () => out }
  }

  it('다른 자리가 운영이면 대기로 뜨고, SIGUSR2로 올리면 뒤 작업을 시작하고, SIGHUP으로 넘기고, SIGTERM으로 요청을 마저 받고 끝난다', async () => {
    const app = await boot('b', 'a')
    // 대기: 프로세스는 건강(200)하지만 앞단은 보내지 않는다(503). 뒤 작업(자동 백업 확인)은 시작하지 않았다
    expect(await app.health()).toEqual({ status: 'ok', slot: 'b', commit: COMMIT, mode: 'standby' })
    expect(await app.activeStatus()).toBe(503)
    expect(app.output()).toContain('대기 자리로 떴어요.')
    expect(app.output()).not.toContain('BACKUP_DISABLED')

    // 올리기
    app.child.kill('SIGUSR2')
    await waitFor(async () => (await app.health())?.mode === 'active', 20_000)
    expect(await app.activeStatus()).toBe(200)
    // 백업 폴더가 없는 시험 환경 — 뒤 작업을 시작했다는 표시로 이 경고가 처음 남는다
    await waitFor(() => app.output().includes('BACKUP_DISABLED'), 20_000)
    expect(app.output()).toContain('운영으로 올렸어요.')
    // 이미 운영인 자리에 한 번 더 보내도 죽지 않고 그대로다
    app.child.kill('SIGUSR2')
    await waitFor(() => app.output().includes('대기 자리가 아니라 그대로 둬요.'), 20_000)
    expect((await app.health())?.mode).toBe('active')

    // 넘기기: 뒤 작업만 멈춘다. 앞단은 계속 보낸다(200)
    app.child.kill('SIGHUP')
    await waitFor(async () => (await app.health())?.mode === 'handover', 20_000)
    expect(await app.activeStatus()).toBe(200)

    // 내리기: 곧바로 503(앞단이 뺀다)이지만 요청은 잠깐 더 받는다
    const downAt = Date.now()
    app.child.kill('SIGTERM')
    await waitFor(async () => (await app.activeStatus()) === 503, 5000)
    expect((await app.health())?.mode).toBe('draining')
    expect(Date.now() - downAt).toBeLessThan(3500)
    const code = await app.exited
    expect(code).toBe(0)
    // 앞단이 알아챌 시간(4초)은 버틴다
    expect(Date.now() - downAt).toBeGreaterThanOrEqual(3900)
    expect(app.output()).toContain('껐어요.')
    // 기동·종료 기록에 비밀값이 없다
    expect(app.output()).not.toContain(app.key)
  }, 180_000)

  it('자리 표시 파일이 이 자리를 가리키면 바로 운영으로 뜬다 — 죽었다 살아나도 대기가 되지 않는다', async () => {
    const app = await boot('a', 'a')
    expect(await app.health()).toEqual({ status: 'ok', slot: 'a', commit: COMMIT, mode: 'active' })
    expect(await app.activeStatus()).toBe(200)
    expect(app.output()).not.toContain('대기 자리로 떴어요.')
    // 넘기지 않고 바로 내려도 뒤 작업을 멈춘 뒤 끝난다
    app.child.kill('SIGTERM')
    expect(await app.exited).toBe(0)
  }, 180_000)

  it('자리 표시 파일이 없으면 대기로 뜬다', async () => {
    const app = await boot('a', null)
    expect((await app.health())?.mode).toBe('standby')
    expect(app.output()).toContain('자리 표시 파일을 읽지 못해 대기로 떠요.')
    app.child.kill('SIGTERM')
    expect(await app.exited).toBe(0)
  }, 180_000)
})
