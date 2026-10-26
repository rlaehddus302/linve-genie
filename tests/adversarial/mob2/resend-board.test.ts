// MOB2 적대 시험 (test-domain) — AC-MOB2-45 · D-MOB2-07
// 연결이 돌아오면 저절로 다시 보내기(apps/web/src/lib/resend-board.ts ResendBoard).
// 규칙: 다시 이어짐 때 올라온 실패를 차례대로 하나씩 한 번, 보내는 중엔 겹치지 않음(동시에 하나), 또 실패하면 "다음 다시 이어짐 때 한 번 더".
// 공격: 다시 보내는 중에 연결이 또 끊겼다 이어진다(휴대폰 지하·엘리베이터에서 흔함). 앞 항목은 그 사이 다시 실패해 올라와 있다.
//       뒤 회복 알림은 "보내는 중"이라 버려진다 → 연결은 이어졌는데 그 항목은 다음 끊김·회복이 올 때까지 다시 가지 않는다.
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다.
import { describe, expect, it } from 'vitest'

const BOARD_MODULE = '../../../apps/web/src/lib/resend-board.ts'

interface Board {
  add(key: string, kind: 'register' | 'command' | 'sms', run: () => Promise<void>): void
  remove(key: string): void
  has(key: string): boolean
  addHost(run: () => Promise<void>): () => void
  flush(): Promise<void>
  readonly running: boolean
}

const load = async (): Promise<Board> => {
  const { ResendBoard } = (await import(/* @vite-ignore */ BOARD_MODULE)) as { ResendBoard: new () => Board }
  return new ResendBoard()
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('AC-MOB2-45 다시 보내기 보드', () => {
  it('차례: 등록 → 상품 관리 → 방송자 조치 → 문자찜, 하나씩 (앞 응답 뒤 다음)', async () => {
    const board = await load()
    const log: string[] = []
    let inFlight = 0
    const step = (name: string) => async (): Promise<void> => {
      inFlight++
      expect(inFlight).toBe(1)
      log.push(`${name}+`)
      await tick()
      log.push(`${name}-`)
      inFlight--
    }
    board.add('sms', 'sms', step('sms'))
    board.add('cmd', 'command', step('cmd'))
    board.add('reg16', 'register', step('reg16'))
    board.addHost(step('host'))
    board.add('reg15', 'register', step('reg15'))
    await board.flush()
    // 등록은 실패한 차례(16이 먼저 올라왔다)
    expect(log).toEqual(['reg16+', 'reg16-', 'reg15+', 'reg15-', 'cmd+', 'cmd-', 'host+', 'host-', 'sms+', 'sms-'])
  })

  it('짧게 두 번 온 회복 알림 — 같은 항목을 겹쳐 보내지 않는다', async () => {
    const board = await load()
    let calls = 0
    const gate = deferred()
    board.add('reg', 'register', async () => {
      calls++
      await gate.promise
    })
    const first = board.flush()
    const second = board.flush()
    gate.resolve()
    await Promise.all([first, second])
    expect(calls).toBe(1)
  })

  it('TD-MOB2-001: 다시 보내는 중에 또 끊겼다 이어지면, 그 사이 다시 실패한 항목을 연결이 이어진 뒤 한 번 더 보낸다 (뒤 회복 알림을 버리지 않는다)', async () => {
    const board = await load()
    let online = true
    const sent: string[] = []
    const slow = deferred()
    // 15번 등록: 보내는 순간 연결이 다시 끊겨 실패 → 화면이 다시 올린다(ConsolePage가 하는 대로)
    const register = async (): Promise<void> => {
      sent.push(online ? 'reg:ok' : 'reg:fail')
      if (!online) board.add('reg', 'register', register)
    }
    board.add('reg', 'register', register)
    // 문자찜: 느린 응답 (그동안 연결이 이어진다)
    board.add('sms', 'sms', async () => {
      sent.push('sms')
      await slow.promise
    })
    // 회복 #1 — 그런데 곧바로 또 끊긴다
    online = false
    const first = board.flush()
    await tick()
    expect(sent).toEqual(['reg:fail', 'sms'])
    expect(board.has('reg')).toBe(true)
    // 연결이 다시 이어졌다: 회복 #2 (문자찜 응답을 기다리는 중)
    online = true
    const second = board.flush()
    slow.resolve()
    await Promise.all([first, second])
    await tick()
    await tick()
    // 연결은 이어졌는데 15번 등록이 실패 줄로 남으면 판매자는 다음 끊김까지 저절로 보내지는 줄 알고 기다린다
    expect(sent, '회복 #2 뒤 15번 등록을 한 번 더 보내야 한다').toContain('reg:ok')
    expect(board.has('reg')).toBe(false)
  })

  it('보내기 직전에 판매자가 내린 항목(닫음·직접 보냄)은 보내지 않는다', async () => {
    const board = await load()
    const sent: string[] = []
    board.add('reg', 'register', async () => {
      sent.push('reg')
      board.remove('cmd')
    })
    board.add('cmd', 'command', async () => {
      sent.push('cmd')
    })
    await board.flush()
    expect(sent).toEqual(['reg'])
  })

  it('한 항목이 던져도 다음 항목은 보낸다', async () => {
    const board = await load()
    const sent: string[] = []
    board.add('a', 'register', async () => {
      sent.push('a')
      throw new Error('boom')
    })
    board.add('b', 'sms', async () => {
      sent.push('b')
    })
    await board.flush()
    expect(sent).toEqual(['a', 'b'])
    expect(board.running).toBe(false)
  })
})
