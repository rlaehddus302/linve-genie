// 입금 확인 낱말·CSV 글 읽기·확인 필요 수 신호 (N3 — DP-8, AC-N3-30·40·41·42·44·45·47·50).
import { describe, expect, it, vi } from 'vitest'
import type { BundleView, DepositLinkView } from '../src/api/deposit-types.ts'
import { decodeCsv, readCsvFile } from '../src/lib/csv-text.ts'
import { DepositStore } from '../src/lib/deposit-store.ts'
import {
  DEPOSIT_STATUS_WORD,
  PASTE_STATE_WORD,
  SOURCE_KIND_WORD,
  UNREADABLE_WORD,
  bankName,
  bundleChange,
  confirmLine,
  depositActionWord,
  depositActorWord,
  depositLinkWords,
  depositName,
  depositTime,
  pasteResultWords,
  reasonWords,
  revertQuestion,
  sourceWords,
} from '../src/lib/deposit-words.ts'
import { actorWord } from '../src/lib/words.ts'
import { FakeEventSource, FakeServer, flush } from './support.ts'

const bundle = (patch: Partial<BundleView> = {}): BundleView => ({
  date: '2026-10-18',
  buyer: 'UC_A',
  name: '다육이맘',
  total: 14000,
  received: 0,
  remaining: 14000,
  payment: 'UNPAID',
  refundDue: 0,
  after: { payment: 'PAID', received: 14000, refundDue: 0 },
  beforeSale: false,
  canRemember: false,
  ...patch,
})

describe('DP-8 낱말 (AC-N3-41·50)', () => {
  it('상태·원천·사유 문장은 규칙서 그대로', () => {
    expect(Object.values(DEPOSIT_STATUS_WORD)).toEqual(['확인 필요', '자동 확인됨', '확인함', '무시함'])
    // SMS3: 원천 "휴대폰 알림"(DP-8 원천 줄 v0.1.1)
    expect(SOURCE_KIND_WORD).toEqual({ POPBILL: '계좌조회', PASTE: '붙여넣기', FAKE: '시험용 입금', PHONE: '휴대폰 알림' })
    expect(reasonWords('POSSIBLE_DUPLICATE', 7)).toBe('같은 입금이 두 번 들어왔을 수 있어요 (입금 번호 7도 같은 입금이에요)') // MOB2 D-MOB2-05 + QL3R2 D-QL3R2-04 (D-QL3R1-10 (3))
    expect(reasonWords('SAME_NAME', null)).toBe('같은 이름의 구매자가 여럿이에요')
    expect(reasonWords('MULTIPLE', null)).toBe('금액과 이름이 맞는 묶음이 여럿이에요')
    expect(reasonWords('NAME_MISMATCH', null)).toBe('금액은 맞는데 이름이 달라요')
    expect(reasonWords('AMOUNT_MISMATCH', null)).toBe('이름은 맞는데 금액이 달라요')
    expect(reasonWords('NO_MATCH', null)).toBe('맞는 묶음을 찾지 못했어요')
    expect(reasonWords('ONE_MATCH', null)).toBe('맞는 묶음이 하나 있어요. 확인해 주세요')
    // SMS3 (DP-8 v0.1.1, AC-SMS3-32)
    expect(reasonWords('UNTRUSTED_SOURCE', null)).toBe('은행 앱이나 은행 대표번호가 아닌 곳에서 온 입금 알림이에요. 은행 앱에서 꼭 확인해 주세요')
    // DP-8 BALANCE_GAP 문구 넓힘 — 잔액 없음·앞선 잔액 없음·이어지지 않음 모두 (D-DEP2-13)
    expect(reasonWords('BALANCE_GAP', null)).toBe('잔액이 앞 알림과 이어지는지 확인하지 못했어요. 은행 앱에서 확인해 주세요')
    expect(sourceWords({ kind: 'PHONE', label: '휴대폰 알림' })).toBe('휴대폰 알림')
  })

  it('원천 표시: 종류 낱말, 표시 이름이 다르면 함께', () => {
    expect(sourceWords({ kind: 'FAKE', label: '시험용 입금' })).toBe('시험용 입금')
    expect(sourceWords({ kind: 'POPBILL', label: '국민 1234' })).toBe('계좌조회 · 국민 1234')
    expect(sourceWords({ kind: 'PASTE', label: '붙여넣기' })).toBe('붙여넣기')
    expect(bankName('0004')).toBe('국민은행')
    expect(bankName('9999')).toBe('은행 코드 9999')
  })

  it('빈 입금자명은 "(이름 없음)", 이름은 글자 그대로', () => {
    expect(depositName('')).toBe('(이름 없음)')
    expect(depositName('  ')).toBe('(이름 없음)')
    expect(depositName('=1+2')).toBe('=1+2')
  })

  it('입금 시각은 KST — 초까지 받은 입금은 초까지, 분까지면 분까지 (실행 환경 시간대와 상관없다)', () => {
    expect(depositTime('2026-10-18T12:03:15.000Z', 'second')).toBe('10/18 21:03:15')
    expect(depositTime('2026-10-18T12:03:00.000Z', 'minute')).toBe('10/18 21:03')
    expect(depositTime('2026-10-18T21:03:00+09:00', 'minute')).toBe('10/18 21:03')
  })

  it('바뀔 입금 상태와 과입금 주의', () => {
    expect(bundleChange(bundle())).toEqual({ text: '미입금 → 입금 완료', warning: false })
    expect(bundleChange(bundle({ payment: 'PAID', received: 14000, remaining: 0, after: { payment: 'OVERPAID', received: 28000, refundDue: 14000 } }))).toEqual({
      text: '입금 완료 → 과입금(환불 필요 14,000원)',
      warning: true,
    })
    expect(bundleChange(bundle({ after: null }))).toBeNull()
  })

  it('확정 창의 줄 (AC-N3-42)', () => {
    expect(confirmLine(bundle(), 14000)).toBe('다육이맘 · 2026년 10월 18일 묶음 · 14,000원 입금 · 미입금 → 입금 완료')
  })

  it('되돌리기 확인 문장 (AC-N3-44)', () => {
    expect(revertQuestion('다육이맘', '2026-10-18', 14000)).toBe('다육이맘 · 10월 18일 묶음에 적은 14,000원 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.')
  })

  it('붙여넣기 낱말과 결과 문장 (AC-N3-45)', () => {
    expect(Object.values(PASTE_STATE_WORD)).toEqual(['새 입금', '이미 있는 입금', '오래된 입금', '시각이 지금보다 늦은 입금']) // QL3R2 D-QL3R2-04
    expect(UNREADABLE_WORD).toEqual({ BAD_AMOUNT: '금액을 읽지 못했어요', BAD_TIME: '시각을 읽지 못했어요(분까지 필요해요)' })
    expect(pasteResultWords({ new: 5, auto: 3, review: 2, existing: 1 })).toBe('새 입금 5건 — 자동 확인 3건, 확인 필요 2건 (이미 있던 입금 1건)')
  })

  it('정산 기록의 입금 연결 (AC-N3-47)', () => {
    const link = (patch: Partial<DepositLinkView> = {}): DepositLinkView => ({
      seq: 9,
      kind: 'payment',
      auto: true,
      reverted: false,
      deposit: { no: 12, name: '김영희', at: '2026-10-18T12:03:00.000Z', precision: 'minute', amount: 14000, source: '국민 1234', sourceKind: 'POPBILL' },
      ...patch,
    })
    expect(depositLinkWords(link())).toBe('자동 입금 확인 · 김영희 · 10/18 21:03 · 입금 번호 12') // MOB2 D-MOB2-05
    expect(depositLinkWords(link({ auto: false }))).toBe('입금 내역으로 확인 · 김영희 · 10/18 21:03 · 입금 번호 12') // MOB2 D-MOB2-05
    expect(depositLinkWords(link({ reverted: true }))).toBe('자동 입금 확인 · 김영희 · 10/18 21:03 · 입금 번호 12 · 되돌림') // MOB2 D-MOB2-05
    expect(depositLinkWords(link({ kind: 'refund' }))).toBe('입금 확인 되돌림 · 입금 번호 12') // MOB2 D-MOB2-05
  })

  it('처리 기록의 낱말과 "누가" — 자동은 "입금 자동 확인", 범위 이력의 actor deposit도 같은 낱말', () => {
    expect(['RECEIVED', 'AUTO', 'CONFIRM', 'IGNORE', 'REOPEN', 'REVERT'].map(depositActionWord)).toEqual(['받음', '자동 확인', '확정', '무시', '다시 확인 필요로', '되돌리기'])
    expect(depositActorWord({ kind: 'auto', loginId: null })).toBe('입금 자동 확인')
    expect(depositActorWord({ kind: 'account', loginId: 'shop1' })).toBe('shop1')
    expect(actorWord({ kind: 'deposit', loginId: null })).toBe('입금 자동 확인')
  })
})

describe('CSV 글 읽기 (AC-N3-45, D-N3-08)', () => {
  const EUC_KR = 'b0c5b7a1c0cfbdc32cc0d4b1ddbed72cc0d4b1ddc0dab8ed0a323032362d31302d31382032313a30332c31343030302cb1e8bfb5c8f10a'
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  const TEXT = '거래일시,입금액,입금자명\n2026-10-18 21:03,14000,김영희\n'

  it('UTF-8 파일은 그대로(BOM은 뺀다), 올바른 UTF-8이 아니면 EUC-KR로 읽는다', async () => {
    expect(decodeCsv(new TextEncoder().encode(TEXT))).toBe(TEXT)
    expect(decodeCsv(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(TEXT)]))).toBe(TEXT)
    expect(decodeCsv(bytes(EUC_KR))).toBe(TEXT)
    expect(await readCsvFile(new Blob([bytes(EUC_KR)]))).toBe(TEXT)
  })
})

describe('확인 필요 수 신호 (AC-N3-30·40)', () => {
  function setup(review = 2) {
    const server = new FakeServer().on('GET', /^\/api\/deposits\/count$/, () => ({ body: { review } }))
    vi.stubGlobal('fetch', server.fetch)
    const source = new FakeEventSource('/api/stream')
    const store = new DepositStore({ openStream: () => source })
    return { server, source, store }
  }

  it('처음 수를 받고, deposit 알림의 수로 바로 바꾸고 판을 올린다 — 원천이 바뀌면 원천 판도', async () => {
    const { source, store } = setup(2)
    store.start()
    await flush()
    expect(store.getSnapshot()).toMatchObject({ review: 2, tick: 0, sourcesTick: 0 })
    source.emit('deposit', { deposits: [3], review: 1, sources: [] })
    expect(store.getSnapshot()).toMatchObject({ review: 1, tick: 1, sourcesTick: 0 })
    source.emit('deposit', { deposits: [], review: 1, sources: ['dsrc_1'] })
    expect(store.getSnapshot()).toMatchObject({ review: 1, tick: 2, sourcesTick: 1 })
    store.stop()
    vi.unstubAllGlobals()
  })

  it('실제 범위의 기록만 scopeTick을 올리고(리허설은 아니다), 다시 붙으면(ready) 수를 다시 받는다', async () => {
    const { server, source, store } = setup(4)
    store.start()
    await flush()
    source.emit('change', { date: '2026-10-18', rehearsal: true, seq: 3 })
    expect(store.getSnapshot().scopeTick).toBe(0)
    source.emit('change', { date: '2026-10-18', rehearsal: false, seq: 4 })
    expect(store.getSnapshot().scopeTick).toBe(1)
    const before = server.callsTo('GET', /^\/api\/deposits\/count$/).length
    source.emit('ready', { scopes: [] })
    await flush()
    expect(server.callsTo('GET', /^\/api\/deposits\/count$/).length).toBe(before + 1)
    expect(store.getSnapshot().tick).toBe(1)
    store.stop()
    vi.unstubAllGlobals()
  })

  it('수를 받는 사이 알림이 오면 늦게 온 응답이 알림의 수를 덮지 않는다', async () => {
    let release: (() => void) | null = null
    const server = new FakeServer().on('GET', /^\/api\/deposits\/count$/, () => new Promise((resolve) => (release = () => resolve({ body: { review: 9 } }))))
    vi.stubGlobal('fetch', server.fetch)
    const source = new FakeEventSource('/api/stream')
    const store = new DepositStore({ openStream: () => source })
    store.start()
    await flush()
    source.emit('deposit', { deposits: [1], review: 3, sources: [] })
    ;(release as (() => void) | null)?.()
    await flush()
    expect(store.getSnapshot().review).toBe(3)
    store.stop()
    vi.unstubAllGlobals()
  })

  it('수를 받지 못하면 수를 모른다(메뉴에 수를 붙이지 않는다)', async () => {
    const server = new FakeServer()
    vi.stubGlobal('fetch', server.fetch)
    const store = new DepositStore({ openStream: () => new FakeEventSource('/api/stream') })
    store.start()
    await flush()
    expect(store.getSnapshot().review).toBeNull()
    store.stop()
    vi.unstubAllGlobals()
  })
})
