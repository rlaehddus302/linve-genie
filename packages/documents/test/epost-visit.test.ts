// 우체국 방문접수소포 파일접수 엑셀 (D-UX3-36): 우체국 공식 양식을 그대로 두고 받는 분 줄만 채운다.
// 우체국은 양식이 바뀐 파일을 받지 않으므로("파일양식이 변경되어 업로드 불가") 머리 두 줄·글자 모양·목록 고르기가 바이트 그대로인지 본다.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { EPOST_VISIT_MAX_ROWS, buildEpostVisitXlsx, epostPhoneText, epostVisitCells, type EpostVisitRow } from '../src/index.ts'

const template = new Uint8Array(readFileSync(new URL('../src/templates/epost-visit.xlsx', import.meta.url)))
const row = (patch: Partial<EpostVisitRow> = {}): EpostVisitRow => ({ name: '홍길동', zip: '04524', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', phone: '01012345678', box: '100', content: '물품 2개', memo: '문 앞에', ...patch })
const sheetXml = (bytes: Uint8Array): string => strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'] as Uint8Array)
const head = (xml: string): string => xml.slice(0, xml.indexOf('<row r="3"'))
const tail = (xml: string): string => xml.slice(xml.indexOf('</sheetData>'))

describe('우체국 방문접수 파일 (D-UX3-36)', () => {
  it('양식의 다른 파일·머리 두 줄·목록 고르기는 바이트 그대로, 범위만 줄 수에 맞춘다', () => {
    const out = buildEpostVisitXlsx([row(), row({ name: '김다육' })], template)
    const before = unzipSync(template)
    const after = unzipSync(out)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const name of Object.keys(before)) if (name !== 'xl/worksheets/sheet1.xml') expect(after[name], name).toEqual(before[name])
    const xml = sheetXml(out)
    const original = sheetXml(template)
    expect(head(xml)).toBe(head(original).replace('<dimension ref="A1:U3"/>', '<dimension ref="A1:U4"/>'))
    expect(tail(xml)).toBe(tail(original))
    expect(xml).toContain('<row r="4" spans="1:21">')
    expect(xml).not.toContain('<row r="5"')
  })

  it('칸 값: 상자 → 중량·크기 짝, 분할 N, 내용품코드 [21], 배달방식 미신청, 보내는 분 비움', () => {
    expect(epostVisitCells(row())).toEqual(['홍길동', '04524', '서울특별시 중구 세종대로 110', '101동 202호', '010-1234-5678', 10, 100, 'N', null, null, null, null, '[21]농/수/축산물(일반)', '물품 2개', '미신청', '문 앞에', null, null, null, null, null])
    expect(epostVisitCells(row({ box: '60' })).slice(5, 7)).toEqual([5, 80])
    expect(epostVisitCells(row({ box: '80' })).slice(5, 7)).toEqual([5, 80])
    expect(epostVisitCells(row({ box: '120' })).slice(5, 7)).toEqual([20, 120])
    expect(epostVisitCells(row({ box: '160' })).slice(5, 7)).toEqual([30, 160])
    // 상세 주소가 없으면 ".", 우편번호가 5자리가 아니면 빈 칸, 메모가 없으면 빈 칸
    const bare = epostVisitCells(row({ detail: '  ', zip: '1234', memo: '' }))
    expect([bare[1], bare[3], bare[15]]).toEqual([null, '.', null])
  })

  it('채팅에서 온 글: 줄바꿈·제어 글자를 빼고, XML 특수 글자는 글로 — 수식이 되지 않는다', () => {
    const xml = sheetXml(buildEpostVisitXlsx([row({ name: '=HYPERLINK("x")<b>&\u0007', memo: '줄\n바꿈\t메모' })], template))
    expect(xml).toContain('<c r="A3" s="2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)&lt;b&gt;&amp;</t></is></c>')
    expect(xml).toContain('<t xml:space="preserve">줄 바꿈 메모</t>')
    expect(xml).not.toContain('<f>')
  })

  it('연락처 모양과 줄 수 상한(우체국 1000건 미만)', () => {
    expect(epostPhoneText('01012345678')).toBe('010-1234-5678')
    expect(epostPhoneText('0311234567')).toBe('031-123-4567')
    expect(epostPhoneText('0212345678')).toBe('02-1234-5678')
    expect(epostPhoneText('021234567')).toBe('02-123-4567')
    expect(epostPhoneText('15881300')).toBe('1588-1300')
    expect(() => buildEpostVisitXlsx([], template)).toThrow(RangeError)
    expect(() => buildEpostVisitXlsx(Array.from({ length: EPOST_VISIT_MAX_ROWS + 1 }, () => row()), template)).toThrow(RangeError)
    expect(buildEpostVisitXlsx(Array.from({ length: EPOST_VISIT_MAX_ROWS }, () => row()), template).byteLength).toBeLessThan(1024 * 1024)
  })
})
