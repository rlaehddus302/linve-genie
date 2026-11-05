// 우체국 공개 OpenAPI (공공데이터포털 — 무료, 서버 키 하나, D-REAL-08). 판매자 계약 없이 쓸 수 있는 우체국 기능 둘:
// - 배송 조회: 국내우편물 종적 조회(getLongitudinalDomesticList) — 등기번호 하나씩. 처리현황 낱말을 우리 조회 상태(PC-8)로 옮긴다.
//   접수·집하 → 집하, 발송·도착·배달준비·미배달 → 배송 중, 배달완료 → 도착. 종적이 없으면(아직 안 가져감) 빼서 접수됨 그대로.
// - 우편번호 찾기: 도로명주소 우편번호 조회(getNewAddressListAreaCd) — 받는 분 우편번호가 비었을 때 주소로 찾는다. 답이 우편번호 하나로 모일 때만 쓴다.
// - 주소는 http만 열려 있다(https 없음 — 2026-11-05 확인). 키는 공공데이터포털 "일반 인증키"(Decoding 값 또는 Encoding 값 아무거나).
// - 답의 이름·주소(발송인·수취인 — 가린 이름)는 읽지 않고 저장·로그에 내지 않는다. 처리현황·우편번호 칸만 본다.
import type { TrackResult } from './carrier.ts'
import type { TrackCode } from './rules.ts'
import { INVOICE_RE } from './rules.ts'

export const EPOST_PUBLIC_BASE = 'http://openapi.epost.go.kr'
export const EPOST_PUBLIC_ENV = 'LIVEJJIM_DATA_GO_KR_KEY'
const TRACE_PATH = '/trace/retrieveLongitudinalService/retrieveLongitudinalService/getLongitudinalDomesticList'
const ZIP_PATH = '/postal/retrieveNewAdressAreaCdService/retrieveNewAdressAreaCdService/getNewAddressListAreaCd'
const PUBLIC_TIMEOUT_MS = 10_000
/** 한 번에 같이 묻는 등기번호 수 */
const TRACE_PARALLEL = 4

export interface EpostPublicOptions {
  /** 공공데이터포털 일반 인증키 */
  readonly serviceKey: string
  readonly base?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

/** 공공데이터포털 키: Encoding 값(%xx)을 붙여 넣었으면 풀어서 둔다 (주소에 넣을 때 다시 인코딩한다) */
export function readDataGoKrKey(env: Readonly<Record<string, string | undefined>>): string | null {
  const raw = (env[EPOST_PUBLIC_ENV] ?? '').trim()
  if (raw === '') return null
  if (!/%[0-9A-Fa-f]{2}/.test(raw)) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const strip = (raw: string): string => raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
const fieldsOf = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((match) => strip(match[1] as string))
const firstOf = (xml: string, name: string): string | null => fieldsOf(xml, name)[0] ?? null

/** 공통 머리: 성공 · 키 문제(전체 실패) · 그 밖 오류(이 건만 모름) */
export type PublicHeader = 'OK' | 'AUTH' | 'OTHER'

/** 키·권한 오류 코드 (공공데이터포털 공통 — 20 접근 거부, 22 요청 한도, 30 등록 안 된 키, 31 기한 지남, 32 등록 안 된 IP, 33 서명 안 됨) */
const AUTH_CODES = new Set(['20', '22', '30', '31', '32', '33'])

export function readPublicHeader(xml: string): PublicHeader {
  if (/<OpenAPI_ServiceResponse[\s>]/.test(xml)) {
    const reason = firstOf(xml, 'returnReasonCode') ?? ''
    return AUTH_CODES.has(reason) ? 'AUTH' : 'OTHER'
  }
  const success = firstOf(xml, 'successYN')
  if (success === 'Y') return 'OK'
  const code = firstOf(xml, 'returnCode') ?? ''
  return AUTH_CODES.has(code) ? 'AUTH' : 'OTHER'
}

const RANK: Readonly<Record<TrackCode, number>> = { ACCEPTED: 0, PICKED_UP: 1, IN_TRANSIT: 2, DELIVERED: 3 }

/** 처리현황 낱말 하나 → 조회 상태 (모르는 낱말이면 null) */
export function traceWord(word: string): TrackCode | null {
  const text = word.replace(/\s/g, '')
  if (text === '') return null
  if (text.includes('배달완료') || text.includes('교부완료')) return 'DELIVERED'
  if (['발송', '도착', '배달준비', '배달중', '미배달', '운송', '중계'].some((part) => text.includes(part))) return 'IN_TRANSIT'
  if (text.includes('접수') || text.includes('집하')) return 'PICKED_UP'
  return null
}

/** 종적 답 → 지금까지 간 가장 먼 상태 (종적이 없으면 null) */
export function traceCode(xml: string): TrackCode | null {
  let best: TrackCode | null = null
  for (const word of [...fieldsOf(xml, 'processSttus'), ...fieldsOf(xml, 'dlvySttus')]) {
    const code = traceWord(word)
    if (code !== null && (best === null || RANK[code] > RANK[best])) best = code
  }
  return best
}

type Got = { readonly kind: 'xml'; readonly xml: string } | { readonly kind: 'fail'; readonly status: number | null }

function getter(options: EpostPublicOptions) {
  const doFetch = options.fetch ?? fetch
  const base = options.base ?? EPOST_PUBLIC_BASE
  const timeoutMs = options.timeoutMs ?? PUBLIC_TIMEOUT_MS
  return async (path: string, params: Readonly<Record<string, string>>): Promise<Got> => {
    const query = [['serviceKey', options.serviceKey], ...Object.entries(params)].map(([name, value]) => `${name}=${encodeURIComponent(value as string)}`).join('&')
    let response: Response
    try {
      response = await doFetch(`${base}${path}?${query}`, { signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      return { kind: 'fail', status: null }
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      return { kind: 'fail', status: response.status }
    }
    try {
      return { kind: 'xml', xml: await response.text() }
    } catch {
      return { kind: 'fail', status: response.status }
    }
  }
}

/** 우체국 배송 조회 (carrier.ts track 약속): 등기번호마다 묻고, 종적이 있는 것만 담는다. 키가 틀렸거나 하나도 못 물었으면 실패 */
export function epostTracker(options: EpostPublicOptions): (invoices: readonly string[]) => Promise<TrackResult> {
  const get = getter(options)
  return async (invoices) => {
    const items = new Map<string, TrackCode>()
    const targets = invoices.filter((invoice) => INVOICE_RE.test(invoice))
    let answered = 0
    let lastStatus: number | null = null
    let auth = false
    for (let start = 0; start < targets.length && !auth; start += TRACE_PARALLEL) {
      const group = targets.slice(start, start + TRACE_PARALLEL)
      const answers = await Promise.all(group.map((invoice) => get(TRACE_PATH, { rgist: invoice })))
      answers.forEach((got, index) => {
        if (got.kind === 'fail') {
          lastStatus = got.status
          return
        }
        const header = readPublicHeader(got.xml)
        if (header === 'AUTH') {
          auth = true
          return
        }
        answered += 1
        if (header !== 'OK') return
        const code = traceCode(got.xml)
        if (code !== null) items.set(group[index] as string, code)
      })
    }
    if (auth) return { ok: false, status: 401 }
    if (answered === 0 && targets.length > 0) return { ok: false, status: lastStatus }
    return { ok: true, items }
  }
}

// ── 우편번호 찾기 ─────────────────────────────────────────────────────────

/** 찾기 결과: 우편번호 하나 · 못 찾음(없거나 여럿) · 물어보지 못함 */
export type ZipFound = { readonly kind: 'ZIP'; readonly zip: string } | { readonly kind: 'NONE' } | { readonly kind: 'ERROR' }

/** 주소 다듬기: 괄호 안(참고 항목)·쉼표 빼고 빈칸 하나로 */
const tidyAddress = (address: string): string =>
  address
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,·]/g, ' ')
    .replace(/(\d)\s*번지/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const ROAD_RE = /([가-힣A-Za-z0-9.]+(?:로|길))\s*(\d+(?:-\d+)?)(?![0-9가-힣])/
const LOT_RE = /([가-힣0-9]+(?:동|리|가))\s*(?:산\s*)?(\d+(?:-\d+)?)(?!\d)/

/** 광역 이름 줄임 (서울특별시·서울 → 서울, 충청북도·충북 → 충북). 광역 이름이 아니면 null */
const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const LONG_REGIONS: Readonly<Record<string, string>> = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남' }
export function regionOf(word: string): string | null {
  const short = LONG_REGIONS[word] ?? word.slice(0, 2)
  return REGIONS.includes(short) && (word.length === 2 || word in LONG_REGIONS || /(?:특별시|광역시|특별자치시|특별자치도|도)$/.test(word)) ? short : null
}

/** 시·군·구 낱말 (첫 낱말 광역 이름은 줄여 쓰는 일이 많아 따로 본다 — regionOf) */
const districtWords = (address: string): string[] =>
  address
    .split(' ')
    .slice(1)
    .filter((word) => /^[가-힣]+(?:시|군|구)$/.test(word))

/** 우편번호 찾기 함수 (받는 분 주소 한 줄 → 우편번호) */
export function epostZipFinder(options: EpostPublicOptions): (address: string) => Promise<ZipFound> {
  const get = getter(options)
  const ask = async (searchSe: 'road' | 'dong', word: string): Promise<{ zip: string; road: string; lot: string }[] | null> => {
    const got = await get(ZIP_PATH, { searchSe, srchwrd: [...word].slice(0, 200).join(''), countPerPage: '50', currentPage: '1' })
    if (got.kind === 'fail') return null
    const header = readPublicHeader(got.xml)
    if (header === 'AUTH') return null
    if (header !== 'OK') return []
    const zips = fieldsOf(got.xml, 'zipNo')
    const roads = fieldsOf(got.xml, 'rnAdres')
    const lots = fieldsOf(got.xml, 'lnmAdres')
    return zips.map((zip, index) => ({ zip, road: roads[index] ?? '', lot: lots[index] ?? '' }))
  }
  return async (address) => {
    const text = tidyAddress(address)
    if (text === '') return { kind: 'NONE' }
    const road = ROAD_RE.exec(text)
    const lot = road === null ? LOT_RE.exec(text) : null
    if (road === null && lot === null) return { kind: 'NONE' }
    const match = (road ?? lot) as RegExpExecArray
    const key = `${match[1] as string} ${match[2] as string}`
    const rows = await ask(road !== null ? 'road' : 'dong', key)
    if (rows === null) return { kind: 'ERROR' }
    const squash = (value: string) => value.replace(/\s/g, '')
    const keyText = squash(key)
    const districts = districtWords(text)
    const region = regionOf(text.split(' ')[0] ?? '')
    const fits = rows.filter((row) => {
      const target = squash(road !== null ? row.road : row.lot)
      if (!target.includes(keyText)) return false
      // 건물번호 뒤에 숫자가 더 붙은 다른 번지(예: 20 → 201)는 빼기
      const after = target.slice(target.indexOf(keyText) + keyText.length)
      if (/^[0-9-]/.test(after)) return false
      if (region !== null && regionOf((road !== null ? row.road : row.lot).trim().split(/\s+/)[0] ?? '') !== region) return false
      return districts.every((word) => target.includes(word))
    })
    const zips = new Set(fits.map((row) => row.zip).filter((zip) => /^[0-9]{5}$/.test(zip)))
    if (zips.size !== 1) return { kind: 'NONE' }
    return { kind: 'ZIP', zip: [...zips][0] as string }
  }
}
