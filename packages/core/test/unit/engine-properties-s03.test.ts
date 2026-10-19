// AC-S03-92·AC-S03b-92 불변식 속성 테스트 (S03 이벤트 포함), AC-S03-02 검사 함수 = applyEvent 판정, AC-S03-03 순수·결정성,
// AC-S03-04 맞지 않는 명령, AC-S03-21 대기 순서, AC-S03-41 합치기 왕복, AC-S03-60 확정버전·효과 ID.
// fast-check가 S02 생성기에 문자찜·상품 수정·번호 변경·메시지 변환·충돌 결정·합치기·정산 기록과 설정(정책 둘 × 동률 처리 셋)을 더한 로그를 만든다.
// S03b: 문자찜은 서버처럼 키로 바꿔 넣고(같은 번호의 여러 형식, 뒤 4자리만 같은 다른 번호), 모르는 지정 구매자였다가 알게 되는 문자찜과 사본,
// 합친 뒤의 시청자 채팅 취소, 충돌 중 host.assign, 주문 메시지·언급 메시지의 변환, 대기 한도 0·1에서의 충돌·1등 취소·재고 늘림을 더한다.
// 실패하면 가장 짧은 로그로 줄여 시드와 함께 보여 준다. 재현: 실패 메시지의 seed·path를 fc.assert 옵션에 넣는다.
import {
  applyEvent,
  checkEvent,
  checkInvariants,
  compareRank,
  initEngine,
  isInvalidEvent,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  listSmsRefs,
  activeClaimId,
  parseChat,
  type BroadcastInfo,
  type ClaimInfo,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pentries, pget } from '../../src/engine/pmap.ts'
import { smsPhoneFields } from '../golden/phone-key.ts'
import { B1, B2, T0 } from './engine-helpers.ts'

const B0919: BroadcastInfo = { id: 'n1', date: '2026-10-19', title: '19일' }
const CHANNELS = ['A', 'B', 'C', 'D', 'OWNER'] as const
const NOS = [1, 2, 3] as const
/** 같은 번호의 여러 형식, 뒤 4자리만 같은 다른 번호(010-7777-2222), 휴대폰 번호 모양이 아닌 값 */
const PHONES = ['010-1111-2222', '01011112222', '０１０-３３３３-４４４４', '5678', '+82 10-1111-2222', '010-7777-2222', '(010) 3333 4444'] as const
const MEMOS = ['길동 이모', '  ', '김영희'] as const
/** 효과·찜 ID·조회 결과(뒤 4자리 밖)에 나오면 안 되는 글자 */
const SECRETS = ['11112222', '1111-2222', '33334444', '77772222', '길동 이모', '김영희'] as const
/** 엔진 상태(직렬화)에 있으면 안 되는 입력 번호 원문·정규화한 번호 (AC-S03b-03) */
const NUMBERS = ['010-1111-2222', '01011112222', '1111-2222', '11112222', '３３３３', '01033334444', '33334444', '3333 4444', '010-7777-2222', '01077772222', '77772222'] as const
/** 효과·효과 ID·찜 ID·구매자 ID·조회 결과에 있으면 안 되는 전화번호 키 */
const PHONE_KEYS = [...new Set(PHONES.map((phone) => smsPhoneFields(phone).phoneKey).filter((key): key is string => key !== undefined))]
const KST = 9 * 3_600_000

type Raw =
  | { readonly type: 'register'; readonly no: number; readonly stock: number; readonly price: number; readonly ready: boolean }
  | { readonly type: 'product'; readonly cmd: 'product.open' | 'product.hold' | 'product.close'; readonly no: number }
  | { readonly type: 'chat'; readonly msg: number; readonly ch: number; readonly text: string; readonly published: number; readonly owner: boolean; readonly nick: number }
  | { readonly type: 'sms'; readonly ref: number; readonly no: number; readonly received: number; readonly seconds: boolean; readonly phone: number; readonly memo: number; readonly designate: number }
  | { readonly type: 'pick'; readonly action: string; readonly pick: number; readonly other: number; readonly to: 'WAITLIST' | 'CANCEL' }
  | { readonly type: 'report'; readonly label: boolean; readonly pick: number }
  | { readonly type: 'resolve'; readonly no: number; readonly decision: 'KEEP' | 'SWITCH' }
  | { readonly type: 'convert'; readonly msg: number; readonly no: number }
  | { readonly type: 'update'; readonly no: number; readonly price: number | null; readonly stock: number | null; readonly name: string | null; readonly unpaid: boolean }
  | { readonly type: 'renumber'; readonly from: number; readonly to: number }
  | { readonly type: 'merge'; readonly from: number; readonly into: number }
  | { readonly type: 'unmerge'; readonly from: number }
  | { readonly type: 'ledger'; readonly kind: 'payment' | 'refund' | 'adjust' | 'shipping'; readonly buyer: number; readonly amount: number; readonly mode: number; readonly day: number }
  // 충돌을 자주 만드는 원료 (S03b): 1등 잠금, 수신 시각이 앞선 문자찜, 충돌 중인 상품의 1등 자리 비우기
  | { readonly type: 'lock'; readonly no: number; readonly pick: number }
  | { readonly type: 'early'; readonly no: number; readonly ref: number; readonly designate: number }
  | { readonly type: 'vacate'; readonly how: 'host.cancel' | 'host.reject' | 'chat' | 'approve' | 'stock'; readonly pick: number }

interface Entry {
  readonly raw: Raw
  readonly dt: number
}
interface Scenario {
  readonly broadcasts: readonly BroadcastInfo[]
  readonly settings: SettingsOverride
  readonly entries: readonly Entry[]
}

const settingsArb: fc.Arbitrary<SettingsOverride> = fc.record({
  'contention.policy': fc.constantFrom('ARRIVAL', 'RECEIVED_TIME'),
  'contention.sameMinuteTieBreaker': fc.constantFrom('YOUTUBE', 'SMS', 'HOST'),
  'waitlist.max': fc.integer({ min: 0, max: 3 }),
  'cancel.succession': fc.constantFrom('AUTO', 'ASK', 'REOPEN'),
  'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
  'claim.preOpenWindowSec': fc.integer({ min: 0, max: 60 }),
  'claim.ignoreOwner': fc.boolean(),
  'print.autoOnConfirm': fc.boolean(),
  'thanks.liveChat': fc.boolean(),
  'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE'),
  'shipping.freeThreshold': fc.constantFrom(null, 15000),
})

const no = fc.constantFrom(...NOS)
const rawArb: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 1, arbitrary: fc.record({ type: fc.constant('register' as const), no, stock: fc.integer({ min: 1, max: 3 }), price: fc.constantFrom(0, 5000, 10000), ready: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('product' as const), cmd: fc.constantFrom('product.open' as const, 'product.hold' as const, 'product.close' as const), no }) },
  {
    weight: 8,
    arbitrary: fc.record({
      type: fc.constant('chat' as const),
      msg: fc.integer({ min: 1, max: 30 }),
      ch: fc.nat(CHANNELS.length - 1),
      text: fc.oneof(no.map(String), fc.tuple(no, no).map(([x, y]) => `${String(x)} ${String(y)}`), no.map((x) => `${String(x)} 취소`), fc.constant('안녕'), no.map((x) => `${String(x)}번 예뻐요`)),
      published: fc.integer({ min: -90_000, max: 5000 }),
      owner: fc.boolean(),
      nick: fc.nat(2),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant('sms' as const),
      ref: fc.integer({ min: 1, max: 25 }),
      no,
      received: fc.integer({ min: -150_000, max: 10_000 }),
      seconds: fc.boolean(),
      phone: fc.integer({ min: -1, max: PHONES.length - 1 }),
      memo: fc.integer({ min: -1, max: MEMOS.length - 1 }),
      // 0~5: 아는 구매자, 6: 늘 모르는 구매자, 7·8: 아직 채팅하지 않았을 수 있는 채널(D·OWNER) — 모르는 지정 구매자였다가 알게 된다
      designate: fc.integer({ min: -3, max: 8 }),
    }),
  },
  {
    weight: 7,
    arbitrary: fc.record({
      type: fc.constant('pick' as const),
      action: fc.constantFrom(
        'host.cancel',
        'host.cancel',
        'host.reject',
        'host.promote',
        'host.confirm',
        'host.approveCancel',
        'host.dismissCancel',
        'host.blockBuyer',
        'host.unblockBuyer',
        'cancelChat',
        'cancelChatMerged',
        'assignTo',
        'replace',
        'assignConflict',
        'host.reopen',
      ),
      pick: fc.nat(),
      other: fc.nat(),
      to: fc.constantFrom('WAITLIST' as const, 'CANCEL' as const),
    }),
  },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('report' as const), label: fc.boolean(), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('resolve' as const), no, decision: fc.constantFrom('KEEP' as const, 'SWITCH' as const) }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('convert' as const), msg: fc.integer({ min: 1, max: 30 }), no }) },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('update' as const),
      no,
      price: fc.option(fc.constantFrom(0, 7000, 10000, 12000), { nil: null }),
      stock: fc.option(fc.integer({ min: 1, max: 4 }), { nil: null }),
      name: fc.option(fc.constantFrom('핑크프릴', '라울'), { nil: null }),
      unpaid: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('renumber' as const), from: fc.integer({ min: 1, max: 4 }), to: fc.integer({ min: 1, max: 4 }) }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('merge' as const), from: fc.nat(), into: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('unmerge' as const), from: fc.nat() }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant('ledger' as const),
      kind: fc.constantFrom('payment' as const, 'refund' as const, 'adjust' as const, 'shipping' as const),
      buyer: fc.nat(),
      amount: fc.constantFrom(1000, 5000, 14000, 30000),
      mode: fc.nat(3),
      day: fc.nat(1),
    }),
  },
)

function makeScenarioArb(settings: fc.Arbitrary<SettingsOverride>, raws: fc.Arbitrary<Raw> = rawArb): fc.Arbitrary<Scenario> {
  return fc.tuple(fc.constantFrom<readonly BroadcastInfo[]>([B1], [B1], [B1, B2], [B1, B0919]), settings).chain(([broadcasts, chosen]) =>
    fc
      .tuple(
        fc.array(fc.record({ type: fc.constant('register' as const), no, stock: fc.constantFrom(1, 1, 2), price: fc.constantFrom(5000, 10000), ready: fc.constantFrom(false, false, true) }), { minLength: 2, maxLength: 4 }),
        fc.array(fc.record({ raw: raws, dt: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 4000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 50_000 }) }) }), { minLength: 1, maxLength: 60, size: 'max' }),
      )
      .map(([prefix, rest]) => ({ broadcasts, settings: chosen, entries: [...prefix.map((raw) => ({ raw, dt: 0 })), ...rest] })),
  )
}

const scenarioArb = makeScenarioArb(settingsArb)
const receivedArb = makeScenarioArb(settingsArb.map((s) => ({ ...s, 'contention.policy': 'RECEIVED_TIME' as const, 'waitlist.max': Math.max(1, s['waitlist.max'] ?? 1) })))
/**
 * 충돌이 잦고 대기가 금방 차는 로그 (AC-S03b-92): 대기 한도 0~2, 실제 시각순 위주. 1등 잠금·수신 시각이 앞선 문자찜으로 충돌을 만들고,
 * 충돌 중인 상품에 1등 취소·무효·시청자 취소·취소 승인·재고 늘림·직접 배정을 넣는다 (D-064, D-068)
 */
const conflictRawArb: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 5, arbitrary: rawArb },
  {
    weight: 3,
    arbitrary: fc.record({ type: fc.constant('chat' as const), msg: fc.integer({ min: 31, max: 60 }), ch: fc.nat(CHANNELS.length - 2), text: no.map(String), published: fc.integer({ min: -5000, max: 0 }), owner: fc.constant(false), nick: fc.constant(0) }),
  },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('lock' as const), no, pick: fc.nat() }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant('early' as const), no, ref: fc.integer({ min: 1, max: 40 }), designate: fc.integer({ min: -4, max: 8 }) }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('vacate' as const), how: fc.constantFrom('host.cancel' as const, 'host.reject' as const, 'chat' as const, 'approve' as const, 'stock' as const), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant('pick' as const), action: fc.constant('assignConflict'), pick: fc.nat(), other: fc.nat(), to: fc.constantFrom('WAITLIST' as const, 'CANCEL' as const) }) },
)
const tightArb = makeScenarioArb(
  settingsArb.chain((s) => fc.record({ max: fc.constantFrom(0, 1, 2), policy: fc.constantFrom('RECEIVED_TIME', 'RECEIVED_TIME', 'ARRIVAL') }).map(({ max, policy }) => ({ ...s, 'waitlist.max': max, 'contention.policy': policy }))),
  conflictRawArb,
)

// ── 원료 → 이벤트 ────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')
function kstClock(ms: number, seconds: boolean): string {
  const day = 86_400_000
  const clock = (((ms + KST) % day) + day) % day
  const h = Math.floor(clock / 3_600_000)
  const m = Math.floor((clock % 3_600_000) / 60_000)
  const s = Math.floor((clock % 60_000) / 1000)
  return seconds ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`
}

function materialize(state: EngineState, scenario: Scenario, raw: Raw, seq: number, at: number): EngineEvent {
  const bIds = scenario.broadcasts.map((b) => b.id)
  const b = bIds[seq % bIds.length] as string
  const base = { seq, at }
  const buyers = listBuyers(state).map((x) => x.id)
  const buyerAt = (n: number): string => (buyers.length === 0 ? 'NOBODY' : (buyers[n % buyers.length] as string))
  switch (raw.type) {
    case 'register':
      return { ...base, type: 'product.register', b: bIds[0] as string, no: raw.no, name: '핑크프릴', price: raw.price, stock: raw.stock, status: raw.ready ? 'READY' : 'OPEN' }
    case 'product':
      return { ...base, type: raw.cmd, b: bIds[0] as string, no: raw.no }
    case 'chat': {
      const ch = CHANNELS[raw.ch] as string
      return { ...base, type: 'chat', b: bIds[0] as string, id: `m${String(raw.msg)}`, ch, nick: ['가', '나', '다'][raw.nick] as string, text: raw.text, owner: raw.owner && ch === 'OWNER', publishedAt: at + raw.published }
    }
    case 'sms':
      return {
        ...base,
        type: 'sms',
        b: bIds[0] as string,
        ref: `s${String(raw.ref)}`,
        no: raw.no,
        received: kstClock(at + raw.received, raw.seconds),
        // 전화번호는 서버처럼 정규화·키로 바꿔 넣는다 (D-061)
        ...(raw.phone < 0 ? {} : smsPhoneFields(PHONES[raw.phone] as string)),
        ...(raw.memo < 0 ? {} : { memo: MEMOS[raw.memo] as string }),
        ...(raw.designate < 0 ? {} : { buyer: raw.designate === 6 ? 'ZZ' : raw.designate >= 7 ? (CHANNELS[raw.designate - 4] as string) : buyerAt(raw.designate) }),
      }
    case 'pick':
      return resolvePick(state, raw, base, b)
    case 'report': {
      const kind = raw.label ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
      const pool = listEffects(state).filter((e) => e.kind === kind)
      const effectId = pool.length === 0 ? 'c999:PRINT_PRODUCT_LABEL:-:1' : (pool[raw.pick % pool.length]?.id as string)
      return { ...base, type: raw.label ? 'effect.labelPrinted' : 'effect.thanksSent', effectId }
    }
    case 'resolve':
      return { ...base, type: 'host.resolveConflict', b: bIds[0] as string, no: raw.no, decision: raw.decision }
    case 'convert':
      return { ...base, type: 'host.convertMessage', b: bIds[0] as string, msg: `m${String(raw.msg)}`, no: raw.no }
    case 'update':
      return {
        ...base,
        type: 'product.update',
        b: bIds[0] as string,
        no: raw.no,
        ...(raw.price === null ? {} : { price: raw.price }),
        ...(raw.stock === null ? {} : { stock: raw.stock }),
        ...(raw.name === null ? {} : { name: raw.name }),
        ...(raw.unpaid ? { applyTo: 'UNPAID_CLAIMS' as const } : {}),
      }
    case 'renumber':
      return { ...base, type: 'product.renumber', b: bIds[0] as string, from: raw.from, to: raw.to }
    case 'merge':
      return { ...base, type: 'buyer.merge', from: buyerAt(raw.from), into: buyerAt(raw.into), reason: '같은 사람' }
    case 'unmerge':
      return { ...base, type: 'buyer.unmerge', from: buyerAt(raw.from), reason: '잘못' }
    case 'ledger': {
      const date = (scenario.broadcasts[raw.day % scenario.broadcasts.length] as BroadcastInfo).date
      const buyer = buyerAt(raw.buyer)
      if (raw.kind === 'payment') return { ...base, type: 'settlement.payment', buyer, date, amount: raw.amount }
      if (raw.kind === 'refund') return { ...base, type: 'settlement.refund', buyer, date, amount: raw.amount, reason: '환불' }
      if (raw.kind === 'adjust') return { ...base, type: 'settlement.adjust', buyer, date, amount: -raw.amount, reason: '할인' }
      const mode = (['PICKUP', 'COMBINED', 'FIXED', 'DEFAULT'] as const)[raw.mode] as 'PICKUP' | 'COMBINED' | 'FIXED' | 'DEFAULT'
      return { ...base, type: 'settlement.shippingOverride', buyer, date, mode, ...(mode === 'FIXED' ? { amount: 3000 } : {}) }
    }
    case 'lock': {
      // 1등이 있는 상품의 1등 하나를 잠근다
      const sold = listProducts(state).filter((p) => p.winners.length > 0)
      const product = sold[raw.pick % Math.max(1, sold.length)]
      if (product === undefined) return { ...base, type: 'host.confirm', b: bIds[0] as string, no: raw.no, buyer: 'NOBODY' }
      return { ...base, type: 'host.confirm', b: product.broadcast, no: product.no, buyer: product.winners[raw.pick % product.winners.length] as string }
    }
    case 'early': {
      // 자리가 다 찬 상품(없으면 그 번호)의 지금 1등들보다 수신 시각이 앞선 문자찜 — 1등이 잠겨 있으면 충돌, 아니면 자동 역전 (실제 시각순)
      const full = listProducts(state).filter((p) => p.broadcast === bIds[0] && p.status === 'SOLD')
      const product = full[raw.ref % Math.max(1, full.length)] ?? listProducts(state).find((p) => p.broadcast === bIds[0] && p.no === raw.no)
      const times = listClaims(state).filter((c) => product?.winnerClaims.includes(c.id) === true).map((c) => c.rankTime)
      const earliest = times.length === 0 ? at - 120_000 : Math.min(...times)
      return {
        ...base,
        type: 'sms',
        b: bIds[0] as string,
        ref: `e${String(raw.ref)}`,
        no: product?.no ?? raw.no,
        received: kstClock(earliest - 60_000 - (raw.ref % 3) * 1000, true),
        ...(raw.designate < 0 ? {} : { buyer: raw.designate === 6 ? 'ZZ' : raw.designate >= 7 ? (CHANNELS[raw.designate - 4] as string) : buyerAt(raw.designate) }),
      }
    }
    case 'vacate': {
      const products = listProducts(state).filter((p) => p.winners.length > 0)
      const conflicted = products.filter((p) => p.conflict)
      const pool = conflicted.length > 0 ? conflicted : products
      const product = pool[raw.pick % Math.max(1, pool.length)]
      if (product === undefined) return { ...base, type: 'host.reopen', b: bIds[0] as string, no: 1, reason: '사유' }
      const at = { b: product.broadcast, no: product.no }
      const claim = listClaims(state).find((c) => c.id === product.winnerClaims[raw.pick % product.winnerClaims.length]) as ClaimInfo
      if (raw.how === 'stock') return { ...base, type: 'product.update', ...at, stock: product.stock + 1 + (raw.pick % 2) }
      if (raw.how === 'approve') return { ...base, type: 'host.approveCancel', ...at, buyer: claim.buyer }
      if (raw.how === 'chat' && !claim.buyer.startsWith('sms:')) return { ...base, type: 'chat', b: at.b, id: `v${String(seq)}`, ch: claim.buyer, nick: '가', text: `${String(at.no)} 취소` }
      return { ...base, type: raw.how === 'host.reject' ? 'host.reject' : 'host.cancel', ...at, buyer: claim.buyer, reason: '사유' }
    }
  }
}

function resolvePick(state: EngineState, raw: Extract<Raw, { type: 'pick' }>, base: { seq: number; at: number }, fallbackB: string): EngineEvent {
  const active = listClaims(state).filter((c) => c.status === 'CONFIRMED' || c.status === 'WAITLISTED' || c.status === 'PENDING' || c.status === 'CONFLICT')
  const confirmed = active.filter((c) => c.status === 'CONFIRMED')
  const pool = raw.other % 2 === 0 && confirmed.length > 0 ? confirmed : active
  const target = pool[raw.pick % Math.max(1, pool.length)]
  if (target === undefined) return { ...base, type: 'host.reopen', b: fallbackB, no: 1, reason: '사유' }
  const where = { b: target.broadcast, no: target.no }
  const buyers = listBuyers(state).map((b) => b.id)
  const other = buyers[raw.other % buyers.length] as string
  switch (raw.action) {
    case 'cancelChat':
      return { ...base, type: 'chat', b: target.broadcast, id: `p${String(base.seq)}`, ch: target.buyer.startsWith('sms:') ? 'A' : target.buyer, nick: '가', text: `${String(target.no)} 취소` }
    case 'cancelChatMerged': {
      // 그 찜의 지금의 구매자 묶음 안의 다른 유튜브 채널이 채팅으로 취소 (합친 다른 구매자의 찜 — D-063)
      const members = listBuyers(state).filter((b) => b.current === target.currentBuyer && b.kind === 'youtube' && b.id !== target.buyer)
      const ch = members[raw.other % Math.max(1, members.length)]?.id ?? 'A'
      return { ...base, type: 'chat', b: target.broadcast, id: `p${String(base.seq)}`, ch, nick: '가', text: `${String(target.no)} 취소` }
    }
    case 'assignTo':
      return { ...base, type: 'host.assign', ...where, buyer: other, reason: '사유' }
    case 'assignConflict': {
      // 충돌 중인 상품에 직접 배정 (교체 있음·없음, 대기·충돌 찜의 구매자에게도 — D-064)
      const conflicted = listProducts(state).filter((p) => p.conflict)
      const product = conflicted[raw.pick % Math.max(1, conflicted.length)]
      if (product === undefined) return { ...base, type: 'host.assign', ...where, buyer: other, reason: '사유' }
      const candidates = [...buyers, ...product.waitlist, ...(product.conflictBuyer === null ? [] : [product.conflictBuyer])]
      const buyer = candidates[raw.other % candidates.length] as string
      const at = { b: product.broadcast, no: product.no }
      return raw.other % 3 === 0
        ? { ...base, type: 'host.assign', ...at, buyer, reason: '사유' }
        : { ...base, type: 'host.assign', ...at, buyer, reason: '사유', replace: product.winners[raw.pick % product.winners.length] as string, replaceTo: raw.to }
    }
    case 'replace': {
      const winner = confirmed.find((c) => c.product === target.product)
      return { ...base, type: 'host.assign', ...where, buyer: other, reason: '사유', replace: winner?.buyer ?? target.buyer, replaceTo: raw.to }
    }
    case 'host.blockBuyer':
    case 'host.unblockBuyer':
      return { ...base, type: raw.action, buyer: target.buyer, reason: '사유' }
    case 'host.reopen':
      return { ...base, type: 'host.reopen', ...where, reason: '사유' }
    case 'host.cancel':
    case 'host.reject':
    case 'host.promote':
      return { ...base, type: raw.action, ...where, buyer: target.buyer, reason: '사유' }
    default:
      return { ...base, type: raw.action as 'host.confirm', ...where, buyer: target.buyer }
  }
}

interface Run {
  readonly states: EngineState[]
  readonly events: EngineEvent[]
  readonly emitted: (readonly string[])[]
}

function runScenario(scenario: Scenario): Run {
  let state = initEngine({ broadcasts: scenario.broadcasts, settings: scenario.settings })
  const states = [state]
  const events: EngineEvent[] = []
  const emitted: (readonly string[])[] = []
  let at = T0
  scenario.entries.forEach((entry, i) => {
    at += entry.dt
    const event = materialize(state, scenario, entry.raw, i + 1, at)
    const result = applyEvent(state, event)
    state = result.state
    states.push(state)
    events.push(event)
    emitted.push(result.effects.map((e) => e.id))
  })
  return { states, events, emitted }
}

/** 관찰 값 (seq에서 나온 값은 뺀다: 찜의 seq, 취소 요청의 seq, 정산 기록의 seq) */
function observe(state: EngineState): unknown {
  return {
    products: listProducts(state),
    claims: listClaims(state).map(({ seq: _seq, ...rest }) => rest),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state).map((s) => ({ ...s, records: s.records.map(({ seq: _seq, ...rest }) => rest) })),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state).map(({ seq: _seq, ...rest }) => rest),
  }
}

const json = (value: unknown): string => JSON.stringify(value)
const byId = (claims: readonly ClaimInfo[]): Map<string, ClaimInfo> => new Map(claims.map((c) => [c.id, c]))
/** 확정을 풀 수 있는 방송자 조치 (INV-8·INV-10) */
const HOST_RELEASE = new Set(['host.cancel', 'host.reject', 'host.assign', 'host.approveCancel', 'host.resolveConflict', 'product.renumber'])
/** RECEIVED_TIME에서 늦게 온 선순위 찜이 들어오는 이벤트 (잠금 전 1등의 자동 역전) */
const NEW_CLAIM = new Set(['chat', 'sms', 'product.register', 'product.open', 'product.renumber', 'host.convertMessage'])
const material = (c: ClaimInfo) => ({ seq: c.seq, time: c.rankTime, minute: c.rankMinute })

// ── 한 이벤트 앞뒤 검사 ──────────────────────────────────────────────────

function checkStep(scenario: Scenario, prev: EngineState, event: EngineEvent, next: EngineState, emitted: readonly string[], history: { versions: Map<string, number[]>; everConfirmed: Set<string> }): void {
  const where = `seq ${String(event.seq)} ${event.type}`
  // 한 상태 불변식: INV-1·2·5·6·7·9, 차단 중인 구매자의 대기·보류·충돌 찜 없음, 충돌 성질 (checkInvariants 한 번 순회)
  expect(checkInvariants(next), where).toEqual([])

  const before = byId(listClaims(prev))
  const after = listClaims(next)
  const policy = scenario.settings['contention.policy']
  // INV-8·INV-10: 확정이 풀리는 길
  const released = after.filter((c) => before.get(c.id)?.status === 'CONFIRMED' && c.status !== 'CONFIRMED')
  for (const claim of released) {
    const was = before.get(claim.id) as ClaimInfo
    const host = HOST_RELEASE.has(event.type)
    if (was.locked) expect(host, `${where}: 잠긴 확정 찜 ${claim.id}이 방송자 조치 없이 풀렸다 (INV-10)`).toBe(true)
    if (host) continue
    if (event.type === 'chat' && claim.status === 'CANCELLED') {
      expect(scenario.settings['cancel.buyerChat'], `${where}: 채팅이 확정을 풀었다`).toBe('AUTO')
      // 시청자 채팅 취소는 그 채널 자신의 찜에만 (D-063)
      expect(claim.buyer, `${where}: 채널 ${event.ch}가 다른 구매자의 찜 ${claim.id}을 채팅으로 취소했다`).toBe(event.ch)
      continue
    }
    // 그 밖은 RECEIVED_TIME의 자동 역전뿐 (합치기·상품 수정·정산 기록은 확정을 풀지 않는다, INV-8)
    expect(policy, `${where}: ${claim.id} 확정이 풀렸다 (INV-8)`).toBe('RECEIVED_TIME')
    expect(NEW_CLAIM.has(event.type), `${where}: 새 찜 없이 역전`).toBe(true)
  }

  // 대기열: 확정된 적 없는 찜들은 판정 순위 순서를 거스르지 않는다 (밀려난 찜만 앞에 올 수 있다, AC-S03-21)
  for (const claim of after) if (claim.status === 'CONFIRMED') history.everConfirmed.add(claim.id)
  const claims = byId(after)
  for (const product of listProducts(next)) {
    const fresh = product.waitlistClaims.filter((id) => !history.everConfirmed.has(id)).map((id) => claims.get(id) as ClaimInfo)
    for (let i = 1; i < fresh.length; i++) {
      expect(compareRank(material(fresh[i - 1] as ClaimInfo), material(fresh[i] as ClaimInfo), next.settings), `${where}: ${product.key} 대기 순서`).toBeLessThan(0)
    }
  }

  // 확정버전: 상품(상품 ID)마다 확정될 때마다 1부터 빈틈없이 하나씩 — 번호를 바꿔도 이어서 (AC-S03-60).
  // 한 이벤트에서 여럿이 확정되면 판정 순위 순서로 붙는다: 순위 순으로 늘어서야 한다
  const confirmedNow = new Map<string, ClaimInfo[]>()
  for (const claim of after) {
    const was = before.get(claim.id)
    const newlyConfirmed = claim.status === 'CONFIRMED' && (was?.status !== 'CONFIRMED' || was.confirmVersion !== claim.confirmVersion)
    if (newlyConfirmed) confirmedNow.set(claim.productId as string, [...(confirmedNow.get(claim.productId as string) ?? []), claim])
  }
  const prevWaitlist = new Map(listProducts(prev).flatMap((p) => p.waitlistClaims.map((id, i) => [id, i] as const)))
  for (const [pid, list] of confirmedNow) {
    const byVersion = [...list].sort((a, b) => (a.confirmVersion as number) - (b.confirmVersion as number))
    for (let i = 1; i < byVersion.length; i++) {
      if (event.type === 'product.register' || event.type === 'product.open' || event.type === 'product.renumber') {
        expect(compareRank(material(byVersion[i - 1] as ClaimInfo), material(byVersion[i] as ClaimInfo), next.settings), `${where}: 공개 순간 확정 순서`).toBeLessThan(0)
      }
    }
    // 재고 늘림은 대기 순번 순서로 확정하고 확정버전도 그 순서 (D-066): 이전 대기열에 있던 찜끼리는 이전 대기 순번 순
    if (event.type === 'product.update') {
      const fromWaitlist = byVersion.filter((c) => prevWaitlist.has(c.id)).map((c) => prevWaitlist.get(c.id) as number)
      expect(fromWaitlist, `${where}: 재고 늘림 확정 순서`).toEqual([...fromWaitlist].sort((a, b) => a - b))
    }
    history.versions.set(pid, [...(history.versions.get(pid) ?? []), ...byVersion.map((c) => c.confirmVersion as number)])
  }
  for (const product of listProducts(next)) {
    const seen = history.versions.get(product.id) ?? []
    expect(seen, `${where}: ${product.key} 확정버전`).toEqual(seen.map((_, i) => i + 1))
    expect(product.confirmVersion).toBe(seen.length)
  }

  // 효과 목록 = 이전 + 이번에 나온 것, 효과 ID 유일, NOTIFY 없음, 실행 완료는 최대 1번 (INV-11)
  const prevEffects = listEffects(prev)
  const nextEffects = listEffects(next)
  expect(nextEffects.map((e) => e.id)).toEqual([...prevEffects.map((e) => e.id), ...emitted])
  expect(new Set(nextEffects.map((e) => e.id)).size).toBe(nextEffects.length)
  expect(nextEffects.some((e) => e.kind === 'NOTIFY' || e.kind === 'PRINT_PACKING_LABEL')).toBe(false)
  const prevStatus = new Map(prevEffects.map((e) => [e.id, e.status]))
  for (const effect of nextEffects) if (prevStatus.get(effect.id) === 'DONE') expect(effect.status).toBe('DONE')
  expect(nextEffects.filter((e) => e.status === 'DONE' && prevStatus.get(e.id) !== 'DONE').length).toBeLessThanOrEqual(event.type.startsWith('effect.') ? 1 : 0)

  // 개인정보: 효과·찜 ID·구매자 ID·조회 결과에 메모·전체 전화번호·전화번호 키가 없다 (AC-S03-12, AC-S03b-03)
  const nextBuyers = listBuyers(next)
  const published = json([nextEffects, emitted, after.map((c) => c.id), nextBuyers.map((b) => b.id)])
  for (const secret of [...SECRETS, ...PHONE_KEYS]) expect(published.includes(secret), `${where}: 효과·ID에 ${secret}`).toBe(false)
  const views = json([nextBuyers.map(({ display: _d, nameHistory: _n, ...rest }) => rest), after, listProducts(next), listSettlements(next), listSmsRefs(next)])
  for (const secret of ['11112222', '33334444', '77772222', ...PHONE_KEYS]) expect(views.includes(secret), `${where}: 조회 결과에 전체 번호·키`).toBe(false)
  for (const buyer of nextBuyers) if (buyer.phoneLast4 !== null) expect(buyer.phoneLast4, `${where}: 뒤 4자리`).toMatch(/^[0-9]{4}$/)
  // 엔진 상태(직렬화)에 입력한 번호 원문·정규화한 번호가 없다 (AC-S03b-03)
  const stateText = json(next)
  for (const number of NUMBERS) expect(stateText.includes(number), `${where}: 상태에 ${number}`).toBe(false)

  // 대기 수 ≤ 대기 한도 (매 이벤트 뒤, AC-S03b-92)
  const limit = Math.max(0, scenario.settings['waitlist.max'] ?? 5)
  for (const product of listProducts(next)) expect(product.waitlist.length, `${where}: ${product.key} 대기 한도`).toBeLessThanOrEqual(limit)

  // 승계 AUTO에서 1등 자리를 비우는 이벤트, 재고 늘림은 새 REJECTED(SOLD_OUT)을 만들지 않는다 (D-068)
  const soldOut = after.filter((c) => c.status === 'REJECTED' && c.reason === 'SOLD_OUT' && before.has(c.id) && !(before.get(c.id)?.status === 'REJECTED'))
  const cancelOnly = event.type === 'chat' && parseChat(event.text, next.settings).claims.length === 0
  const vacating = event.type === 'host.cancel' || event.type === 'host.reject' || event.type === 'host.approveCancel' || cancelOnly
  if (event.type === 'product.update' || (vacating && scenario.settings['cancel.succession'] === 'AUTO')) {
    expect(soldOut.map((c) => c.id), `${where}: 자리를 비우는 이벤트가 품절을 만들었다`).toEqual([])
  }

  // 아무것도 바꾸지 않는 조치 (AC-S03b-92): 주문이었던 메시지의 변환, 충돌 중 host.assign
  if (event.type === 'host.convertMessage' && pget(prev.messages, JSON.stringify([event.b, event.msg]))?.order === true) {
    expect(next, `${where}: 주문이었던 메시지를 변환했다 (D-062)`).toBe(prev)
  }
  if (event.type === 'host.assign' && pget(prev.slots, `${event.b}/${String(event.no)}`)?.conflict != null) {
    expect(next, `${where}: 충돌 중에 배정했다 (D-064)`).toBe(prev)
  }
  // 합친 다른 구매자의 찜에 대한 시청자 채팅 취소는 찜·요청·상품·효과를 바꾸지 않는다 (D-063)
  if (cancelOnly) {
    const targets = parseChat(event.text, next.settings).cancels.map((n) => activeClaimId(prev, event.b, n, event.ch))
    const ownTarget = targets.some((id) => id !== null && before.get(id)?.buyer === event.ch)
    if (!ownTarget) {
      expect(json([after, listCancelRequests(next), listProducts(next), emitted]), `${where}: 다른 구매자의 찜을 채팅으로 바꿨다`).toBe(
        json([listClaims(prev), listCancelRequests(prev), listProducts(prev), []]),
      )
    }
  }
}

function checkRun(scenario: Scenario): Run {
  const run = runScenario(scenario)
  const history = { versions: new Map<string, number[]>(), everConfirmed: new Set<string>() }
  run.events.forEach((event, i) => checkStep(scenario, run.states[i] as EngineState, event, run.states[i + 1] as EngineState, run.emitted[i] as string[], history))
  return run
}

const PARAMS = { numRuns: 200 } as const

describe('AC-S03-92 불변식 속성 (S03 이벤트·설정을 섞은 무작위 로그)', () => {
  it('매 이벤트 뒤 한 상태 불변식, 이벤트 사이 INV-8·10·11, 대기 순서, 확정버전, 효과 목록, 개인정보', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        checkRun(scenario)
      }),
      PARAMS,
    )
  })

  it('같은 검사, 실제 시각순·대기 한도 1 이상 로그 (역전·충돌·대기 끼워 넣기를 자주 지난다)', () => {
    fc.assert(
      fc.property(receivedArb, (scenario) => {
        checkRun(scenario)
      }),
      PARAMS,
    )
  })

  it('같은 검사, 충돌이 잦고 대기 한도 0~2인 로그 (꽉 찬 대기에서 충돌 중 1등 취소·무효·시청자 취소·승인·재고 늘림·배정, 승계 셋 — D-064·D-068)', () => {
    fc.assert(
      fc.property(tightArb, (scenario) => {
        checkRun(scenario)
      }),
      { numRuns: 300 },
    )
  })

  it('INV-4·AC-S03-03: 처음부터 다시 적용한 상태 = 이어서 적용한 상태, JSON 왕복 뒤 이어서 적용해도 같다, 넘긴 상태·이벤트를 바꾸지 않는다', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (scenario, cut) => {
        const first = runScenario(scenario)
        const second = runScenario(scenario)
        expect(second.states.map(json)).toEqual(first.states.map(json))
        expect(second.emitted).toEqual(first.emitted)
        const k = cut % (first.events.length + 1)
        let state = JSON.parse(json(first.states[k])) as EngineState
        for (let i = k; i < first.events.length; i++) {
          const event = first.events[i] as EngineEvent
          const stateText = json(state)
          const eventText = json(event)
          state = applyEvent(state, event).state
          if (i === k) {
            expect(json(first.states[k])).toBe(stateText)
            expect(json(event)).toBe(eventText)
          }
        }
        expect(json(state)).toBe(json(first.states.at(-1)))
      }),
      { numRuns: 120 },
    )
  })

  const copyable = (scenario: Scenario): number[] => scenario.entries.flatMap((entry, i) => (entry.raw.type === 'chat' || entry.raw.type === 'sms' ? [i] : []))

  it('INV-3·INV-12: 채팅·문자찜(같은 ref)의 사본을 첫 수신 뒤 아무 위치에(내용을 바꿔) 끼워 넣어도 관찰 값이 같다', () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => copyable(s).length > 0),
        fc.nat(),
        fc.array(fc.tuple(fc.nat(), fc.nat(), fc.integer({ min: -5000, max: 5000 })), { minLength: 1, maxLength: 3 }),
        (scenario, pick, copies) => {
          const indexes = copyable(scenario)
          const i = indexes[pick % indexes.length] as number
          const source = (scenario.entries[i] as Entry).raw
          const original = runScenario(scenario)
          // ref는 처음 받을 때 기록한다 — 모르는 지정 구매자라 구매자를 정하지 않은 문자찜의 사본도 아무 일도 없다 (D-067, S03의 건너뛰기를 없앴다)
          const entries = [...scenario.entries]
          const positions = copies.map(([n, variant, shift]) => ({ at: i + 1 + (n % (scenario.entries.length - i)), variant, shift })).sort((a, b) => b.at - a.at)
          for (const { at, variant, shift } of positions) {
            const raw: Raw =
              source.type === 'chat'
                ? { ...source, text: ['15', '1 취소', '안녕', '2'][variant % 4] as string, nick: variant % 3, published: source.published + shift }
                : source.type === 'sms'
                  ? { ...source, no: NOS[variant % 3] as number, memo: (variant % 4) - 1, phone: (variant % (PHONES.length + 1)) - 1, received: source.received + shift, designate: (variant % 10) - 1 }
                  : source
            entries.splice(at, 0, { raw, dt: 0 })
          }
          const withCopies = runScenario({ ...scenario, entries })
          expect(json(observe(withCopies.states.at(-1) as EngineState))).toBe(json(observe(original.states.at(-1) as EngineState)))
        },
      ),
      PARAMS,
    )
  })
})

// ── AC-S03-41: 합치기 → 떼어 내기 왕복 ───────────────────────────────────

describe('AC-S03-41 합치기 속성', () => {
  it('받은 합치기 뒤 INV-2(검사 함수), 합치기 → 떼어 내기 왕복 뒤 DUPLICATE가 아닌 찜의 상태·구매자 자신이 그대로, 확정은 풀리지 않는다', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), fc.nat(), (scenario, x, y) => {
        const state = runScenario(scenario).states.at(-1) as EngineState
        const buyers = listBuyers(state).map((b) => b.id)
        if (buyers.length < 2) return
        const from = buyers[x % buyers.length] as string
        const into = buyers[y % buyers.length] as string
        const seq = scenario.entries.length + 1
        const merged = applyEvent(state, { seq, at: T0 + 10_000_000, type: 'buyer.merge', from, into, reason: 'r' })
        expect(checkInvariants(merged.state)).toEqual([])
        expect(merged.effects).toEqual([])
        if (merged.state === state) return
        const back = applyEvent(merged.state, { seq: seq + 1, at: T0 + 10_000_001, type: 'buyer.unmerge', from, reason: 'r' }).state
        expect(checkInvariants(back)).toEqual([])
        const after = byId(listClaims(back))
        for (const claim of listClaims(state)) {
          const now = after.get(claim.id) as ClaimInfo
          if (now.status === 'DUPLICATE') continue
          expect([now.status, now.buyer, now.currentBuyer], claim.id).toEqual([claim.status, claim.buyer, claim.currentBuyer])
        }
        const confirmedBefore = listClaims(state).filter((c) => c.status === 'CONFIRMED').map((c) => c.id)
        expect(listClaims(merged.state).filter((c) => c.status === 'CONFIRMED').map((c) => c.id)).toEqual(confirmedBefore)
      }),
      PARAMS,
    )
  })
})

// ── AC-S03-04: 맞지 않는 명령 ────────────────────────────────────────────

function invalidS03Commands(state: EngineState): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { type: 'sms', b: 'b1', ref: 'x1', no: 1, received: '20:00', buyer: 'NOBODY' },
    { type: 'product.update', b: 'b1', no: 99, price: 1 },
    { type: 'product.renumber', b: 'b1', from: 99, to: 98 },
    { type: 'host.resolveConflict', b: 'b1', no: 99, decision: 'KEEP' },
    { type: 'host.convertMessage', b: 'b1', msg: 'nope', no: 1 },
    { type: 'buyer.merge', from: 'NOBODY', into: 'A', reason: 'r' },
    { type: 'buyer.unmerge', from: 'NOBODY', reason: 'r' },
    { type: 'settlement.payment', buyer: 'NOBODY', date: '2026-10-18', amount: 1 },
    { type: 'settlement.adjust', buyer: 'NOBODY', date: '2026-10-18', amount: -1, reason: 'r' },
    { type: 'settlement.shippingOverride', buyer: 'NOBODY', date: '2026-10-18', mode: 'PICKUP' },
  ]
  for (const { ref } of listSmsRefs(state)) out.push({ type: 'sms', b: 'b1', ref, no: 2, received: '19:00', memo: '다른 메모' })
  // 구매자를 정하지 않은 ref의 사본(그 사이 구매자를 알게 됐어도), 주문이었던 메시지의 변환, 충돌 중 배정 (D-062·D-064·D-067)
  for (const [ref, buyer] of pentries(state.refs)) if (buyer === null) out.push({ type: 'sms', b: 'b1', ref, no: 1, received: '20:00', buyer: 'A' })
  for (const [key, message] of pentries(state.messages)) {
    if (!message.order) continue
    const [b, msg] = JSON.parse(key) as [string, string]
    for (const n of NOS) out.push({ type: 'host.convertMessage', b, msg, no: n })
  }
  for (const product of listProducts(state)) {
    if (!product.conflict) continue
    const at = { b: product.broadcast, no: product.no }
    for (const buyer of listBuyers(state)) {
      out.push({ type: 'host.assign', ...at, buyer: buyer.id, reason: 'r' })
      for (const winner of product.winners) out.push({ type: 'host.assign', ...at, buyer: buyer.id, reason: 'r', replace: winner, replaceTo: 'WAITLIST' })
    }
  }
  for (const product of listProducts(state)) {
    const at = { b: product.broadcast, no: product.no }
    out.push({ type: 'product.update', ...at, stock: Math.max(1, product.winners.length) - (product.winners.length > 1 ? 1 : 0) === product.winners.length ? product.stock : Math.max(1, product.winners.length - 1), name: '다른' })
    out.push({ type: 'product.update', ...at, name: product.name, price: product.price, stock: product.stock })
    out.push({ type: 'product.renumber', b: product.broadcast, from: product.no, to: product.no })
    for (const otherProduct of listProducts(state)) if (otherProduct.broadcast === product.broadcast && otherProduct.no !== product.no) out.push({ type: 'product.renumber', b: product.broadcast, from: product.no, to: otherProduct.no })
    if (!product.conflict) out.push({ type: 'host.resolveConflict', ...at, decision: 'SWITCH' })
  }
  for (const buyer of listBuyers(state)) {
    out.push({ type: 'buyer.merge', from: buyer.id, into: buyer.id, reason: 'r' })
    if (buyer.mergedInto === null) out.push({ type: 'buyer.unmerge', from: buyer.id, reason: 'r' })
    else out.push({ type: 'buyer.merge', from: buyer.id, into: buyer.current, reason: 'r' })
    for (const sub of buyer.merged) out.push({ type: 'buyer.merge', from: buyer.current, into: sub, reason: 'r' })
    const received = listSettlements(state).find((s) => s.buyer === buyer.current && s.date === '2026-10-18')?.received ?? 0
    out.push({ type: 'settlement.refund', buyer: buyer.id, date: '2026-10-18', amount: received + 1, reason: 'r' })
  }
  for (const claim of listClaims(state)) {
    if (claim.status === 'CONFIRMED') out.push({ type: 'sms', b: claim.broadcast, ref: 'fresh-ref', no: claim.no, received: '20:00', buyer: claim.buyer })
  }
  return out.filter((event) => !(event.type === 'product.update' && 'stock' in event && typeof event.stock === 'number' && event.stock >= (listProducts(state).find((p) => p.no === event.no && p.broadcast === event.b)?.winners.length ?? 0) && event.name === '다른'))
}

describe('AC-S03-04 무작위 상태에 맞지 않는 S03 명령 → 새 효과 없음, 관찰 값 그대로', () => {
  it('속성', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (scenario, pick) => {
        const run = runScenario(scenario)
        const state = run.states.at(-1) as EngineState
        const commands = invalidS03Commands(state)
        const command = commands[pick % commands.length] as Record<string, unknown>
        const event = { at: T0 + 10_000_000, ...command, seq: run.events.length + 1 } as unknown as EngineEvent
        expect(checkEvent(state, event), json(command)).toEqual([])
        const result = applyEvent(state, event)
        expect(result.effects, json(command)).toEqual([])
        expect(json(observe(result.state)), json(command)).toBe(json(observe(state)))
      }),
      PARAMS,
    )
  })
})

// ── AC-S03-02: 검사 함수와 applyEvent의 판정이 같다 ──────────────────────

const VALID_EVENTS: readonly Record<string, unknown>[] = [
  { type: 'product.register', b: 'b1', no: 5, name: 'x', price: 1000, stock: 2, status: 'READY' },
  { type: 'product.open', b: 'b1', no: 5 },
  { type: 'product.update', b: 'b1', no: 1, name: 'y', price: 0, stock: 3, applyTo: 'UNPAID_CLAIMS' },
  { type: 'product.renumber', b: 'b1', from: 1, to: 9 },
  { type: 'chat', b: 'b1', id: 'zz', ch: 'E', nick: 'e', text: '1', owner: false, publishedAt: T0 },
  { type: 'sms', b: 'b1', ref: 'r9', no: 1, received: '20:01:05', memo: 'm', phoneKey: 'k'.repeat(16), phoneLast4: '0000', buyer: 'A' },
  { type: 'sms', b: 'b1', ref: 'Ab_9-x', no: 2, received: '20:01', ...smsPhoneFields('010-1234-5678') },
  { type: 'host.cancel', b: 'b1', no: 1, buyer: 'A', reason: '사유' },
  { type: 'host.confirm', b: 'b1', no: 1, buyer: 'A', reason: '사유' },
  { type: 'host.assign', b: 'b1', no: 1, buyer: 'A', reason: '사유', replace: 'B', replaceTo: 'WAITLIST' },
  { type: 'host.reopen', b: 'b1', no: 1, reason: '사유' },
  { type: 'host.resolveConflict', b: 'b1', no: 1, decision: 'KEEP', reason: '사유' },
  { type: 'host.convertMessage', b: 'b1', msg: 'm1', no: 2, reason: '사유' },
  { type: 'host.blockBuyer', buyer: 'A', reason: '사유' },
  { type: 'buyer.merge', from: 'A', into: 'B', reason: '사유' },
  { type: 'buyer.unmerge', from: 'A', reason: '사유' },
  { type: 'effect.thanksSent', effectId: 'c1:POST_THANKS:LIVE_CHAT:1' },
  { type: 'settlement.shippingOverride', buyer: 'A', date: '2026-10-18', mode: 'FIXED', amount: 0 },
  { type: 'settlement.shippingOverride', buyer: 'A', date: '2026-10-18', mode: 'DEFAULT' },
  { type: 'settlement.adjust', buyer: 'A', date: '2026-10-18', amount: -500, reason: '사유' },
  { type: 'settlement.payment', buyer: 'A', date: '2024-02-29', amount: 1, memo: '' },
  { type: 'settlement.refund', buyer: 'A', date: '2026-10-18', amount: 1, reason: '사유' },
]

/** 값 하나를 바꾸는 변형: 형식이 틀릴 수도, 여전히 맞을 수도 있다 */
const mutation = fc.oneof(
  fc.record({ kind: fc.constant('drop' as const), field: fc.nat() }),
  fc.record({
    kind: fc.constant('set' as const),
    field: fc.nat(),
    value: fc.constantFrom<unknown>(0, -1, 1.5, 1, '1', '', ' ', '24:00', '8:01', '20:01:60', '20:01', '2026-02-30', '2026-10-18', 'b9', 'b1', null, true, 'KEEP', 'keep', 'FIXED', 'DEFAULT', 'sms:x', '__proto__', Number.NaN, [], {}),
  }),
  fc.record({ kind: fc.constant('type' as const), value: fc.constantFrom('sms.claim', 'settlement.paid', 'chat.message', '__proto__', 'SMS', 'broadcast.start', 'effect.failed', 'host.convert') }),
  fc.record({ kind: fc.constant('extra' as const), value: fc.constantFrom<unknown>('anything', 1) }),
  // S03b: 문자찜 ref·전화번호 키·뒤 4자리 형식, 전화번호 원문 필드, 한쪽만 있는 짝 (D-061, D-065)
  fc.record({
    kind: fc.constant('sms' as const),
    field: fc.constantFrom('ref', 'phoneKey', 'phoneLast4', 'phone', 'replace', 'replaceTo'),
    value: fc.constantFrom<unknown>(undefined, '', 'a'.repeat(15), 'a'.repeat(16), 'a'.repeat(128), 'a'.repeat(129), 'a+b='.repeat(5), '010-1234-5678', '01012345678', '5678', '567', '56789', '５６７８', '12a4', 5678, '김영희', 's:1', 'a'.repeat(64), 'a'.repeat(65), 'WAITLIST', 'B'),
  }),
)

describe('AC-S03-02 검사 함수 = applyEvent의 입력 오류 판정', () => {
  it('속성: 무작위 상태 × 변형 이벤트에서 checkEvent가 문제를 돌려줄 때만 applyEvent가 입력 오류를 던지고, 그때 상태는 그대로다', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), fc.array(mutation, { maxLength: 3 }), (scenario, pick, mutations) => {
        const state = runScenario(scenario).states.at(-1) as EngineState
        let event: Record<string, unknown> = { ...(VALID_EVENTS[pick % VALID_EVENTS.length] as Record<string, unknown>), seq: 999, at: T0 + 10_000_000 }
        for (const m of mutations) {
          const fields = Object.keys(event)
          if (m.kind === 'drop') {
            const { [fields[m.field % fields.length] as string]: _gone, ...rest } = event
            event = rest
          } else if (m.kind === 'set') event = { ...event, [fields[m.field % fields.length] as string]: m.value }
          else if (m.kind === 'type') event = { ...event, type: m.value }
          else if (m.kind === 'sms') event = { ...event, [m.field]: m.value }
          else event = { ...event, extraField: m.value }
        }
        const before = json(state)
        const problems = checkEvent(state, event)
        let thrown: unknown
        try {
          applyEvent(state, event as unknown as EngineEvent)
        } catch (error) {
          thrown = error
        }
        expect(isInvalidEvent(thrown), json(event)).toBe(problems.length > 0)
        if (problems.length > 0) expect(json(state)).toBe(before)
      }),
      { numRuns: 400 },
    )
  })

  it('표의 모든 종류에서 변형 없는 이벤트는 입력 오류가 아니다', () => {
    const state = initEngine({ broadcasts: [B1], settings: {} })
    for (const event of VALID_EVENTS) expect(checkEvent(state, { ...event, seq: 1, at: T0 }), json(event)).toEqual([])
  })
})

describe('회귀 (시드 고정)', () => {
  it('고정 시드로 같은 로그를 다시 돌린다', () => {
    fc.assert(
      fc.property(receivedArb, (scenario) => {
        checkRun(scenario)
      }),
      { seed: 20261019, numRuns: 120 },
    )
  })
})
