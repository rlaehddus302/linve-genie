// AC-S05-91 E2E용 서버 기동: 메모리 PGlite + 마이그레이션, 시험용 마스터 키, 픽스처 계정 하나, 선택 채우기(상품·채팅 실제 범위),
// 방송자 조치 대기 시간 줄이기 신호(GET /api/client-config — 운영 값 5000). 실제 비밀값·네트워크가 필요 없다.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { E2E_ACCOUNT_FILE, E2E_HOST, readE2eAccount, startE2eServer } from '../src/e2e.ts'
import { HOST_ACTION_DELAY_MS } from '../src/server.ts'
import { FAST_COST, addSeller, client, newWorld } from './support.ts'

const ORIGIN = 'http://localhost:5173'

async function loginTo(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, loginId: string, password: string): Promise<string> {
  const response = await app.request('/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
  expect(response.status).toBe(200)
  return /lj_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? ''
}

describe('AC-S05-91 E2E 서버 기동 (프로그램)', () => {
  it('픽스처 계정으로 로그인하고, 채우기를 주면 실제 범위에 방송 하나·상품·채팅이 있다. 방송자 조치 대기 신호를 준다', async () => {
    const e2e = await startE2eServer({ fill: { date: '2026-10-19', products: 20, chats: 300 }, hostActionDelayMs: 300, passwordCost: FAST_COST })
    try {
      const account = readE2eAccount()
      expect(e2e.account).toEqual(account)
      const cookie = await loginTo(e2e.server.app, account.loginId, account.password)
      const get = async (path: string) => (await e2e.server.app.request(path, { headers: { Cookie: cookie } })).json() as Promise<Record<string, unknown>>
      // D-UX3-30: phone·phoneRequired 추가
      expect(await get('/api/me')).toEqual({ seller: { name: account.shopName }, loginId: account.loginId, phone: null, phoneRequired: false })
      expect(e2e.fill).toMatchObject({ date: '2026-10-19', products: 20, chats: 300, seq: 1 + 20 + 300 })
      // Y1: 범위마다 봉인 예정 시각·봉인 여부 (AC-Y1-62). AIY1(RA-AIY1-01): 채우기 채팅은 유튜브 흉내라 출처 youtube로 적혀
      // 봉인 예정이 생긴다 — 방송 날짜 + 30일의 한국 0시(2026-11-18 00:00 KST)
      expect(await get('/api/days')).toEqual({ days: [{ date: '2026-10-19', rehearsal: false, seq: 321, sealAt: '2026-11-17T15:00:00.000Z', sealed: false }] })
      const view = await get('/api/days/2026-10-19')
      expect((view.products as unknown[]).length).toBe(20)
      expect((view.broadcasts as { title: string }[]).map((b) => b.title)).toEqual(['채운 방송'])
      const history = (await get('/api/days/2026-10-19/history?limit=500')).events as { type: string; actor: { kind: string } }[]
      expect(new Set(history.filter((e) => e.type === 'chat').map((e) => e.actor.kind))).toEqual(new Set(['collector']))
      expect(await get('/api/client-config')).toEqual({ hostActionDelayMs: 300, testPrinter: true, billing: { enabled: false, testPayment: false } })
    } finally {
      await e2e.close()
    }
  }, 60_000)

  it('운영 기본값: 방송자 조치 대기 5000밀리초, 줄이는 값은 0~5000만', async () => {
    expect(HOST_ACTION_DELAY_MS).toBe(5000)
    const world = await newWorld()
    const seller = await addSeller(world)
    expect((await client(world, seller.cookie).get('/api/client-config')).body).toEqual({ hostActionDelayMs: 5000, testPrinter: false, billing: { enabled: false, testPayment: false } })
    expect((await client(world, null).get('/api/client-config')).status).toBe(401)
    await expect(newWorld({ hostActionDelayMs: 5001 })).rejects.toThrow(/0~5000/)
    await expect(newWorld({ hostActionDelayMs: -1 })).rejects.toThrow(/0~5000/)
    await expect(newWorld({ generatorSpeed: 0 })).rejects.toThrow(/1~1000/)
    await expect(newWorld({ changesWindow: 0 })).rejects.toThrow(/1 이상/)
  })

  it('픽스처 계정 파일은 저장소에 있는 시험 값이다 (아이디 규칙에 맞는 값)', () => {
    const raw = JSON.parse(readFileSync(E2E_ACCOUNT_FILE, 'utf8')) as Record<string, unknown>
    expect(raw.loginId).toMatch(/^[a-z][a-z0-9_.-]{2,31}$/)
    expect(typeof raw.password === 'string' && raw.password.length >= 8).toBe(true)
  })
})

describe('AC-S06-73 E2E 서버는 127.0.0.1에서만 연다 (RA-S05-006, D-096)', () => {
  /** 그 주소·포트로 TCP 연결이 되는지 */
  const reachable = (host: string, port: number) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ host, port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })

  it('듣는 주소는 127.0.0.1(IPv4 루프백) — 모든 인터페이스(0.0.0.0·::)가 아니고, 이 컴퓨터의 다른 주소로는 닿지 않는다', async () => {
    expect(E2E_HOST).toBe('127.0.0.1')
    const e2e = await startE2eServer({ passwordCost: FAST_COST })
    try {
      const opened = await e2e.listen(0)
      expect(opened.host).toBe('127.0.0.1')
      const address = e2e.http.address()
      expect(typeof address === 'object' && address !== null ? [address.address, address.family] : address).toEqual(['127.0.0.1', 'IPv4'])
      const health = await fetch(`http://127.0.0.1:${String(opened.port)}/api/health`)
      expect(health.status).toBe(200)
      // 루프백이 아닌 이 컴퓨터의 주소(있으면)와 IPv6 루프백으로는 연결되지 않는다
      const others = Object.values(networkInterfaces())
        .flat()
        .filter((info) => info !== undefined && !info.internal && info.family === 'IPv4')
        .map((info) => (info as { address: string }).address)
      for (const host of [...others.slice(0, 3), '::1']) expect(await reachable(host, opened.port), host).toBe(false)
    } finally {
      await e2e.close()
    }
  }, 60_000)

  it('이미 쓰는 포트면 그 오류로 실패한다(열지 않는다)', async () => {
    const first = await startE2eServer({ passwordCost: FAST_COST })
    const second = await startE2eServer({ passwordCost: FAST_COST })
    try {
      const opened = await first.listen(0)
      await expect(second.listen(opened.port)).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(second.http.listening).toBe(false)
    } finally {
      await first.close()
      await second.close()
    }
  }, 60_000)

  it('코드 검사: 기동 명령은 E2E 서버의 listen(127.0.0.1)으로만 포트를 연다', () => {
    const source = readFileSync(new URL('../src/commands/e2e-server.ts', import.meta.url), 'utf8')
    expect(source).toContain('e2e.listen(port)')
    expect(source).not.toMatch(/\.http\.listen\(/)
    expect(source).not.toMatch(/0\.0\.0\.0|'::'/)
  })
})

describe('AC-S05-91 E2E 서버 기동 명령', () => {
  const script = fileURLToPath(new URL('../src/commands/e2e-server.ts', import.meta.url))

  it('빈 포트(--port 0)에 열고 한 줄을 알린다 — 헬스체크·로그인이 되고, 끄면 종료 코드 0. 비밀번호·마스터 키는 출력하지 않는다', async () => {
    const child = spawn(process.execPath, [script, '--port', '0', '--host-delay-ms', '200', '--fill', 'yes', '--fill-products', '5', '--fill-chats', '50'], {
      env: { PATH: process.env.PATH ?? '', TZ: process.env.TZ ?? '' },
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
    try {
      const deadline = Date.now() + 60_000
      while (!/E2E 서버를 시작했어요/.test(out)) {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(`시작하지 않았다: ${out}`)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // 127.0.0.1에서만 연다 (AC-S06-73)
      const port = Number(/http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1])
      expect(port).toBeGreaterThan(0)
      expect(out).toContain('채운 범위')
      expect(out).toContain('방송자 조치 대기 200ms')
      const account = readE2eAccount()
      expect(out).not.toContain(account.password)
      const health = await fetch(`http://127.0.0.1:${String(port)}/api/health`)
      expect(health.status).toBe(200)
      const login = await fetch(`http://127.0.0.1:${String(port)}/api/login`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: account.loginId, password: account.password }),
      })
      expect(login.status).toBe(200)
      const cookie = /lj_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? ''
      const config = await fetch(`http://127.0.0.1:${String(port)}/api/client-config`, { headers: { Cookie: cookie } })
      expect(await config.json()).toEqual({ hostActionDelayMs: 200, testPrinter: true, billing: { enabled: false, testPayment: false } })
    } finally {
      child.kill('SIGTERM')
    }
    expect(await exited).toBe(0)
  }, 90_000)

  it('잘못된 인자는 종료 코드 2와 쉬운 문장', async () => {
    const run = (args: string[]) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(process.execPath, [script, ...args], { env: { PATH: process.env.PATH ?? '' } })
        let out = ''
        child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()))
        child.on('exit', (code) => resolve({ code, out }))
      })
    for (const args of [['--host-delay-ms', '6000'], ['--fill', 'maybe'], ['--port', 'x'], ['--nope', '1'], ['--origin', 'localhost:5173/x']]) {
      const result = await run(args)
      expect(result.code, args.join(' ')).toBe(2)
      expect(result.out).toMatch(/[가-힣]/)
    }
  }, 60_000)
})
