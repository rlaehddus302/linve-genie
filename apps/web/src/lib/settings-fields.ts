// 판매 규칙 칸 (SPEC §7 화면 8, DOMAIN_RULES 설정표, D-I3-08, AC-I3-45·46·10). 화면에는 설정 키·영문 값이 없다 — 칸 이름과 선택지 낱말만.
// settlement.groupBy(직접 묶기, D-059)·print.autoOnConfirm(I1)은 보이지 않고 보내지도 않는다.
// 숫자 칸은 적은 글자를 그대로 정수로 읽어 보낸다 — 범위 검사는 서버(코어 checkSettings)가 하고 그 문장을 칸 옆에 보인다.
import { PRICE_UNITS, formatWon, isPriceUnit, parseAmount, type PriceUnit, type SaleSettings } from '@livejjim/core'

/** 가격 단위 안내 (FB1 D-FB1-11 (5), AC-FB1-01) — 단위를 붙인 글은 설정과 상관없이 읽힌다(R-14 4) */
export const PRICE_UNIT_HINT = "'2만'·'15000원'처럼 단위를 붙여 적으면 이 설정과 상관없이 적힌 대로 들어가요."
/** 가격 단위 낱말 (AC-FB1-01) — 선택지 순서는 코어 PRICE_UNITS(원·천원·만원) */
export const PRICE_UNIT_WORDS: Readonly<Record<PriceUnit, string>> = {
  WON: '원 (15000 → 15,000원)',
  THOUSAND: '천원 (15 → 15,000원)',
  TEN_THOUSAND: '만원 (15 → 150,000원)',
}
/** 저장된 값과 다른 가격 단위를 골랐을 때(저장 전) 고르기 아래 확인 문장 (AC-FB1-01) */
export const PRICE_UNIT_CHANGE: Readonly<Record<PriceUnit, string>> = {
  WON: "저장하면 다음 방송부터 숫자를 원 그대로 읽어요('15000' → 15,000원). 이미 등록한 상품 가격은 바뀌지 않아요.",
  THOUSAND: "저장하면 다음 방송부터 '15'는 15,000원으로 들어가요. 이미 등록한 상품 가격은 바뀌지 않아요.",
  TEN_THOUSAND: "저장하면 다음 방송부터 '15'는 150,000원으로 들어가요. 이미 등록한 상품 가격은 바뀌지 않아요.",
}
/** 여러 번호 예시 — 채팅 한 줄 모양 (FB1 D-FB1-12, AC-FB1-07) */
export const MULTI_NUMBER_EXAMPLE = { author: '@홍길동', text: '132 475' } as const
/** 배송비 칸 안내 (FB1 D-FB1-02 (1)) */
export const SHIPPING_HINT = '배송비는 그날 첫 방송을 시작할 때의 값으로 정산해요. 오늘 방송을 이미 시작했으면 바꾼 배송비는 내일부터 적용돼요.'
/** 접는 단추 이름 (FB1 D-FB1-18 (c) — 옛 "상세 설정" 하나를 칸마다 나눔). 보이는 글 뒤 화살표는 aria-hidden */
export const RULES_DETAIL = '판매 규칙 상세 설정'
export const THANKS_DETAIL = '감사 메시지 상세 설정'
export const DETAIL_CLOSED_ARROW = '▼'
export const DETAIL_OPEN_ARROW = '▲'
export const DETAIL_SETTINGS_NOTE = '잘 모르면 그대로 두세요.'

export type FieldPlace = 'basic' | 'more' | 'shipping' | 'thanks'

interface Base<K extends keyof SaleSettings> {
  readonly key: K
  readonly label: string
  readonly place: FieldPlace
  /** 칸 이름 바로 아래 채팅 한 줄 모양 예시 (FB1 D-FB1-12) — 글쓴이와 글은 다른 요소 */
  readonly leadChat?: { readonly author: string; readonly text: string }
  /** 칸 아래 늘 보이는 안내 (FB1 D-FB1-01·02) */
  readonly hint?: string
}

export interface IntField extends Base<'waitlist.max' | 'claim.maxNumber' | 'claim.preOpenWindowSec' | 'thanks.batchWindowSec'> {
  readonly kind: 'int'
  /** 칸 뒤 단위 (명·초) */
  readonly unit?: string
}

export interface MoneyField extends Base<'shipping.baseFee' | 'shipping.freeThreshold'> {
  readonly kind: 'money'
  /** 비우면 없음 (null) */
  readonly nullable: boolean
}

export interface ChoiceField extends Base<
  | 'cancel.succession'
  | 'cancel.buyerChat'
  | 'price.unit'
  | 'claim.parseMode'
  | 'claim.multiNumber'
  | 'contention.policy'
  | 'contention.sameMinuteTieBreaker'
  | 'thanks.videoComment'
> {
  readonly kind: 'choice'
  readonly options: readonly { readonly value: string; readonly word: string }[]
}

export interface BoolField extends Base<'claim.ignoreOwner' | 'thanks.liveChat'> {
  readonly kind: 'bool'
}

export type FieldDef = IntField | MoneyField | ChoiceField | BoolField
export type RuleKey = FieldDef['key']

export const FIELDS: readonly FieldDef[] = [
  { key: 'waitlist.max', label: '대기 인원 (0이면 대기 없음)', place: 'basic', kind: 'int', unit: '명' },
  {
    key: 'cancel.succession',
    label: '1등이 취소되면',
    place: 'basic',
    kind: 'choice',
    options: [
      { value: 'AUTO', word: '대기 1순위가 바로 1등' },
      { value: 'ASK', word: '내가 골라요' },
      { value: 'REOPEN', word: '대기를 정리하고 다시 판매' },
    ],
  },
  {
    key: 'cancel.buyerChat',
    label: '시청자가 채팅으로 취소하면',
    place: 'basic',
    kind: 'choice',
    options: [
      { value: 'OFF', word: '받지 않아요' },
      { value: 'REQUEST', word: '내가 확인하고 처리해요' },
      { value: 'AUTO', word: '바로 취소해요' },
    ],
  },
  {
    key: 'price.unit',
    label: '가격 단위',
    place: 'basic',
    kind: 'choice',
    // FB1 D-FB1-11: 원·천원(기본)·만원 — 단위 없는 숫자에만 곱한다, 한글 단위·'원'은 price.unit과 상관없이 읽힌다(R-14 4)
    options: PRICE_UNITS.map((value) => ({ value, word: PRICE_UNIT_WORDS[value] })),
    hint: PRICE_UNIT_HINT,
  },
  {
    key: 'claim.parseMode',
    label: '주문 인식 방식',
    place: 'more',
    kind: 'choice',
    options: [
      { value: 'STRICT', word: '엄격하게 ("15", "15번"처럼 번호만 쓴 채팅만 주문)' },
      { value: 'LOOSE', word: '느슨하게 (번호가 들어간 채팅을 더 넓게 주문으로 봐요)' },
    ],
  },
  {
    key: 'claim.multiNumber',
    label: '한 채팅에 번호가 여러 개면',
    place: 'more',
    kind: 'choice',
    leadChat: MULTI_NUMBER_EXAMPLE,
    options: [
      { value: 'ALL', word: '모두 주문 (132번·475번 둘 다 찜)' },
      { value: 'FIRST', word: '첫 번호만 주문 (132번만 찜)' },
      { value: 'IGNORE', word: '주문으로 보지 않아요 (둘 다 찜 아님)' },
    ],
  },
  { key: 'claim.maxNumber', label: '주문으로 볼 가장 큰 번호', place: 'more', kind: 'int' },
  { key: 'claim.ignoreOwner', label: '내 채널이 쓴 채팅은 주문으로 보지 않기', place: 'more', kind: 'bool' },
  { key: 'claim.preOpenWindowSec', label: '상품 등록 전에 온 찜을 인정하는 시간 (초)', place: 'more', kind: 'int', unit: '초' },
  {
    key: 'contention.policy',
    label: '유튜브 찜과 문자찜이 겨루면',
    place: 'more',
    kind: 'choice',
    options: [
      { value: 'ARRIVAL', word: '먼저 들어온 순서' },
      { value: 'RECEIVED_TIME', word: '실제 받은 시각 순서' },
    ],
  },
  {
    key: 'contention.sameMinuteTieBreaker',
    // FB1 D-FB1-13 (사용자 결정): 판매자가 쓰는 말 "댓글찜", 괄호 조건은 뺌 — 규칙(R-6)·선택지 그대로
    label: '문자찜과 댓글찜이 동시에(같은 1분 안에) 들어오면',
    place: 'more',
    kind: 'choice',
    options: [
      { value: 'YOUTUBE', word: '유튜브 먼저' },
      { value: 'SMS', word: '문자 먼저' },
      { value: 'HOST', word: '내가 정해요' },
    ],
  },
  { key: 'shipping.baseFee', label: '기본 배송비 (원)', place: 'shipping', kind: 'money', nullable: false },
  { key: 'shipping.freeThreshold', label: '무료배송 기준 금액 (원, 비우면 없음)', place: 'shipping', kind: 'money', nullable: true },
  // FB1 D-FB1-14 (사용자 결정): 감사 만들기는 채팅 체크 한 줄 (설명 줄 없음)
  { key: 'thanks.liveChat', label: '찜이 확정될 때마다 채팅에 감사 메시지 남기기', place: 'thanks', kind: 'bool' },
  {
    key: 'thanks.videoComment',
    // 화면에서 새로 켤 수 없다(FB1 D-FB1-14) — 켜 둔 판매자에게만 끄기 한 줄(ThanksSettings). 이 낱말은 마법사 요약에 쓴다
    label: '영상 댓글',
    place: 'thanks',
    kind: 'choice',
    options: [
      { value: 'OFF', word: '남기지 않음' },
      { value: 'PER_SALE', word: '판매마다 댓글' },
      { value: 'SUMMARY', word: '방송이 끝나고 요약 댓글 1개' },
    ],
  },
  { key: 'thanks.batchWindowSec', label: '몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)', place: 'thanks', kind: 'int', unit: '초' },
]

export const fieldOf = (key: RuleKey): FieldDef => FIELDS.find((field) => field.key === key) as FieldDef

export const fieldsAt = (place: FieldPlace): readonly FieldDef[] => FIELDS.filter((field) => field.place === place)

/** 칸에 들고 있는 값: 숫자 칸은 적은 글자, 선택·켜기는 값 그대로 */
export type Draft = Readonly<Partial<Record<RuleKey, string | boolean>>>

/** 저장된 설정 → 칸 값 */
export function draftOf(settings: SaleSettings, fields: readonly FieldDef[] = FIELDS): Draft {
  const draft: Partial<Record<RuleKey, string | boolean>> = {}
  for (const field of fields) {
    const value = settings[field.key]
    if (field.kind === 'bool') draft[field.key] = value === true
    else if (field.kind === 'choice') draft[field.key] = String(value)
    else draft[field.key] = value === null ? '' : String(value)
  }
  return draft
}

const INT_RE = /^[-+]?\d+(\.\d+)?$/

/** 칸 값 → 보낼 값. 숫자로 읽지 못한 글자는 그대로 보내 서버 문장을 받는다(화면이 범위를 따로 거르지 않는다) */
export function payloadOf(field: FieldDef, value: string | boolean | undefined): unknown {
  if (field.kind === 'bool') return value === true
  if (field.kind === 'choice') return value
  const text = typeof value === 'string' ? value.trim() : ''
  if (field.kind === 'money') {
    if (text === '') return field.nullable ? null : text
    const compact = text.replace(/,/g, '')
    if (INT_RE.test(compact)) return Number(compact)
    // "4천"·"1만 2천"처럼 적어도 원 단위로 읽는다 (천원 단위 설정을 쓰지 않는다)
    return parseAmount(text, { 'price.unit': 'WON' }) ?? text
  }
  const compact = text.replace(/,/g, '')
  return INT_RE.test(compact) ? Number(compact) : text
}

/** 저장된 값과 다른 칸만 (바뀐 키만 보낸다, AC-I3-46) */
export function changedSettings(fields: readonly FieldDef[], draft: Draft, saved: SaleSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const next = payloadOf(field, draft[field.key])
    if (!Object.is(next, saved[field.key])) out[field.key] = next
  }
  return out
}

/** 저장하기 전에도 보이는 경고 한 줄 (AC-I3-45) */
export function fieldWarning(field: FieldDef, value: string | boolean | undefined): string | null {
  if (field.key === 'claim.parseMode' && value === 'LOOSE') return "느슨하게 하면 '15번 예뻐요' 같은 채팅도 주문이 될 수 있어요."
  if (field.key === 'cancel.buyerChat' && value === 'AUTO') return '장난 취소도 바로 처리돼요.'
  return null
}

/** 고른 값이 저장된 값과 다를 때(저장 전) 고르기 아래 확인 한 줄 — 지금은 가격 단위만 (AC-FB1-01). 같으면 null */
export function fieldChangeNote(field: FieldDef, value: string | boolean | undefined, saved: unknown): string | null {
  if (field.key !== 'price.unit' || saved === undefined || value === saved || !isPriceUnit(value)) return null
  return PRICE_UNIT_CHANGE[value]
}

export const SAVED_MESSAGE = '저장했어요. 다음에 시작하는 방송부터 적용돼요.'
// FB1 D-FB1-02 (1): 배송비 저장 문장은 저장 막대 문장과 같은 뜻으로 (시작 마법사가 쓴다)
export const SAVED_SHIPPING_MESSAGE = '저장했어요. 다음에 시작하는 방송부터 적용돼요. 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요.'
export const ONGOING_NOTICE = '진행 중인 방송에는 바뀐 규칙이 적용되지 않아요.'

/** 마법사 2단계의 한 줄 값 낱말 (AC-I3-52): "대기 인원: 5명", "기본 배송비: 4,000원", "무료배송 기준: 없음" */
export function valueWords(field: FieldDef, settings: SaleSettings): string {
  const value = settings[field.key]
  if (field.kind === 'bool') return value === true ? '켜짐' : '꺼짐'
  if (field.kind === 'choice') return field.options.find((option) => option.value === value)?.word ?? String(value)
  if (value === null) return '없음'
  if (field.kind === 'money') return formatWon(Number(value))
  return `${formatWon(Number(value)).replace(/원$/, '')}${field.unit ?? ''}`
}
