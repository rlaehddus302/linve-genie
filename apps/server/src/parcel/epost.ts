// 우체국 계약소포 OpenAPI 어댑터 (D-REAL-04). 판매자마다 우체국과 맺은 계약(인증키·보안키·고객 번호)으로 소포신청(픽업요청)을 넣는다.
// - 요청: https://ship.epost.go.kr/api.{이름}.jparcel?key=인증키&regData=hex — regData는 "항목=값&…" 평문을 보안키로 SEED128 ECB 암호화(seed.ts).
//   값은 따로 인코딩하지 않으므로 값 안의 &·=는 전각(＆·＝)으로 바꾼다.
// - 답: XML <xsync>. 오류는 <error><error_code>ERR-xxx</error_code>. 원래 글(message)은 읽지 않는다(주소가 들어 있을 수 있다 — carrier.ts 약속).
// - 우체국은 주문번호로 멱등이 아니다 → 접수 전에 소포신청 확인(GetResInfo)으로 같은 주문번호(= 요청 번호)를 오늘·어제 날짜로 먼저 묻는다.
//   이미 있으면 그 등기번호를 돌려주고, 확인이 안 되면(응답 없음) 새로 넣지 않고 모름으로 둔다(두 번 접수 막기).
// - 운송장은 우체국 계약고객전용시스템에서 뽑는다(printYn=N — 우체국 운송장 양식·바코드 인증 없이). 집하 전까지 취소할 수 있다.
// - 계약 승인번호·공급지 코드는 고객 번호로 우체국에 물어 1시간 기억한다(판매자가 적을 칸을 줄인다).
// - 배송 조회·우편번호 찾기는 공공데이터포털 공개 API(epost-public.ts — 서버 키 하나, D-REAL-08)를 옵션으로 받는다.
import type { AccountCheck, BookRequest, BookResult, CancelContext, CancelResult, CarrierAccount, CarrierAdapter, TrackResult } from './carrier.ts'
import type { ZipFound } from './epost-public.ts'
import { zipTarget } from './epost-public.ts'
import { CARRIER_TIMEOUT_MS, itemText } from './carrier.ts'
import { epostEncrypt } from './seed.ts'
import { INVOICE_RE } from './rules.ts'

export const EPOST_BASE = 'https://ship.epost.go.kr'
/** 배송 조회 (인터넷우체국 — 등기번호 13자리) */
export const epostTrackUrl = (invoice: string): string => `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${encodeURIComponent(invoice)}`
/** 주요 내용품 코드: 021 농/수/축산물(일반) — 다육식물 */
export const EPOST_CONTENT_CODE = '021'
/** regData 길이 상한 (설명서) */
const REG_DATA_MAX = 4000
const CONTRACT_TTL_MS = 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export interface EpostOptions {
  readonly base?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
  /** 지금 시각 (밀리초) — 소포신청 등록일자(KST) 계산 */
  readonly now: () => number
  /** 배송 조회 (공공데이터포털 종적 조회 — epost-public.ts, D-REAL-08). 없으면 접수됨에서 멈춘다 */
  readonly track?: (invoices: readonly string[]) => Promise<TrackResult>
  /** 받는 분 우편번호가 비었을 때 주소로 찾기 (D-REAL-08). 없으면 우편번호 없는 주소는 주소 확인으로 돌려보낸다 */
  readonly findZip?: (address: string) => Promise<ZipFound>
}

/** 값 하나 다듬기: 줄바꿈·제어 문자는 빈칸, &·=는 전각 */
const clean = (value: string): string =>
  [...value]
    .map((char) => (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? ' ' : char))
    .join('')
    .replace(/ {2,}/g, ' ')
    .replace(/&/g, '＆')
    .replace(/=/g, '＝')
    .trim()

/** "항목=값&…" 평문 (빈 값은 뺀다) */
export function epostPlain(fields: readonly (readonly [string, string | number | null | undefined])[]): string {
  return fields
    .filter((entry): entry is readonly [string, string | number] => entry[1] !== null && entry[1] !== undefined && String(entry[1]) !== '')
    .map(([name, value]) => `${name}=${clean(String(value))}`)
    .join('&')
}

/** XML 답 읽기: 오류 코드 또는 이름별 값 묶음 (CDATA·앞뒤 빈칸을 벗긴다) */
export type EpostAnswer = { readonly kind: 'error'; readonly code: string } | { readonly kind: 'ok'; readonly xml: string }

const strip = (raw: string): string => raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()

export function readEpostXml(xml: string): EpostAnswer | null {
  if (!/<xsync[\s>]/.test(xml)) return null
  const error = /<error_code>([\s\S]*?)<\/error_code>/.exec(xml)
  if (error !== null) return { kind: 'error', code: strip(error[1] as string) }
  return { kind: 'ok', xml }
}

/** 이름 붙은 칸 값 (첫 번째) */
export function epostField(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return match === null ? null : strip(match[1] as string)
}

/** 되풀이 묶음 (contractInfo·officeInfo·resInfo) */
export function epostBlocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((match) => match[1] as string)
}

/** KST 날짜 YYYYMMDD */
export const kstYmd = (ms: number): string => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '')

/** 수취인 주소 거절로 보는 오류 코드 (ERR-3xx — 수취인 칸) */
const isAddressError = (code: string): boolean => /^ERR-3\d\d$/.test(code)
/** 신청 정보 없음 (소포신청 확인) */
const NOT_FOUND = 'ERR-225'

interface Contract {
  readonly apprNo: string
  readonly officeSer: string
  readonly until: number
}

export function epostCarrier(options: EpostOptions): CarrierAdapter {
  const doFetch = options.fetch ?? fetch
  const base = options.base ?? EPOST_BASE
  const timeoutMs = options.timeoutMs ?? CARRIER_TIMEOUT_MS
  const contracts = new Map<string, Contract>()

  /** 부르기: 답이 없거나 XML이 아니면 null */
  const call = async (name: string, account: CarrierAccount, plain: string): Promise<EpostAnswer | null> => {
    const regData = epostEncrypt(account.secret, plain)
    if (regData.length > REG_DATA_MAX) return { kind: 'error', code: 'ERR-LONG' }
    try {
      const response = await doFetch(`${base}/api.${name}.jparcel?key=${encodeURIComponent(account.key)}&regData=${regData}`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {})
        return null
      }
      return readEpostXml(await response.text())
    } catch {
      return null
    }
  }

  /** 계약 승인번호·공급지 코드 (1시간 기억). 거절이면 오류 코드, 모르면 null */
  const contractOf = async (account: CarrierAccount): Promise<Contract | { readonly code: string } | null> => {
    const memo = `${account.key}\u0000${account.customerNo}`
    const known = contracts.get(memo)
    if (known !== undefined && known.until > options.now()) return known
    const custNo = epostPlain([['custNo', account.customerNo]])
    const appr = await call('GetApprNo', account, custNo)
    if (appr === null) return null
    if (appr.kind === 'error') return { code: appr.code }
    const office = await call('GetOfficeInfo', account, custNo)
    if (office === null) return null
    if (office.kind === 'error') return { code: office.code }
    // 승인 상태인 계약을 먼저, 없으면 첫 계약
    const infos = epostBlocks(appr.xml, 'contractInfo')
    const approved = infos.find((info) => epostField(info, 'statusNm') === '승인') ?? infos[0] ?? appr.xml
    const apprNo = epostField(approved, 'apprNo')
    // 발송지로 쓸 수 있는 공급지(1 같음·2 발송지)를 먼저
    const offices = epostBlocks(office.xml, 'officeInfo')
    const sending = offices.find((info) => ['1', '2'].includes(epostField(info, 'officeDivCd') ?? '1')) ?? offices[0] ?? office.xml
    const officeSer = epostField(sending, 'officeSer')
    if (apprNo === null || apprNo === '' || officeSer === null || officeSer === '') return { code: 'ERR-CONTRACT' }
    const contract = { apprNo, officeSer, until: options.now() + CONTRACT_TTL_MS }
    contracts.set(memo, contract)
    return contract
  }

  /** 같은 주문번호의 신청 (그 날짜). 없으면 'none', 거절이면 오류 코드, 모르면 null */
  const findOrder = async (account: CarrierAccount, orderNo: string, ymd: string): Promise<{ regiNo: string; reqNo: string; resNo: string; status: string } | { code: string } | 'none' | null> => {
    const answer = await call('GetResInfo', account, epostPlain([['custNo', account.customerNo], ['reqType', 1], ['orderNo', orderNo], ['reqYmd', ymd]]))
    if (answer === null) return null
    if (answer.kind === 'error') return answer.code === NOT_FOUND ? 'none' : { code: answer.code }
    const infos = epostBlocks(answer.xml, 'resInfo')
    const info = infos[infos.length - 1] ?? answer.xml
    return { regiNo: epostField(info, 'regiNo') ?? '', reqNo: epostField(info, 'reqNo') ?? '', resNo: epostField(info, 'resNo') ?? '', status: epostField(info, 'treatStusCd') ?? '' }
  }

  /** 오늘·어제(KST) 차례로 같은 주문번호를 찾는다 */
  const findRecent = async (account: CarrierAccount, orderNo: string, at: number) => {
    for (const ymd of [kstYmd(at), kstYmd(at - 24 * 60 * 60 * 1000)]) {
      const found = await findOrder(account, orderNo, ymd)
      if (found === null || (found !== 'none' && 'code' in found)) return found
      if (found !== 'none') return { ...found, ymd }
    }
    return 'none' as const
  }

  const book = async (request: BookRequest): Promise<BookResult> => {
    const account = request.account ?? null
    if (account === null) return { kind: 'FAILED', reason: 'REJECTED' }
    const { receiver, sender } = request
    // 우편번호 5자리가 없으면 우체국이 받지 않는다 — 주소로 찾아보고(D-REAL-08), 하나로 모이지 않으면 주소 확인으로 돌려보낸다.
    // 찾기를 묻지 못했으면 아직 아무것도 넣지 않았으니 모름(다시 확인하면 다시 찾는다)
    let recZip = receiver.zip
    if (!/^[0-9]{5}$/.test(recZip)) {
      if (options.findZip === undefined) return { kind: 'FAILED', reason: 'ADDRESS' }
      let found: ZipFound
      try {
        // 우체국 앱처럼 번지를 상세 주소 칸에 따로 적은 손님도 있다("…증산리" + "1034") — 주소 칸에 번지가 없으면 상세 주소를 이어 붙여 찾는다 (D-REAL-10)
        const query = zipTarget(receiver.address) === null && receiver.detail.trim() !== '' ? `${receiver.address} ${receiver.detail}` : receiver.address
        found = await options.findZip(query)
      } catch {
        found = { kind: 'ERROR' }
      }
      if (found.kind === 'ERROR') return { kind: 'UNKNOWN' }
      if (found.kind === 'NONE') return { kind: 'FAILED', reason: 'ADDRESS' }
      recZip = found.zip
    }
    // 두 번 접수 막기: 같은 주문번호가 이미 있으면 그 등기번호
    const prior = await findRecent(account, request.requestKey, options.now())
    if (prior === null) return { kind: 'UNKNOWN' }
    // 인증키·고객 번호가 틀렸다 — 넣은 것이 있을 수 없으니 거절
    if (prior !== 'none' && 'code' in prior) return { kind: 'FAILED', reason: 'REJECTED' }
    if (prior !== 'none') {
      if (prior.status === '05') return { kind: 'FAILED', reason: 'REJECTED' }
      return INVOICE_RE.test(prior.regiNo) ? { kind: 'BOOKED', invoice: prior.regiNo } : { kind: 'UNKNOWN' }
    }
    const contract = await contractOf(account)
    if (contract === null) return { kind: 'UNKNOWN' }
    if ('code' in contract) return { kind: 'FAILED', reason: 'REJECTED' }
    const mobile = receiver.phone.startsWith('01')
    const plain = epostPlain([
      ['custNo', account.customerNo],
      ['apprNo', contract.apprNo],
      ['payType', 1],
      ['reqType', 1],
      ['officeSer', contract.officeSer],
      ['volume', Number(request.box)],
      ['microYn', 'N'],
      ['orderNo', request.requestKey],
      ['ordCompNm', sender.name],
      ['ordNm', sender.name],
      ['ordZip', /^[0-9]{5}$/.test(sender.zip) ? sender.zip : null],
      ['ordAddr1', sender.address],
      ['ordAddr2', sender.detail],
      [sender.phone.startsWith('01') ? 'ordMob' : 'ordTel', sender.phone],
      ['recNm', receiver.name],
      ['recZip', recZip],
      ['recAddr1', receiver.address],
      ['recAddr2', receiver.detail === '' ? '-' : receiver.detail],
      [mobile ? 'recMob' : 'recTel', receiver.phone],
      ['contCd', EPOST_CONTENT_CODE],
      ['goodsNm', itemText(request.count)],
      ['qty', request.count],
      ['delivMsg', [...receiver.memo].slice(0, 100).join('')],
      ['printYn', 'N'],
    ])
    const answer = await call('InsertOrder', account, plain)
    if (answer === null) return { kind: 'UNKNOWN' }
    if (answer.kind === 'error') return { kind: 'FAILED', reason: isAddressError(answer.code) ? 'ADDRESS' : 'REJECTED' }
    const regiNo = epostField(answer.xml, 'regiNo') ?? ''
    return INVOICE_RE.test(regiNo) ? { kind: 'BOOKED', invoice: regiNo } : { kind: 'UNKNOWN' }
  }

  const cancel = async (invoice: string, context?: CancelContext): Promise<CancelResult> => {
    const account = context?.account ?? null
    if (context === undefined || account === null) return { kind: 'UNKNOWN' }
    const found = await findRecent(account, context.requestKey, context.bookedAt?.getTime() ?? options.now())
    if (found === null || found === 'none' || 'code' in found) return { kind: 'UNKNOWN' }
    if (found.status === '05') return { kind: 'CANCELLED' }
    // 신청준비·소포신청·운송장출력까지만 취소된다 (집하완료 뒤는 거절)
    if (!['00', '01', '02'].includes(found.status)) return { kind: 'REFUSED' }
    if (found.regiNo !== invoice) return { kind: 'UNKNOWN' }
    const contract = await contractOf(account)
    if (contract === null || 'code' in contract) return { kind: 'UNKNOWN' }
    const answer = await call(
      'GetResCancelCmd',
      account,
      epostPlain([
        ['custNo', account.customerNo],
        ['apprNo', contract.apprNo],
        ['reqType', 1],
        ['reqNo', found.reqNo],
        ['resNo', found.resNo],
        ['regiNo', found.regiNo],
        ['reqYmd', found.ymd],
        ['delYn', 'N'],
      ]),
    )
    if (answer === null || answer.kind === 'error') return { kind: 'UNKNOWN' }
    const done = epostField(answer.xml, 'canceledYn')
    if (done === 'Y' || done === 'D') return { kind: 'CANCELLED' }
    if (done === 'N') return { kind: 'REFUSED' }
    return { kind: 'UNKNOWN' }
  }

  const verify = async (account: CarrierAccount): Promise<AccountCheck> => {
    contracts.delete(`${account.key}\u0000${account.customerNo}`)
    const contract = await contractOf(account)
    if (contract === null) return 'UNKNOWN'
    return 'code' in contract ? 'REJECTED' : 'OK'
  }

  return { code: 'EPOST', needsAccount: true, verify, book, cancel, ...(options.track === undefined ? {} : { track: options.track }), trackUrl: epostTrackUrl }
}
