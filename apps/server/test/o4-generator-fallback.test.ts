// AC-O4-37 옵션 생성기의 마지막 대체 글도 인식 함수로 확인한다 (YT-09, D-O4-01, D-O4-12 — SA-O4-04).
// 언급 후보가 모두 언급으로 읽히지 않는 상태를 만들려고 코어 parseOptionComment를 "모든 글이 주문으로 읽힘"으로 바꿔 둔다
// (시험에서만 — 실제 코어는 질문 글을 주문으로 읽지 않는다). 그때 생성기가 확인 없이 `mention`으로 표시한 글이 없어야 한다.
import type * as core from '@livejjim/core'
import { applyEvent, initEngine, type EngineEvent, type EngineState, type OptionCommentResult } from '@livejjim/core'
import { describe, expect, it, vi } from 'vitest'
import { ChatMaker, generatorView, type GeneratorView, type MessageKind } from '../src/generator.ts'

const flags = vi.hoisted(() => ({ everythingOrders: false, calls: [] as string[] }))

vi.mock('@livejjim/core', async (importOriginal) => {
  const real = await importOriginal<typeof core>()
  return {
    ...real,
    parseOptionComment: (...args: Parameters<typeof real.parseOptionComment>): OptionCommentResult => {
      flags.calls.push(String(args[0]))
      if (!flags.everythingOrders) return real.parseOptionComment(...args)
      return { orders: [{ no: 999, qty: 1 }], cancels: [], mentions: [], review: null } as unknown as OptionCommentResult
    },
  }
})

const DAY = '2026-10-28'
const AT = Date.UTC(2026, 9, 28, 11, 0, 0)
const SHORTS = { type: 'product.register', no: 21, name: '반바지', price: 10000, stocks: { M: 1, L: 2 }, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] }

function optionState(): { state: EngineState; seq: number } {
  let state = initEngine({ broadcasts: [], settings: {} })
  let seq = 0
  const apply = (event: Record<string, unknown>) => {
    state = applyEvent(state, { ...event, seq: ++seq, at: AT + seq * 1000 } as unknown as EngineEvent).state
  }
  apply({ type: 'broadcast.start', b: 'b1', date: DAY, title: '의류 리허설', settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } })
  apply({ ...SHORTS, b: 'b1' })
  return { state, seq }
}

function kindsOf(seed: number, n: number): Map<MessageKind, string[]> {
  const { state } = optionState()
  const view = generatorView(state, 'b1') as GeneratorView
  const maker = new ChatMaker('b1', seed, 0)
  const out = new Map<MessageKind, string[]>()
  for (let i = 0; i < n; i++) {
    const made = maker.next(view)
    out.set(made.kind, [...(out.get(made.kind) ?? []), made.chat.text])
  }
  return out
}

describe('AC-O4-37 언급 대체 글 확인 (D-O4-12)', () => {
  for (const seed of [1, 42, 9_001]) {
    it(`시드 ${String(seed)}: 후보도 대체 글도 언급으로 읽히지 않으면 일반 대화 — mention 표시가 없다`, () => {
      flags.everythingOrders = true
      flags.calls.length = 0
      try {
        const kinds = kindsOf(seed, 400)
        expect(kinds.get('mention') ?? []).toEqual([])
        expect((kinds.get('talk') ?? []).length).toBeGreaterThan(0)
        // 대체 글을 실제로 인식 함수에 넣어 보았다 (확인 없이 지나가지 않았다)
        expect(flags.calls).toContain('몇 개 남았나요?')
      } finally {
        flags.everythingOrders = false
      }
    })
  }

  it('평소(실제 인식 함수)에는 언급이 그대로 나온다', () => {
    const kinds = kindsOf(42, 400)
    expect((kinds.get('mention') ?? []).length).toBeGreaterThan(0)
  })
})
