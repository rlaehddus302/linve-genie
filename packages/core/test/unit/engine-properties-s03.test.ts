// AC-S03-92·AC-S03b-92 불변식 속성 테스트 (S03 이벤트 포함), AC-S03-02 검사 함수 = applyEvent 판정, AC-S03-03 순수·결정성,
// AC-S03-04 맞지 않는 명령, AC-S03-21 대기 순서, AC-S03-41 합치기 왕복, AC-S03-60 확정버전·효과 ID.
// fast-check가 S02 생성기에 문자찜·상품 수정·번호 변경·메시지 변환·충돌 결정·합치기·정산 기록과 설정(정책 둘 × 동률 처리 셋)을 더한 로그를 만든다.
// S03b: 문자찜은 서버처럼 키로 바꿔 넣고(같은 번호의 여러 형식, 뒤 4자리만 같은 다른 번호), 모르는 지정 구매자였다가 알게 되는 문자찜과 사본,
// 합친 뒤의 시청자 채팅 취소, 충돌 중 host.assign, 주문 메시지·언급 메시지의 변환, 대기 한도 0·1에서의 충돌·1등 취소·재고 늘림을 더한다.
// S04(AC-S04-92): 로그 중간의 broadcast.start(새 방송 — 여러 날짜, 범위 안 무작위 설정, 이미 선언한 방송의 사본), 아무 위치의 broadcast.end와 그 뒤 입력,
// 승계 ASK·대기 한도 0 방송, 취소 메시지와 그 변환, 표에 없는 필드를 붙인 이벤트를 더한다. 빈 엔진에서 broadcast.start로 시작하는 로그도 만든다.
// S04 마무리(D-079·D-080): 휴대폰 번호(여러 형식)를 넣은 글 칸과 번호 ID 칸은 기록 전 검사(checkEvent)만 거절하고 applyEvent(재생)는 처리한다.
// 날짜·수량·금액을 섞은 번호 아닌 글(방송 제목·상품 이름·입금 메모·사유)과 영문이 섞인 숫자 많은 ID(채널 UC0101…)는 기록된다.
// 로그에 남는 이벤트는 모두 checkEvent를 통과한다(서버는 checkEvent를 통과한 것만 기록한다).
// 이벤트는 선언된 방송 중 하나로 가고(entry.bsel), 판정 검사는 그 찜·상품이 속한 방송의 설정으로 한다(D-070).
// 실패하면 가장 짧은 로그로 줄여 시드와 함께 보여 준다. 재현: 실패 메시지의 seed·path를 fc.assert 옵션에 넣는다.
import {
  applyEvent,
  checkEvent,
  checkInvariants,
  containsPhoneRun,
  looksLikePhoneId,
  compareRank,
  formatThanksHead,
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
  InvalidEventError,
  isNotImplemented,
  getBroadcast,
  listBroadcasts,
  parseChat,
  resolveSettings,
  type BroadcastInfo,
  type ClaimInfo,
  type EngineEvent,
  type EngineState,
  type SaleSettings,
  type SettingsOverride,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pentries, pget } from '../../src/engine/pmap.ts'
import { smsPhoneFields } from '../golden/phone-key.ts'
import { B1, B2, T0 } from './engine-helpers.ts'

const B0919: BroadcastInfo = { id: 'n1', date: '2026-10-19', title: '19일' }
/** 영문이 섞인 숫자 많은 불투명 채널 ID — 휴대폰 번호 ID가 아니다(looksLikePhoneId 거짓, D-079 ④). 아직 채팅하지 않았을 수 있는 채널 자리 */
const OPAQUE = 'UC01012345678abcdEFGH_-'
const CHANNELS = ['A', 'B', 'C', OPAQUE, 'OWNER'] as const
/** 날짜·수량·금액을 섞은 번호 아닌 글 (D-079 — 숫자를 모두 모으면 01로 시작하는 10자리라도 받는다, SA-S04-007) */
const NOT_PHONE_TEXTS = ['01/05 구피 30종 1000원', '01/05 100,000원 이상 무료', '01/05 3개 25,000원', '1234-5678', '+82 10-1234-5678'] as const
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
/** broadcast.start가 쓰는 방송 ID와 날짜 (시작 목록의 B1·B2·B0919와 겹친다 — 겹치면 사본) */
const START_IDS = ['b1', 'b2', 'n1', 's4'] as const
const START_DATES = ['2026-10-18', '2026-10-19'] as const
/** 표에 없는 필드 이름 (D-073): 번호를 다른 이름으로 밀어 넣는 변형 */
const EXTRA_NAMES = ['Phone', 'phoneNumber', 'phone_number', 'tel', 'contact', 'meta', 'extra', 'note', 'phone', 'memo', '__proto__'] as const

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
  // S04: 방송 시작(새 방송 또는 이미 선언한 방송의 사본)·종료, 입력 오류여야 하는 이벤트(기록되지 않는다)
  | { readonly type: 'start'; readonly slot: number; readonly day: number; readonly title: number; readonly settings: SettingsOverride }
  | { readonly type: 'end'; readonly pick: number }
  | { readonly type: 'bad'; readonly kind: 'extra' | 'ref' | 'memo' | 'text' | 'id'; readonly base: number; readonly name: number; readonly digits: number; readonly form: number }

interface Entry {
  readonly raw: Raw
  readonly dt: number
  /** 방송이 필요한 이벤트가 갈 방송: 선언된 방송 중 bsel번째 (선언 순서) */
  readonly bsel: number
  /** 방송을 직접 정한다 (사본을 끼워 넣을 때 원본과 같은 방송으로) */
  readonly b?: string
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
  'thanks.followEdits': fc.boolean(),
  'shipping.freeThreshold': fc.constantFrom(null, 15000),
})

/** broadcast.start의 설정: 설정값 범위 안의 무작위 값, 키도 무작위로 고른다 (D-071) */
const startSettingsArb: fc.Arbitrary<SettingsOverride> = fc.record(
  {
    'claim.parseMode': fc.constantFrom('STRICT', 'LOOSE'),
    'claim.multiNumber': fc.constantFrom('ALL', 'FIRST', 'IGNORE'),
    'claim.maxNumber': fc.oneof(fc.constant(999), fc.integer({ min: 1, max: 9999 })),
    'claim.ignoreOwner': fc.boolean(),
    'claim.preOpenWindowSec': fc.integer({ min: 0, max: 300 }),
    'waitlist.max': fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 0, max: 3 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 100 }) }),
    'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
    'cancel.succession': fc.constantFrom('AUTO', 'ASK', 'REOPEN'),
    'contention.policy': fc.constantFrom('ARRIVAL', 'RECEIVED_TIME'),
    'contention.sameMinuteTieBreaker': fc.constantFrom('YOUTUBE', 'SMS', 'HOST'),
    'price.unit': fc.constantFrom('WON', 'THOUSAND'),
    'shipping.baseFee': fc.integer({ min: 0, max: 1_000_000 }),
    'shipping.freeThreshold': fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 100_000_000 })),
    'settlement.groupBy': fc.constant('DATE'),
    'print.autoOnConfirm': fc.boolean(),
    'thanks.liveChat': fc.boolean(),
    'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE', 'SUMMARY'),
    'thanks.batchWindowSec': fc.integer({ min: 0, max: 600 }),
    'thanks.followEdits': fc.boolean(),
  },
  { requiredKeys: [] },
)
/** 승계 ASK·대기 한도 0 방송 (D-077) */
const askZeroArb: fc.Arbitrary<SettingsOverride> = startSettingsArb.map((s) => ({ ...s, 'cancel.succession': 'ASK', 'waitlist.max': 0 }))

const startArb: fc.Arbitrary<Raw> = fc.record({
  type: fc.constant('start' as const),
  slot: fc.nat(START_IDS.length - 1),
  day: fc.nat(START_DATES.length - 1),
  title: fc.nat(3),
  settings: fc.oneof({ weight: 3, arbitrary: startSettingsArb }, { weight: 1, arbitrary: askZeroArb }),
})
const endArb: fc.Arbitrary<Raw> = fc.record({ type: fc.constant('end' as const), pick: fc.nat() })
/** phoneForms의 마지막 형식 번호 (phoneForms는 함수 선언이라 여기서 부를 수 있다) */
const PHONE_FORM_LAST = phoneForms(0).length - 1
const badArb: fc.Arbitrary<Raw> = fc.record({
  type: fc.constant('bad' as const),
  kind: fc.constantFrom('extra' as const, 'ref' as const, 'memo' as const, 'text' as const, 'id' as const),
  base: fc.nat(),
  name: fc.nat(EXTRA_NAMES.length - 1),
  digits: fc.integer({ min: 0, max: 99_999_999 }),
  form: fc.nat(PHONE_FORM_LAST),
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
      name: fc.option(fc.constantFrom('핑크프릴', '라울', ...NOT_PHONE_TEXTS), { nil: null }),
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
  // S04 (AC-S04-92)
  { weight: 2, arbitrary: startArb },
  { weight: 1, arbitrary: endArb },
  { weight: 1, arbitrary: badArb },
)

/** 방송 고르기: 대부분 첫 방송, 가끔 다른 방송 */
const bselArb = fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: fc.nat(5) })

function makeScenarioArb(settings: fc.Arbitrary<SettingsOverride>, raws: fc.Arbitrary<Raw> = rawArb): fc.Arbitrary<Scenario> {
  // 빈 목록 = 서버처럼 빈 엔진에서 broadcast.start(b1)로 시작한다 (그 방송의 설정 = 시나리오 설정)
  return fc.tuple(fc.constantFrom<readonly BroadcastInfo[]>([B1], [B1], [B1, B2], [B1, B0919], [], []), settings).chain(([broadcasts, chosen]) =>
    fc
      .tuple(
        fc.array(fc.record({ type: fc.constant('register' as const), no, stock: fc.constantFrom(1, 1, 2), price: fc.constantFrom(5000, 10000), ready: fc.constantFrom(false, false, true) }), { minLength: 2, maxLength: 4 }),
        fc.array(
          fc.record({ raw: raws, dt: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 4000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 50_000 }) }), bsel: bselArb }),
          { minLength: 1, maxLength: 60, size: 'max' },
        ),
      )
      .map(([prefix, rest]) => {
        const opening: Entry[] = broadcasts.length > 0 ? [] : [{ raw: { type: 'start', slot: 0, day: 0, title: 0, settings: chosen }, dt: 0, bsel: 0 }]
        return { broadcasts, settings: broadcasts.length > 0 ? chosen : {}, entries: [...opening, ...prefix.map((raw) => ({ raw, dt: 0, bsel: 0 })), ...rest] }
      }),
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
  // 승계 ASK·대기 한도 0 방송을 자주 선언한다 (D-077)
  { weight: 1, arbitrary: fc.record({ type: fc.constant('start' as const), slot: fc.nat(START_IDS.length - 1), day: fc.nat(1), title: fc.constant(0), settings: askZeroArb }) },
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

/** 그 방송의 설정 스냅샷 */
const settingsOf = (state: EngineState, b: string): SaleSettings => (getBroadcast(state, b) as NonNullable<ReturnType<typeof getBroadcast>>).settings

/** 엔트리가 갈 방송: 정해 둔 방송, 아니면 선언된 방송 중 bsel번째 */
const broadcastFor = (state: EngineState, entry: Entry): string => entry.b ?? state.broadcasts[entry.bsel % Math.max(1, state.broadcasts.length)]?.id ?? START_IDS[0]

function materialize(state: EngineState, scenario: Scenario, entry: Entry, seq: number, at: number): EngineEvent {
  const raw = entry.raw
  const target = broadcastFor(state, entry)
  // bIds[0] = 이 엔트리의 방송 (S03까지는 첫 방송 하나였다)
  const bIds = [target, ...state.broadcasts.map((broadcast) => broadcast.id)]
  const b = target
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
      const date = (state.broadcasts[raw.day % state.broadcasts.length] as BroadcastInfo).date
      const buyer = buyerAt(raw.buyer)
      // 입금 메모·사유에 번호 아닌 숫자 글을 섞는다 (D-079 — 기록된다)
      const note = raw.mode === 0 ? undefined : (NOT_PHONE_TEXTS[(raw.amount + raw.mode) % NOT_PHONE_TEXTS.length] as string)
      if (raw.kind === 'payment') return { ...base, type: 'settlement.payment', buyer, date, amount: raw.amount, ...(note === undefined ? {} : { memo: note }) }
      if (raw.kind === 'refund') return { ...base, type: 'settlement.refund', buyer, date, amount: raw.amount, reason: note ?? '환불' }
      if (raw.kind === 'adjust') return { ...base, type: 'settlement.adjust', buyer, date, amount: -raw.amount, reason: note ?? '할인' }
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
    case 'start': {
      // 새 방송이면 선언, 이미 선언한 방송이면 사본(날짜·제목·설정이 달라도 아무 일도 없어야 한다)
      const id = START_IDS[raw.slot] as string
      // 제목 넷 중 둘은 날짜·금액이 섞인 번호 아닌 글 (D-079, SA-S04-007 — 방송이 시작된다)
      const title = [`${String(raw.title + 1)}부`, NOT_PHONE_TEXTS[0], `${String(raw.title + 1)}부`, NOT_PHONE_TEXTS[1]][raw.title] as string
      return { ...base, type: 'broadcast.start', b: id, date: START_DATES[raw.day] as string, title, settings: raw.settings }
    }
    case 'end':
      return { ...base, type: 'broadcast.end', b: (state.broadcasts[raw.pick % state.broadcasts.length] as BroadcastInfo).id }
    case 'bad':
      throw new Error('입력 오류 원료는 badEvent로 만든다')
  }
  void scenario
}

/**
 * 번호 8자리 → 글 칸에서 휴대폰 번호인 여러 형식 (R-1 "판매자가 적는 칸의 휴대폰 번호", D-079·D-080 — containsPhoneRun이 참):
 * 한 덩어리 11자리, `01X` 세 자리 덩어리 뒤에 구분자(공백·문장 부호·기호·자모 ㆍ)로 이은 7~8자리, 앞뒤에 다른 숫자·글자가 붙은 것, 전각
 */
function phoneForms(digits: number): readonly string[] {
  const d = String(digits).padStart(8, '0')
  const [head, tail] = [d.slice(0, 4), d.slice(4)]
  const full = `010${d}`
  const dashed = `010-${head}-${tail}`
  const wide = [...full].map((c) => String.fromCharCode(c.charCodeAt(0) - 0x30 + 0xff10)).join('')
  return [
    full,
    dashed,
    `010 ${head} ${tail}`,
    wide,
    `s${full}`,
    `김영희 010.${head}.${tail}`,
    `3시 ${dashed}`,
    `${dashed} 2개`,
    `15번 ${full}`,
    `+82 010-${head}-${tail}`,
    `3시,010,${head},${tail}`,
    `010ㆍ${head}ㆍ${tail}`,
    `010 ${d}`,
  ]
}
/** 문자찜 ref 형식(영문·숫자·`_`·`-`)에 맞는 휴대폰 번호 — 구조 검사는 통과하고 번호 검사만 걸린다 */
function refForms(digits: number): readonly string[] {
  const d = String(digits).padStart(8, '0')
  return [`010${d}`, `010-${d.slice(0, 4)}-${d.slice(4)}`, `s010${d}`, `r-010-${d.slice(0, 4)}-${d.slice(4)}-2`, `r_010_${d.slice(0, 4)}_${d.slice(4)}`, `x15-010${d}`]
}
/** ID 칸에서 휴대폰 번호인 값: 숫자와 구분자뿐이고 normalizePhone 결과가 있음 (looksLikePhoneId가 참) */
function idForms(digits: number): readonly string[] {
  const d = String(digits).padStart(8, '0')
  const [head, tail] = [d.slice(0, 4), d.slice(4)]
  return [`010${d}`, `010-${head}-${tail}`, `010 ${head} ${tail}`, `(010)${head}-${tail}`, `010.${head}.${tail}`, `０１０${d}`]
}
const pickForm = (forms: readonly string[], form: number): string => forms[form % forms.length] as string

/**
 * 기록되지 않는 이벤트 (AC-S04-06·07·92): 유효한 이벤트에 표에 없는 필드를 붙이거나(구조 오류 — checkEvent와 applyEvent 모두),
 * 판매자가 적는 글 칸·ID 칸에 휴대폰 번호를 넣는다(checkEvent만 — 재생은 처리한다, D-079 ⑤).
 * 짚어야 하는 필드 이름, 휴대폰 번호 문제인지와 함께 돌려준다
 */
function badEvent(
  state: EngineState,
  raw: Extract<Raw, { type: 'bad' }>,
  b: string,
  seq: number,
  at: number,
): { readonly event: Record<string, unknown>; readonly field: string; readonly phone: boolean } {
  const date = (state.broadcasts[0] as BroadcastInfo).date
  const sms = { seq, at, type: 'sms', b, ref: `x${String(seq)}`, no: 1, received: '20:00' }
  if (raw.kind === 'ref') return { event: { ...sms, ref: pickForm(refForms(raw.digits), raw.form) }, field: 'ref', phone: true }
  if (raw.kind === 'memo') return { event: { ...sms, memo: pickForm(phoneForms(raw.digits), raw.form) }, field: 'memo', phone: true }
  if (raw.kind === 'text') {
    const phone = pickForm(phoneForms(raw.digits), raw.form)
    const texts: readonly (readonly [Record<string, unknown>, string])[] = [
      [{ seq, at, type: 'host.cancel', b, no: 1, buyer: 'A', reason: phone }, 'reason'],
      [{ seq, at, type: 'host.reopen', b, no: 1, reason: phone }, 'reason'],
      [{ seq, at, type: 'buyer.merge', from: 'A', into: 'B', reason: phone }, 'reason'],
      [{ seq, at, type: 'settlement.refund', buyer: 'A', date, amount: 1000, reason: phone }, 'reason'],
      [{ seq, at, type: 'settlement.payment', buyer: 'A', date, amount: 1000, memo: phone }, 'memo'],
      [{ seq, at, type: 'product.register', b, no: 9, name: phone, price: 1000 }, 'name'],
      [{ seq, at, type: 'product.update', b, no: 1, name: phone }, 'name'],
      [{ seq, at, type: 'broadcast.start', b: 'z9', date: '2026-10-20', title: phone }, 'title'],
    ]
    const [event, field] = texts[raw.base % texts.length] as readonly [Record<string, unknown>, string]
    return { event, field, phone: true }
  }
  if (raw.kind === 'id') {
    const phone = pickForm(idForms(raw.digits), raw.form)
    const ids: readonly (readonly [Record<string, unknown>, string])[] = [
      [{ seq, at, type: 'host.blockBuyer', buyer: phone, reason: '노쇼' }, 'buyer'],
      [{ seq, at, type: 'host.cancel', b, no: 1, buyer: phone, reason: '사유' }, 'buyer'],
      [{ seq, at, type: 'host.assign', b, no: 1, buyer: 'A', reason: '사유', replace: phone, replaceTo: 'WAITLIST' }, 'replace'],
      [{ ...sms, buyer: phone }, 'buyer'],
      [{ seq, at, type: 'settlement.payment', buyer: phone, date, amount: 1000 }, 'buyer'],
      [{ seq, at, type: 'buyer.merge', from: phone, into: 'A', reason: '같은 사람' }, 'from'],
      [{ seq, at, type: 'buyer.merge', from: 'A', into: phone, reason: '같은 사람' }, 'into'],
      [{ seq, at, type: 'buyer.unmerge', from: phone, reason: '잘못' }, 'from'],
      [{ seq, at, type: 'host.convertMessage', b, msg: phone, no: 1 }, 'msg'],
    ]
    const [event, field] = ids[raw.base % ids.length] as readonly [Record<string, unknown>, string]
    return { event, field, phone: true }
  }
  const phone = pickForm(phoneForms(raw.digits), raw.form)
  const bases: readonly Record<string, unknown>[] = [
    { seq, at, type: 'chat', b, id: `bad${String(seq)}`, ch: 'A', nick: '가', text: '1' },
    sms,
    { seq, at, type: 'host.cancel', b, no: 1, buyer: 'A', reason: '사유' },
    { seq, at, type: 'settlement.payment', buyer: 'A', date, amount: 1000 },
    { seq, at, type: 'product.register', b, no: 9, name: 'x', price: 1000 },
    { seq, at, type: 'broadcast.start', b: 'z9', date: '2026-10-20', title: '새 방송' },
    { seq, at, type: 'broadcast.end', b },
  ]
  const event = { ...(bases[raw.base % bases.length] as Record<string, unknown>) }
  // 문자찜·입금의 memo는 표에 있는 필드(글 칸)다 — 표에 없는 필드를 만들려고 다른 이름으로 바꾼다
  const name = EXTRA_NAMES[raw.name] === 'memo' && (event.type === 'settlement.payment' || event.type === 'sms') ? 'note' : (EXTRA_NAMES[raw.name] as string)
  // 표에 없는 이름은 값과 상관없이 입력 오류
  const value = name === 'meta' ? { phone } : phone
  Object.defineProperty(event, name, { value, enumerable: true, writable: true, configurable: true })
  return { event, field: name, phone: false }
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
  /** 엔트리 번호 → 기록된 이벤트 번호 (입력 오류라 기록되지 않은 엔트리는 -1) */
  readonly eventOf: number[]
}

function runScenario(scenario: Scenario): Run {
  let state = initEngine({ broadcasts: scenario.broadcasts, settings: scenario.settings })
  const states = [state]
  const events: EngineEvent[] = []
  const emitted: (readonly string[])[] = []
  const eventOf: number[] = []
  let at = T0
  let seq = 0
  scenario.entries.forEach((entry) => {
    at += entry.dt
    if (entry.raw.type === 'bad') {
      // 기록 전 검사가 그 필드를 짚는다. 서버는 기록하지 않으므로 seq도 쓰지 않는다.
      // - 구조 오류(표에 없는 필드): applyEvent도 상태를 바꾸지 않고 입력 오류를 던진다.
      // - 판매자가 적는 칸의 휴대폰 번호: checkEvent만 문제(code PHONE_NUMBER)를 돌려주고 applyEvent는 처리한다 — 재생은 번호 검사를 하지 않는다(D-079 ⑤).
      //   처리한 결과는 버린다(기록되지 않은 이벤트).
      const { event, field, phone } = badEvent(state, entry.raw, broadcastFor(state, entry), seq + 1, at)
      const before = json(state)
      const problems = checkEvent(state, event)
      expect(problems.map((p) => p.field), json(event)).toContain(field)
      let thrown: unknown
      try {
        applyEvent(state, event as unknown as EngineEvent)
      } catch (error) {
        thrown = error
      }
      if (phone) {
        expect(problems, json(event)).toEqual([expect.objectContaining({ field, code: 'PHONE_NUMBER' })])
        expect(thrown, json(event)).toBeUndefined()
      } else {
        expect(isInvalidEvent(thrown), json(event)).toBe(true)
        expect(problems.some((p) => p.code === 'PHONE_NUMBER')).toBe(false)
      }
      expect(json(state)).toBe(before)
      eventOf.push(-1)
      return
    }
    seq += 1
    const event = materialize(state, scenario, entry, seq, at)
    // 로그에 남는 이벤트는 기록 전 검사를 통과한다 — 번호 아닌 숫자 글·영문이 섞인 ID 포함 (D-079)
    expect(checkEvent(state, event), json(event)).toEqual([])
    const result = applyEvent(state, event)
    state = result.state
    states.push(state)
    eventOf.push(events.length)
    events.push(event)
    emitted.push(result.effects.map((e) => e.id))
  })
  return { states, events, emitted, eventOf }
}

/** 관찰 값 (seq에서 나온 값은 뺀다: 찜의 seq, 취소 요청의 seq, 정산 기록의 seq). 방송 조회는 observeBroadcasts */
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
  // INV-8·INV-10: 확정이 풀리는 길 (설정은 그 찜의 방송 스냅샷, D-070)
  const released = after.filter((c) => before.get(c.id)?.status === 'CONFIRMED' && c.status !== 'CONFIRMED')
  for (const claim of released) {
    const was = before.get(claim.id) as ClaimInfo
    const host = HOST_RELEASE.has(event.type)
    const policy = settingsOf(prev, claim.broadcast)['contention.policy']
    if (was.locked) expect(host, `${where}: 잠긴 확정 찜 ${claim.id}이 방송자 조치 없이 풀렸다 (INV-10)`).toBe(true)
    if (host) continue
    if (event.type === 'chat' && claim.status === 'CANCELLED') {
      expect(settingsOf(prev, event.b)['cancel.buyerChat'], `${where}: 채팅이 확정을 풀었다`).toBe('AUTO')
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
      expect(compareRank(material(fresh[i - 1] as ClaimInfo), material(fresh[i] as ClaimInfo), settingsOf(next, product.broadcast)), `${where}: ${product.key} 대기 순서`).toBeLessThan(0)
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
        expect(compareRank(material(byVersion[i - 1] as ClaimInfo), material(byVersion[i] as ClaimInfo), settingsOf(next, (byVersion[i] as ClaimInfo).broadcast)), `${where}: 공개 순간 확정 순서`).toBeLessThan(0)
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

  // 게시 전 감사 문구 (R-13, D-RETRO-02): 문구가 바뀌는 것은 고침 따라가기(thanks.followEdits)를 켠 방송의 상품 수정(product.update)에서
  // 실행 전이던 감사 효과뿐이다 — 완료·취소된 효과와 켜지 않은 방송의 효과 문구는 그대로.
  // 켠 방송에서 지금 확정(확정버전)의 실행 전 감사 문구는 늘 지금 품종·그 찜의 지금 단가로 만든 앞머리로 시작하고 끝말은 그대로다
  const prevEffect = new Map(prevEffects.map((e) => [e.id, e]))
  const productByKey = new Map(listProducts(next).map((p) => [p.key, p]))
  for (const effect of nextEffects) {
    const was = prevEffect.get(effect.id)
    const claim = claims.get(effect.claim)
    const follows = claim !== undefined && settingsOf(next, claim.broadcast)['thanks.followEdits'] === true
    if (was !== undefined && was.text !== effect.text) {
      expect([event.type, was.status, effect.status, effect.kind, follows], `${where}: 효과 ${effect.id}의 문구가 바뀌었다`).toEqual(['product.update', 'PENDING', 'PENDING', 'POST_THANKS', true])
    }
    if (!follows || effect.kind !== 'POST_THANKS' || effect.status !== 'PENDING' || claim.status !== 'CONFIRMED' || claim.confirmVersion !== effect.confirmVersion) continue
    const product = productByKey.get(claim.product)
    const head = formatThanksHead({ no: claim.no, name: product?.name ?? '', price: claim.price as number, optionText: claim.variant, qty: claim.qty })
    expect((effect.text ?? '').startsWith(head), `${where}: 효과 ${effect.id}의 문구 '${String(effect.text)}'가 지금 품종·단가 '${head}'로 시작하지 않는다`).toBe(true)
    expect((effect.text ?? '').endsWith('님 구매 감사합니다'), `${where}: 효과 ${effect.id}의 끝말`).toBe(true)
  }

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

  // 대기 수 ≤ 그 상품 방송의 대기 한도 (매 이벤트 뒤, AC-S03b-92·AC-S04-92). 대기 한도 0 방송에는 "승계 결정 필요"가 없다 (D-077)
  for (const product of listProducts(next)) {
    const settings = settingsOf(next, product.broadcast)
    expect(product.waitlist.length, `${where}: ${product.key} 대기 한도`).toBeLessThanOrEqual(settings['waitlist.max'])
    if (settings['waitlist.max'] === 0) expect(product.awaitingSuccession, `${where}: ${product.key} 대기 한도 0인데 승계 결정 필요`).toBe(false)
  }

  // 1등 자리를 비우는 이벤트는 승계 AUTO(그리고 대기 한도 0의 ASK, D-077)에서, 재고 늘림은 늘 새 REJECTED(SOLD_OUT)을 만들지 않는다 (D-068)
  const soldOut = after.filter((c) => c.status === 'REJECTED' && c.reason === 'SOLD_OUT' && before.has(c.id) && !(before.get(c.id)?.status === 'REJECTED'))
  const cancelOnly = event.type === 'chat' && parseChat(event.text, settingsOf(next, event.b)).claims.length === 0
  const vacating = event.type === 'host.cancel' || event.type === 'host.reject' || event.type === 'host.approveCancel' || cancelOnly
  const succession = vacating ? settingsOf(prev, event.b) : undefined
  const autoLike = succession !== undefined && (succession['cancel.succession'] === 'AUTO' || (succession['cancel.succession'] === 'ASK' && succession['waitlist.max'] === 0))
  if (event.type === 'product.update' || autoLike) {
    expect(soldOut.map((c) => c.id), `${where}: 자리를 비우는 이벤트가 품절을 만들었다`).toEqual([])
  }

  // 아무것도 바꾸지 않는 조치 (AC-S03b-92·AC-S04-92): 주문·취소였던 메시지의 변환, 충돌 중 host.assign, 방송 시작 사본, 이미 끝난 방송의 종료
  const message = event.type === 'host.convertMessage' ? pget(prev.messages, JSON.stringify([event.b, event.msg])) : undefined
  if (message?.order === true) expect(next, `${where}: 주문이었던 메시지를 변환했다 (D-062)`).toBe(prev)
  if (message?.cancel === true) expect(next, `${where}: 취소였던 메시지를 변환했다 (D-076)`).toBe(prev)
  if (event.type === 'broadcast.start') {
    const existing = getBroadcast(prev, event.b)
    if (existing !== null) expect(next, `${where}: 이미 선언한 방송의 broadcast.start가 상태를 바꿨다 (D-070)`).toBe(prev)
    else {
      // 새 방송: 선언 순서 끝에 더해지고 스냅샷은 기본값 위에 그 이벤트의 설정, 나머지 조회는 그대로
      expect(listBroadcasts(next), where).toEqual([...listBroadcasts(prev), { id: event.b, date: event.date, title: event.title, ended: false, endedAt: null, settings: resolveSettings(event.settings), focus: null }])
      expect(json(observe(next)), where).toBe(json(observe(prev)))
    }
  }
  if (event.type === 'broadcast.end') {
    if (getBroadcast(prev, event.b)?.ended === true) expect(next, `${where}: 이미 끝난 방송의 broadcast.end가 상태를 바꿨다`).toBe(prev)
    else {
      // 끝난 기록만: 그 방송의 끝남·끝난 시각 밖의 조회는 그대로, 효과 없음
      expect(getBroadcast(next, event.b), where).toMatchObject({ ended: true, endedAt: event.at })
      expect(json(observe(next)), where).toBe(json(observe(prev)))
      expect(emitted, where).toEqual([])
    }
  }
  if (event.type === 'host.assign' && pget(prev.slots, `${event.b}/${String(event.no)}`)?.conflict != null) {
    expect(next, `${where}: 충돌 중에 배정했다 (D-064)`).toBe(prev)
  }
  // 합친 다른 구매자의 찜에 대한 시청자 채팅 취소는 찜·요청·상품·효과를 바꾸지 않는다 (D-063)
  if (cancelOnly) {
    const targets = parseChat(event.text, settingsOf(next, event.b)).cancels.map((n) => activeClaimId(prev, event.b, n, event.ch))
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

  const copyable = (scenario: Scenario): number[] => scenario.entries.flatMap((entry, i) => (entry.raw.type === 'chat' || entry.raw.type === 'sms' || entry.raw.type === 'start' ? [i] : []))

  it('INV-3·INV-12: 채팅·문자찜(같은 ref)·방송 시작(같은 방송 ID)의 사본을 첫 수신 뒤 아무 위치에(내용을 바꿔) 끼워 넣어도 관찰 값이 같다', () => {
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
          // 사본은 원본과 같은 방송으로 (채팅 메시지 ID는 방송 안에서 유일하다)
          const sourceEvent = original.events[original.eventOf[i] as number] as EngineEvent & { readonly b?: string }
          // ref는 처음 받을 때 기록한다 — 모르는 지정 구매자라 구매자를 정하지 않은 문자찜의 사본도 아무 일도 없다 (D-067, S03의 건너뛰기를 없앴다)
          const entries = [...scenario.entries]
          const positions = copies.map(([n, variant, shift]) => ({ at: i + 1 + (n % (scenario.entries.length - i)), variant, shift })).sort((a, b) => b.at - a.at)
          for (const { at, variant, shift } of positions) {
            const raw: Raw =
              source.type === 'chat'
                ? { ...source, text: ['15', '1 취소', '안녕', '2'][variant % 4] as string, nick: variant % 3, published: source.published + shift }
                : source.type === 'sms'
                  ? { ...source, no: NOS[variant % 3] as number, memo: (variant % 4) - 1, phone: (variant % (PHONES.length + 1)) - 1, received: source.received + shift, designate: (variant % 10) - 1 }
                  : source.type === 'start'
                    ? { ...source, day: variant % 2, title: variant % 4, settings: { 'waitlist.max': variant % 3, 'claim.parseMode': variant % 2 === 0 ? 'LOOSE' : 'STRICT', 'shipping.baseFee': variant % 100_000 } }
                    : source
            entries.splice(at, 0, { raw, dt: 0, bsel: 0, ...(sourceEvent.b === undefined ? {} : { b: sourceEvent.b }) })
          }
          const withCopies = runScenario({ ...scenario, entries })
          expect(json(observe(withCopies.states.at(-1) as EngineState))).toBe(json(observe(original.states.at(-1) as EngineState)))
          expect(listBroadcasts(withCopies.states.at(-1) as EngineState)).toEqual(listBroadcasts(original.states.at(-1) as EngineState))
        },
      ),
      PARAMS,
    )
  })
})

// ── AC-S04-92: 로그 전체 ─────────────────────────────────────────────────

describe('AC-S04-92 로그 전체 속성 (방송 시작·종료)', () => {
  it('INV-4: broadcast.start로 시작한 로그(빈 엔진)를 처음부터 재생한 상태 = 이벤트마다 이어 온 상태, 같은 로그면 매번 같다', () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.broadcasts.length === 0),
        (scenario) => {
          const run = runScenario(scenario)
          expect(run.events[0]?.type).toBe('broadcast.start')
          // 서버의 재생: initEngine({ broadcasts: [], settings: {} })부터 기록된 이벤트 그대로
          let replayed = initEngine({ broadcasts: [], settings: {} })
          for (const event of JSON.parse(json(run.events)) as EngineEvent[]) replayed = applyEvent(replayed, event).state
          expect(json(replayed)).toBe(json(run.states.at(-1)))
          expect(json(runScenario(scenario).states.at(-1))).toBe(json(replayed))
        },
      ),
      { numRuns: 150 },
    )
  })

  it('broadcast.end를 모두 뺀 로그와 방송 조회 밖의 조회 결과가 같다 (끝난 기록은 판정·정산·효과를 바꾸지 않는다)', () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.entries.some((entry) => entry.raw.type === 'end')),
        (scenario) => {
          const run = runScenario(scenario)
          let state = initEngine({ broadcasts: scenario.broadcasts, settings: scenario.settings })
          for (const event of run.events) if (event.type !== 'broadcast.end') state = applyEvent(state, event).state
          const full = run.states.at(-1) as EngineState
          expect(json(observe(state))).toBe(json(observe(full)))
          expect(listBroadcasts(state).map(({ ended: _e, endedAt: _a, ...rest }) => rest)).toEqual(listBroadcasts(full).map(({ ended: _e, endedAt: _a, ...rest }) => rest))
        },
      ),
      { numRuns: 150 },
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
  // 취소였던 메시지도 어느 번호로도 바꾸지 않는다 (D-076). 이미 선언한 방송의 broadcast.start, 이미 끝난 방송의 broadcast.end (D-070)
  for (const broadcast of listBroadcasts(state)) {
    out.push({ type: 'broadcast.start', b: broadcast.id, date: '2026-10-20', title: '다른 제목', settings: { 'waitlist.max': 0, 'claim.parseMode': 'LOOSE' } })
    out.push({ type: 'broadcast.start', b: broadcast.id, date: broadcast.date, title: broadcast.title })
    if (broadcast.ended) out.push({ type: 'broadcast.end', b: broadcast.id })
  }
  for (const [key, message] of pentries(state.messages)) {
    if (!message.order && !message.cancel) continue
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
        // 서버의 changed = (돌려받은 상태 !== 넘긴 상태) — 맞지 않는 명령은 같은 상태 객체를 돌려준다 (문자찜은 ref를 처음 받을 때 기록하므로 뺀다, D-067)
        if (command.type !== 'sms') expect(result.state, `같은 상태 객체여야 한다: ${json(command)}`).toBe(state)
      }),
      PARAMS,
    )
  })
})

// ── AC-S03-02: 검사 함수와 applyEvent의 판정이 같다 ──────────────────────

const VALID_EVENTS: readonly Record<string, unknown>[] = [
  { type: 'broadcast.start', b: 'b7', date: '2026-10-20', title: '7부', settings: { 'waitlist.max': 2, 'shipping.freeThreshold': null, 'claim.maxNumber': 9999 } },
  { type: 'broadcast.start', b: 'b1', date: '2026-10-18', title: '' },
  { type: 'broadcast.end', b: 'b1' },
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
  // S04: 표에 없는 필드(값과 상관없이, undefined여도 — D-073), 판매자가 적는 글 칸·ID 칸의 휴대폰 번호(D-079), 설정 스냅샷 키·값·범위 (D-071)
  fc.record({ kind: fc.constant('named' as const), field: fc.constantFrom(...EXTRA_NAMES, 'seq2', 'B', 'settings'), value: fc.constantFrom<unknown>(undefined, null, '010-1234-5678', { phone: '01012345678' }, 1) }),
  fc.record({
    kind: fc.constant('phone' as const),
    field: fc.constantFrom('ref', 'memo', 'reason', 'name', 'title', 'buyer', 'from', 'into', 'replace', 'msg', 'id', 'ch', 'nick', 'text'),
    digits: fc.integer({ min: 0, max: 99_999_999 }),
    form: fc.nat(PHONE_FORM_LAST),
  }),
  fc.record({
    kind: fc.constant('setting' as const),
    key: fc.constantFrom('waitlist.max', 'claim.maxNumber', 'claim.preOpenWindowSec', 'shipping.baseFee', 'shipping.freeThreshold', 'thanks.batchWindowSec', 'claim.ignoreOwner', 'cancel.succession', 'settlement.groupBy', 'waitlist.maxx'),
    value: fc.constantFrom<unknown>(0, -1, 1, 100, 101, 300, 301, 600, 601, 9999, 10_000, 1_000_000, 1_000_001, 100_000_000, 100_000_001, 1.5, Number.NaN, '5', null, true, 'ASK', 'MANUAL', 'DATE', undefined),
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
          else if (m.kind === 'named') {
            event = { ...event }
            Object.defineProperty(event, m.field, { value: m.value, enumerable: true, writable: true, configurable: true })
          } else if (m.kind === 'phone') event = { ...event, [m.field]: pickForm([...phoneForms(m.digits), ...refForms(m.digits), ...idForms(m.digits)], m.form * 3 + m.digits) }
          else if (m.kind === 'setting') {
            const current = event.settings
            event = { ...event, settings: { ...(typeof current === 'object' && current !== null ? current : {}), [m.key]: m.value } }
          } else event = { ...event, extraField: m.value }
        }
        const before = json(state)
        const problems = checkEvent(state, event)
        let thrown: unknown
        try {
          applyEvent(state, event as unknown as EngineEvent)
        } catch (error) {
          thrown = error
        }
        // 휴대폰 번호 문제(code PHONE_NUMBER)는 기록 전 검사만 — 재생(applyEvent)은 번호 검사를 하지 않는다 (D-079 ⑤). 그 밖의 입력 오류는 판정이 같다
        const shape = problems.filter((p) => p.code !== 'PHONE_NUMBER')
        expect(isInvalidEvent(thrown), json(event)).toBe(shape.length > 0)
        if (isInvalidEvent(thrown)) expect((thrown as InvalidEventError).problems).toEqual(shape)
        expect(json(state)).toBe(before)
        // 입력 오류도 미구현도 아니면 예외가 없다 (미구현은 effect.failed와 MANUAL 설정뿐)
        if (shape.length === 0 && thrown !== undefined) expect(isNotImplemented(thrown), `${json(event)}: ${String(thrown)}`).toBe(true)
        // 번호 문제는 글 칸이면 containsPhoneRun, ID 칸이면 looksLikePhoneId가 참인 칸에만 (시청자 쪽 값 id·ch·nick·text에는 없다)
        for (const p of problems.filter((x) => x.code === 'PHONE_NUMBER')) {
          const value = event[p.field as string] as string
          expect(['ref', 'memo', 'reason', 'name', 'title', 'buyer', 'from', 'into', 'replace', 'msg'], json(event)).toContain(p.field)
          expect(['buyer', 'from', 'into', 'replace', 'msg'].includes(p.field as string) ? looksLikePhoneId(value) : containsPhoneRun(value), json(event)).toBe(true)
        }
      }),
      { numRuns: 400 },
    )
  })

  it('속성 (S04): 유효한 이벤트에 임의 이름의 필드를 더하면 입력 오류이고 checkEvent가 그 필드를 짚는다, ref·memo의 휴대폰 번호(여러 형식)는 checkEvent만 거절하고 applyEvent는 처리한다 (AC-S04-06·07, D-079 ⑤)', () => {
    // R-1 표에 있는 필드 이름 (어느 종류에든) — 무작위 이름이 그중 하나면 건너뛴다
    const known = new Set(['type', 'seq', 'at', 'b', 'no', 'name', 'price', 'stock', 'status', 'applyTo', 'from', 'to', 'id', 'ch', 'nick', 'text', 'owner', 'publishedAt', 'ref', 'received', 'memo', 'phoneKey', 'phoneLast4', 'buyer', 'phone', 'reason', 'replace', 'replaceTo', 'decision', 'msg', 'into', 'effectId', 'date', 'mode', 'amount', 'title', 'settings'])
    fc.assert(
      fc.property(scenarioArb, fc.nat(), fc.string({ minLength: 1, maxLength: 12 }), fc.anything(), fc.integer({ min: 0, max: 99_999_999 }), fc.nat(PHONE_FORM_LAST), (scenario, pick, name, value, digits, form) => {
        const state = runScenario(scenario).states.at(-1) as EngineState
        const valid: Record<string, unknown> = { ...(VALID_EVENTS[pick % VALID_EVENTS.length] as Record<string, unknown>), seq: 999, at: T0 + 10_000_000 }
        const before = json(state)
        if (!known.has(name)) {
          const event = { ...valid }
          Object.defineProperty(event, name, { value, enumerable: true, writable: true, configurable: true })
          expect(checkEvent(state, event).map((p) => p.field), name).toContain(name)
          expect(() => applyEvent(state, event as unknown as EngineEvent)).toThrow(InvalidEventError)
        }
        for (const [field, phone] of [
          ['ref', pickForm(refForms(digits), form)],
          ['memo', pickForm(phoneForms(digits), form)],
        ] as const) {
          const sms = { seq: 999, at: T0 + 10_000_000, type: 'sms', b: 'b1', ref: 'r9', no: 1, received: '20:00', [field]: phone }
          expect(checkEvent(state, sms), `${field}: ${phone}`).toEqual([expect.objectContaining({ field, code: 'PHONE_NUMBER' })])
          expect(() => applyEvent(state, sms as unknown as EngineEvent), `${field}: ${phone}`).not.toThrow()
        }
        expect(json(state)).toBe(before)
      }),
      { numRuns: 300 },
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
