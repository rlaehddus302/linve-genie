// V3 적대 시험 (test-domain, 위험 감사 RA-V3-001~004, D-V3-58·65·75, R-24·R-25): 실제 음성 모듈 + 실제 콘솔 음성 컨트롤러 + 가짜 인식 객체 + 가짜 시계로
// 단위 수준에서 공격한다. 화면 파일은 DOM 타입이라 경로를 값으로 불러온다(i4/voice-controller-auto.test.ts와 같은 까닭).
// 노리는 것: 번호를 옮긴 뒤 새 번호에 찜이 생겼는데 되돌려 찜을 끝냄(RA-001), 옮기기 직전 찜이 생겼는데 옮김, 덩어리 안 취소가 다른 상품을 되돌림(RA-002),
// 가격 되돌리기가 그사이 생긴 입금 전 찜을 새 가격에 둠(RA-003), 서버로 가는 들은 말이 덩어리 전체·한글 전화번호를 실음(RA-004, D-V3-75).
import * as voiceModule from '@livejjim/voice'
import { maskArchiveText } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 화면처럼 같은 상품 이름 목록을 돌려준다(ConsolePage useMemo — 상품이 바뀔 때만 새 목록). 부를 때마다 새 목록이면 컨트롤러가 사전을
// 매번 다시 만든다(#prepared는 목록이 같을 때만 다시 씀) — 사전이 1,082개로 커진 뒤(D-V3-115) 시험이 느려진 틀 문제. 단언은 그대로.
const NO_NAMES: readonly string[] = []

// SRV1(D-APP-22·23, AC-SRV1-15): 음성 읽기 컨트롤러는 웹에서 서버 음성 흐름(packages/voice-session, server.ts createReadingSession)으로 옮겼다 — 같은 사례를 지금 제품 경로에서 본다.
const CONTROLLER_MODULE = '../../../packages/voice-session/src/controller/controller.ts'
const VOICE_LOG_MODULE = '../../../apps/server/src/voice-log.ts'
const T0 = Date.UTC(2026, 9, 25, 1, 0, 0)

class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {}
  say(text: string): void {
    this.results.push({ isFinal: true, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
  }
}

interface View {
  key: string
  name: string
  price: number
  claimCount: number
  closed: boolean
  status?: string
}
interface Offer {
  id: string
  stage: string
  message: string
  renumber?: { from: number; to: number }
}
interface Controller {
  turnOn(): Promise<void>
  noteVoiceRegistered(entry: { id: string; no: number; name: string; price: number }): void
  getSnapshot(): { offers: readonly Offer[]; readout: { text: string } | null }
  revertOffer(id: string): Promise<void>
  voiceLogFor(text: string, undo?: string): { heard: string } | null
}

async function harness() {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: new (host: unknown) => Controller }
  const board = new Map<number, View>()
  const registered: { no: number; name: string; price: number; text: string }[] = []
  const fixes: { id: string; changes: { price?: number; name?: string }; options: Record<string, unknown> }[] = []
  const renumbers: { from: number; to: number }[] = []
  const undone: string[] = []
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => 'WON',
    currentNames: () => NO_NAMES,
    products: () => new Map([...board].map(([no, p]) => [no, p.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: (card: { text: string }, registration: { no: number; name: string; price: number }) => {
      registered.push({ ...registration, text: card.text })
    },
    focusQuick: () => {},
    fixRecent: async (id: string, changes: { price?: number; name?: string }, options: Record<string, unknown> = {}) => {
      fixes.push({ id, changes, options })
      const p = [...board.values()].find((item) => item.key === id)
      return { kind: 'fixed', before: changes.price !== undefined ? { price: p?.price ?? 0 } : {} }
    },
    renumber: async (from: number, to: number) => {
      renumbers.push({ from, to })
      const p = board.get(from)
      if (p === undefined) return false
      board.delete(from)
      board.set(to, { ...p, key: `b1:${String(to)}` })
      return true
    },
    undoRecent: (key: string) => {
      undone.push(key)
      return true
    },
    existingProduct: (no: number) => board.get(no) ?? null,
  }
  const voice = new VoiceController(host)
  await voice.turnOn()
  await settle()
  const recognition = FakeRecognition.all.at(-1) as FakeRecognition
  /** 바로 등록된 마지막 것을 보드에 올리고 컨트롤러에 알린다 (화면이 등록 응답을 받은 때) */
  const land = (claims = 0): void => {
    const sent = registered.at(-1)
    if (sent === undefined) throw new Error('등록이 없다')
    const key = `b1:${String(sent.no)}`
    board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount: 0, closed: false, status: 'OPEN' })
    voice.noteVoiceRegistered({ id: key, no: sent.no, name: sent.name, price: sent.price })
    board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount: claims, closed: false, status: 'OPEN' })
  }
  return { voice, board, registered, fixes, renumbers, undone, land, say: (text: string) => recognition.say(text) }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const at = async (ms: number): Promise<void> => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 - 5000 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RA-V3-001 번호 옮기기와 찜 (R-24, D-V3-58)', () => {
  it('"아까 65번은 61번이에요"로 옮긴 뒤 61번에 찜이 생기면 [되돌리기]는 번호를 다시 옮기지 않는다 (옮기면 그 찜이 RENUMBERED로 끝난다)', async () => {
    const h = await harness()
    h.board.set(65, { key: 'b1:65', name: '라울', price: 30_000, claimCount: 0, closed: false, status: 'OPEN' })
    await at(0)
    h.say('아까 65번은 61번이에요')
    await at(2000)
    expect(h.renumbers).toEqual([{ from: 65, to: 61 }])
    const offer = h.voice.getSnapshot().offers.find((item) => item.renumber !== undefined)
    expect(offer?.renumber).toEqual({ from: 65, to: 61 })
    // 옮긴 뒤 61번에 찜
    const moved = h.board.get(61) as View
    h.board.set(61, { ...moved, claimCount: 1 })
    await h.voice.revertOffer(offer?.id ?? '')
    await settle()
    expect(h.renumbers).toEqual([{ from: 65, to: 61 }])
    expect(h.board.has(61)).toBe(true)
    expect(h.board.has(65)).toBe(false)
  })

  it('찜이 있는 65번은 옮기지 않는다', async () => {
    const h = await harness()
    h.board.set(65, { key: 'b1:65', name: '라울', price: 30_000, claimCount: 2, closed: false, status: 'OPEN' })
    await at(0)
    h.say('아까 65번은 61번이에요')
    await at(2000)
    expect(h.renumbers).toEqual([])
  })

  it('옮기기를 정한 뒤 보내기 직전에 찜이 생기면 옮기지 않는다 (보내기 직전에 다시 봄)', async () => {
    const h = await harness()
    h.board.set(65, { key: 'b1:65', name: '라울', price: 30_000, claimCount: 0, closed: false, status: 'OPEN' })
    await at(0)
    h.say('아까 65번은 61번이에요')
    // 조용한 시간이 지나 덩어리를 읽는 바로 그 틱에서 찜이 생긴 것처럼: 덩어리 끝 직전에 찜을 단다
    vi.advanceTimersByTime(1_799)
    h.board.set(65, { key: 'b1:65', name: '라울', price: 30_000, claimCount: 0, closed: false, status: 'OPEN' })
    vi.advanceTimersByTime(1)
    h.board.set(65, { key: 'b1:65', name: '라울', price: 30_000, claimCount: 1, closed: false, status: 'OPEN' })
    await settle()
    await at(4000)
    expect(h.renumbers).toEqual([])
  })

  it('이미 있는 61번으로는 옮기지 않는다', async () => {
    const h = await harness()
    h.board.set(65, { key: 'b1:65', name: '라울', price: 30_000, claimCount: 0, closed: false, status: 'OPEN' })
    h.board.set(61, { key: 'b1:61', name: 'bts', price: 10_000, claimCount: 0, closed: false, status: 'OPEN' })
    await at(0)
    h.say('아까 65번은 61번이에요')
    await at(2000)
    expect(h.renumbers).toEqual([])
  })
})

describe('RA-V3-002 덩어리 안 취소는 그 상품만 되돌린다 (D-V3-21)', () => {
  it('21번 등록 뒤 다음 덩어리 "22번 라울 만원 취소" → 되돌리는 것은 22번 키뿐, 21번은 그대로', async () => {
    const h = await harness()
    await at(0)
    h.say('21번 핑크문 만원')
    await at(2000)
    h.land()
    await at(4000)
    h.say('22번 라울 만원 취소')
    await at(6000)
    h.land()
    await at(9000)
    expect(h.registered.map((r) => r.no)).toEqual([21, 22])
    expect(h.undone.every((key) => key === 'b1:22')).toBe(true)
    expect(h.undone).not.toContain('b1:21')
  })
})

describe('RA-V3-003 가격 되돌리기는 입금 전 찜도 원래 가격으로', () => {
  it('음성으로 바로 고친 가격을 [되돌리기]하면 product.update의 applyTo가 UNPAID_CLAIMS', async () => {
    const h = await harness()
    h.board.set(38, { key: 'b1:38', name: '라울', price: 100_000, claimCount: 0, closed: false, status: 'OPEN' })
    await at(0)
    // 같은 번호 가격 고침 문턱(price-gate.ts — 결정 변경): 다른 가격은 정정 낱말이 있어야 바로 고친다
    h.say('38번 라울 잘못 말했어요 50만 원')
    await at(2000)
    expect(h.fixes.map((f) => [f.id, f.changes])).toEqual([['b1:38', { price: 500_000 }]])
    const offer = h.voice.getSnapshot().offers.find((item) => item.stage === 'fixed')
    expect(offer).toBeDefined()
    await h.voice.revertOffer(offer?.id ?? '')
    await settle()
    expect(h.fixes.length).toBe(2)
    expect(h.fixes[1]?.changes).toEqual({ price: 100_000 })
    expect(h.fixes[1]?.options['applyTo']).toBe('UNPAID_CLAIMS')
  })
})

describe('RA-V3-004 서버로 가는 들은 말 (voiceLog.heard, D-V3-65·75)', () => {
  it('한 덩어리에 이어 말한 두 상품: 각 등록의 들은 말은 그 조각 글뿐(앞 상품 말이 다음 상품 기록에 실리지 않는다)', async () => {
    const h = await harness()
    await at(0)
    h.say('93번 라울 7만 원 97번 23만 원')
    await at(2000)
    expect(h.registered.map((r) => r.no)).toEqual([93, 97])
    const heard = h.registered.map((r) => h.voice.voiceLogFor(r.text)?.heard)
    expect(heard[1]).not.toContain('93번')
    expect(heard[0]).not.toContain('97번')
  })

  it('들은 말의 한글 수 전화번호·끝자리는 가려서 보낸다', async () => {
    const h = await harness()
    await at(0)
    h.say('15번 라울 만 원 공일공 일이삼사 오육칠팔 끝자리 일이삼사')
    await at(2000)
    const sent = h.registered[0]
    expect(sent?.no).toBe(15)
    const heard = h.voice.voiceLogFor(sent?.text ?? '')?.heard ?? ''
    expect(heard).not.toMatch(/공일공|오육칠팔|일이삼사/)
  })
})

describe('D-V3-75 가리기 — 기기(maskArchiveText)와 서버(maskHeard) 두 겹', () => {
  const CASES: readonly (readonly [string, string])[] = [
    ['공일공 일이삼사 오육칠팔 김민지님', '**** 김민지님'],
    ['공일공일이삼사오육칠팔', '****'],
    ['끝자리 일이삼사 김민지님', '끝자리 **** 김민지님'],
    ['끝번호는 일 이 삼 사', '끝번호는 ****'],
    ['뒷 번호 오육칠팔이요', '뒷 번호 ****이요'],
    ['15번 라울 만 원', '15번 라울 만 원'],
    ['일육팔 삼광색금 이십오만 원', '일육팔 삼광색금 이십오만 원'], // 자리 일곱 이하는 그대로
  ]
  it.each(CASES)('기기: "%s" → "%s"', (text, want) => {
    expect(maskArchiveText(text)).toBe(want)
  })
  // TD-V3-010 (minor): D-V3-75 "자리 글자가 공백을 사이에 두어도 8개 이상 이어지면 전부" — 자리 글자는 R-17 3대로 한글 한 글자·숫자 한 개 둘 다다.
  // 한글과 숫자가 섞인 "영일영 1234 5678"은 숫자 쪽만 가려 "영일영 ****"가 남는다(전화번호 앞자리).
  it('TD-V3-010: 한글·숫자가 섞인 자리 11개 "영일영 1234 5678" → 전부 "****"', () => {
    expect(maskArchiveText('영일영 1234 5678')).toBe('****')
  })
  it.each(CASES)('서버: "%s" → 전화번호·끝자리가 남지 않는다', async (text, want) => {
    const { maskHeard } = (await import(/* @vite-ignore */ VOICE_LOG_MODULE)) as { maskHeard: (text: string) => string }
    const out = maskHeard(text)
    if (want.includes('****')) expect(out).toContain('****')
    expect(out.replace(/[^0-9공영일이삼사오육칠팔구]/g, '').length).toBeLessThan(want.includes('****') ? 8 : 99)
  })
})
