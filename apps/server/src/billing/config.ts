// 요금 운영 설정 (BILLING_RULES BL-0 7·BL-1, D-N5-12, AC-N5-11).
// - 요금 기능 스위치: LIVEJJIM_BILLING=on|off (기본 꺼짐).
// - 요금 표: LIVEJJIM_BILLING_PRICES = JSON 파일 경로 (없으면 BL-1 기본 표 — 자리 표시 값). 형식이 틀리면 기동하지 않는다(꺼져 있어도).
// - 포트원 V2 설정: PORTONE_STORE_ID·PORTONE_CHANNEL_KEY(공개 값)·PORTONE_API_SECRET·PORTONE_WEBHOOK_SECRET(비밀값 — 화면·응답·로그·DB에 나가지 않는다).
// - 운영 기동은 요금 기능이 켜져 있는데 요금 표가 자리 표시이거나 포트원 설정이 하나라도 비어 있으면 기동하지 않는다.
// 오류 문장에 환경변수 값·비밀값을 넣지 않는다.
import { readFileSync } from 'node:fs'
import { isPlainObject, ownKeys, own, hasControlChar } from '../api-fields.ts'
import { PASS_KINDS, isQuantityKind, type PassKind } from './rules.ts'

/** 요금 표 항목 (BL-1) */
export interface PriceItem {
  /** 영문 소문자·숫자·`-` 1~32자 */
  readonly id: string
  /** 1~30자 */
  readonly name: string
  readonly kind: PassKind
  /** 정량만 1~100,000 정수, 정액은 null */
  readonly quantity: number | null
  /** 원, 부가가치세 포함, 100~10,000,000 정수 */
  readonly price: number
  /** 판매 중인지 */
  readonly onSale: boolean
}

export interface PriceTable {
  /** 자리 표시 값 (D-014 — 운영 가격이 아니다). 운영 기동은 켜진 요금 기능에 자리 표시 표를 받지 않는다 */
  readonly placeholder: boolean
  readonly items: readonly PriceItem[]
}

export const PRICE_ID_RE = /^[a-z0-9-]{1,32}$/
export const PRICE_NAME_MAX = 30
export const QUANTITY_MIN = 1
export const QUANTITY_MAX = 100_000
export const PRICE_MIN = 100
export const PRICE_MAX = 10_000_000

/** BL-1 기본 요금 표 (자리 표시 값 — 숫자는 D-014에서 사용자가 정한다) */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  placeholder: true,
  items: [
    { id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', quantity: null, price: 30_000, onSale: true },
    { id: 'days-1', name: '방송 일권 1일', kind: 'DAYS', quantity: 1, price: 5_000, onSale: true },
    { id: 'days-10', name: '방송 일권 10일', kind: 'DAYS', quantity: 10, price: 40_000, onSale: true },
    { id: 'orders-100', name: '주문 건권 100건', kind: 'ORDERS', quantity: 100, price: 10_000, onSale: true },
    { id: 'orders-500', name: '주문 건권 500건', kind: 'ORDERS', quantity: 500, price: 40_000, onSale: true },
    { id: 'labels-100', name: '라벨 장권 100장', kind: 'LABELS', quantity: 100, price: 2_000, onSale: true },
    { id: 'labels-500', name: '라벨 장권 500장', kind: 'LABELS', quantity: 500, price: 8_000, onSale: true },
  ],
}

const ITEM_KEYS = ['id', 'name', 'kind', 'quantity', 'price', 'onSale']
const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max

export type PriceTableResult = { readonly ok: true; readonly table: PriceTable } | { readonly ok: false; readonly message: string }

/**
 * 요금 표 JSON 읽기: `{ "placeholder"?: boolean, "items": [{ id, name, kind, quantity?, price, onSale? }] }`.
 * 틀린 곳을 한 문장으로 알린다(받은 값은 넣지 않는다 — 몇 번째 항목의 무엇인지만)
 */
export function parsePriceTable(value: unknown): PriceTableResult {
  const fail = (message: string): PriceTableResult => ({ ok: false, message: `요금 표를 확인해 주세요. ${message}` })
  if (!isPlainObject(value)) return fail('맨 바깥은 { "items": [...] } 모양이어야 해요.')
  const extra = ownKeys(value).filter((key) => key !== 'items' && key !== 'placeholder')
  if (extra.length > 0) return fail('모르는 칸이 있어요. 맨 바깥에는 items·placeholder만 적어요.')
  const placeholder = own(value, 'placeholder')
  if (placeholder !== undefined && typeof placeholder !== 'boolean') return fail('placeholder는 true나 false로 적어 주세요.')
  const items = own(value, 'items')
  if (!Array.isArray(items) || items.length === 0) return fail('items에 항목을 하나 이상 적어 주세요.')
  const seen = new Set<string>()
  const out: PriceItem[] = []
  for (const [index, raw] of items.entries()) {
    const where = `${String(index + 1)}번째 항목:`
    if (!isPlainObject(raw)) return fail(`${where} 항목은 { ... } 모양이어야 해요.`)
    if (ownKeys(raw).some((key) => !ITEM_KEYS.includes(key))) return fail(`${where} 모르는 칸이 있어요. id·name·kind·quantity·price·onSale만 적어요.`)
    const id = own(raw, 'id')
    const name = own(raw, 'name')
    const kind = own(raw, 'kind')
    const quantity = own(raw, 'quantity')
    const price = own(raw, 'price')
    const onSale = own(raw, 'onSale')
    if (typeof id !== 'string' || !PRICE_ID_RE.test(id)) return fail(`${where} ID는 영문 소문자·숫자·'-'로 된 1~32자로 적어 주세요.`)
    if (seen.has(id)) return fail(`${where} 같은 ID가 두 번 있어요.`)
    seen.add(id)
    if (typeof name !== 'string' || name.trim() === '' || [...name].length > PRICE_NAME_MAX || hasControlChar(name)) return fail(`${where} 이름은 1~30자로 적어 주세요.`)
    if (typeof kind !== 'string' || !(PASS_KINDS as readonly string[]).includes(kind)) return fail(`${where} 종류는 FLAT_30D·DAYS·ORDERS·LABELS 중 하나로 적어 주세요.`)
    if (isQuantityKind(kind)) {
      if (!isInt(quantity, QUANTITY_MIN, QUANTITY_MAX)) return fail(`${where} 정량 이용권의 양은 1부터 100,000까지의 정수로 적어 주세요.`)
    } else if (quantity !== undefined && quantity !== null) return fail(`${where} 정액제에는 양을 적지 않아요.`)
    if (!isInt(price, PRICE_MIN, PRICE_MAX)) return fail(`${where} 가격은 100원부터 10,000,000원까지의 정수로 적어 주세요.`)
    if (onSale !== undefined && typeof onSale !== 'boolean') return fail(`${where} onSale은 true나 false로 적어 주세요.`)
    out.push({ id, name: name.trim(), kind: kind as PassKind, quantity: isQuantityKind(kind) ? (quantity as number) : null, price, onSale: onSale !== false })
  }
  return { ok: true, table: { placeholder: placeholder === true, items: out } }
}

/** 포트원 V2 설정 (상점 ID·채널 키는 공개 값, API 비밀값·웹훅 비밀값은 서버에만) */
export interface PortOneSettings {
  readonly storeId: string
  readonly channelKey: string
  readonly apiSecret: string
  readonly webhookSecret: string
}

export interface BillingEnv {
  readonly enabled: boolean
  readonly prices: PriceTable
  readonly portone: PortOneSettings
}

export type BillingEnvResult = { readonly ok: true; readonly billing: BillingEnv } | { readonly ok: false; readonly message: string }

export const PLACEHOLDER_REFUSAL = '요금 표가 자리 표시 값이에요. 운영 가격을 정한 뒤 켜 주세요.'
export const PORTONE_REFUSAL = '결제 설정이 비어 있어 요금 기능을 켤 수 없어요.'

/**
 * 운영 요금 설정을 환경변수에서 읽는다. readFile은 시험에서 바꿔 끼운다.
 * 요금 표 파일이 있으면 꺼져 있어도 형식을 검사한다(틀린 표로 나중에 켜지 않게). 켜져 있으면 자리 표시 표·빈 포트원 설정을 거부한다
 */
export function readBillingEnv(env: Readonly<Record<string, string | undefined>>, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): BillingEnvResult {
  const switchValue = (env['LIVEJJIM_BILLING'] ?? '').trim().toLowerCase()
  if (switchValue !== '' && switchValue !== 'on' && switchValue !== 'off') return { ok: false, message: '요금 기능 스위치(LIVEJJIM_BILLING)는 on 또는 off로 적어 주세요.' }
  const enabled = switchValue === 'on'
  let prices = DEFAULT_PRICE_TABLE
  const file = (env['LIVEJJIM_BILLING_PRICES'] ?? '').trim()
  if (file !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFile(file))
    } catch {
      return { ok: false, message: '요금 표 파일(LIVEJJIM_BILLING_PRICES)을 읽지 못했어요. 파일 경로와 JSON 형식을 확인해 주세요.' }
    }
    const table = parsePriceTable(parsed)
    if (!table.ok) return table
    prices = table.table
  }
  const portone: PortOneSettings = {
    storeId: (env['PORTONE_STORE_ID'] ?? '').trim(),
    channelKey: (env['PORTONE_CHANNEL_KEY'] ?? '').trim(),
    apiSecret: (env['PORTONE_API_SECRET'] ?? '').trim(),
    webhookSecret: (env['PORTONE_WEBHOOK_SECRET'] ?? '').trim(),
  }
  if (enabled) {
    if (prices.placeholder) return { ok: false, message: PLACEHOLDER_REFUSAL }
    if (portone.storeId === '' || portone.channelKey === '' || portone.apiSecret === '' || portone.webhookSecret === '') return { ok: false, message: PORTONE_REFUSAL }
  }
  return { ok: true, billing: { enabled, prices, portone } }
}
