// 우체국 방문접수소포 파일접수 엑셀 (D-UX3-36): 인터넷우체국 [방문접수소포 예약] > [파일(주소) 등록]에 그대로 올리는 파일.
// - 우체국이 내려 주는 공식 양식(templates/epost-visit.xlsx — parcel.epost.go.kr/parcel/use_guide/new_file_type.xlsx, 2026 개정판)을
//   그대로 두고 3행부터 받는 분 줄만 채운다. 우체국은 양식이 바뀐 파일을 "파일양식이 변경되어 업로드 불가"로 거절하므로 머리 두 줄·열·목록 고르기는 손대지 않는다.
// - 칸(A~U): 받는 분 이름·우편번호·주소·상세 주소·연락처 | 중량(5·10·20·30)·크기(80·100·120·160)·분할(N)·(분할 칸 넷 비움)·내용품코드·내용물·배달방식·특이사항 | 보내는 분 다섯 칸(비움 — 우체국 화면의 방문접수지를 쓴다).
// - 상자 크기 → 중량·크기 짝은 우체국 요금 구간(5kg·80cm, 10kg·100cm, 20kg·120cm, 30kg·160cm)과 같은 짝이라 요금이 상자 크기로 정해진다. 60cm 상자는 가장 작은 80 구간.
// - 글 칸은 모두 인라인 글(수식이 아님)로 적고, 엑셀이 못 받는 글자는 뺀다(stripXlsxForbidden). 우편번호·연락처도 글(앞의 0을 지킨다).
// - 우체국 파일 등록은 1MB 이하·1000건 미만만 받는다 → 999줄까지.
// - 양식 바이트는 부르는 쪽(서버 files.ts epostVisitTemplate — `@livejjim/documents/templates/epost-visit.xlsx`)이 읽어 넘긴다(이 패키지는 브라우저에서도 쓴다).
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { stripXlsxForbidden } from './text.ts'
import type { BoxSize } from './waybill.ts'

/** 우체국 파일 등록 한 번에 받는 줄 수 상한 (1000건 미만) */
export const EPOST_VISIT_MAX_ROWS = 999
/** 우체국 파일 등록 파일 크기 상한 */
export const EPOST_VISIT_MAX_BYTES = 1024 * 1024
/** 내용품코드 — 자동 접수(epost.ts EPOST_CONTENT_CODE '021')와 같은 농/수/축산물(일반) */
export const EPOST_VISIT_CONTENT_CODE = '[21]농/수/축산물(일반)'
/** 배달방식 기본값 (양식 기본값 그대로) */
export const EPOST_VISIT_DELIVERY = '미신청'

/** 상자 크기 → 우체국 중량(kg)·크기(cm) 짝 */
export const EPOST_VISIT_CLASS: Readonly<Record<BoxSize, { readonly kg: number; readonly cm: number }>> = {
  '60': { kg: 5, cm: 80 },
  '80': { kg: 5, cm: 80 },
  '100': { kg: 10, cm: 100 },
  '120': { kg: 20, cm: 120 },
  '160': { kg: 30, cm: 160 },
}

export interface EpostVisitRow {
  readonly name: string
  /** 숫자 5자리 또는 빈 글 (비면 우체국 [주소검증]이 찾는다) */
  readonly zip: string
  readonly address: string
  readonly detail: string
  /** 숫자만 */
  readonly phone: string
  readonly box: BoxSize
  /** 내용물 (예: "물품 3개") */
  readonly content: string
  /** 배송 메모 → 배송시특이사항 */
  readonly memo: string
}

/** 연락처 숫자 → 0X-XXX(X)-XXXX (우체국 양식 예 "010-000-0000"). 모양이 아니면 숫자 그대로 */
export function epostPhoneText(digits: string): string {
  const d = typeof digits === 'string' ? digits.replace(/[^0-9]/g, '') : ''
  if (d.startsWith('02') && (d.length === 9 || d.length === 10)) return `02-${d.slice(2, d.length - 4)}-${d.slice(-4)}`
  if (d.length === 10 || d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`
  return d
}

/** 한 줄 글 칸: 엑셀이 못 받는 글자·줄바꿈 빼고 공백 하나로 */
function cellText(text: string): string {
  return stripXlsxForbidden(typeof text === 'string' ? text.replace(/[\r\n\t]+/g, ' ') : '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 양식 열 기본 글자 모양 (양식의 <col style="2">) */
const STYLE = '2'
const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTU'

/** 한 줄의 A~U 값 (null = 빈 칸, number = 수 칸, string = 글 칸) */
export function epostVisitCells(row: EpostVisitRow): readonly (string | number | null)[] {
  const size = EPOST_VISIT_CLASS[row.box]
  const detail = cellText(row.detail)
  return [
    cellText(row.name),
    /^[0-9]{5}$/.test(row.zip) ? row.zip : null,
    cellText(row.address),
    // 상세 주소가 없으면 양식 안내대로 "."
    detail === '' ? '.' : detail,
    epostPhoneText(row.phone),
    size.kg,
    size.cm,
    'N',
    null,
    null,
    null,
    null,
    EPOST_VISIT_CONTENT_CODE,
    cellText(row.content),
    EPOST_VISIT_DELIVERY,
    cellText(row.memo) || null,
    null,
    null,
    null,
    null,
    null,
  ]
}

function rowXml(index: number, cells: readonly (string | number | null)[]): string {
  const r = String(index)
  let out = `<row r="${r}" spans="1:21">`
  cells.forEach((value, i) => {
    const ref = `${COLUMNS[i] as string}${r}`
    if (value === null || value === '') return
    if (typeof value === 'number') out += `<c r="${ref}" s="${STYLE}"><v>${String(value)}</v></c>`
    else out += `<c r="${ref}" s="${STYLE}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  })
  return `${out}</row>`
}

const SHEET = 'xl/worksheets/sheet1.xml'

/**
 * 받는 분 줄로 우체국 방문접수소포 파일접수 엑셀을 만든다. 1~999줄.
 * 양식의 3행(기본값 줄)을 받은 줄로 바꾸고 범위(dimension)만 고친다 — 다른 부분은 바이트 그대로.
 */
export function buildEpostVisitXlsx(rows: readonly EpostVisitRow[], template: Uint8Array): Uint8Array {
  if (rows.length === 0 || rows.length > EPOST_VISIT_MAX_ROWS) throw new RangeError('rows')
  const files = unzipSync(template)
  const sheet = files[SHEET]
  if (sheet === undefined) throw new Error('template')
  const xml = strFromU8(sheet)
  const start = xml.indexOf('<row r="3"')
  const end = xml.indexOf('</sheetData>')
  if (start < 0 || end < start) throw new Error('template')
  const body = rows.map((row, i) => rowXml(i + 3, epostVisitCells(row))).join('')
  const next = (xml.slice(0, start) + body + xml.slice(end)).replace('<dimension ref="A1:U3"/>', `<dimension ref="A1:U${String(rows.length + 2)}"/>`)
  files[SHEET] = strToU8(next)
  return zipSync(files, { level: 6 })
}
