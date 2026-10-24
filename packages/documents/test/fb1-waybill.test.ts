// FB1 운송장 — 택배 크기 코드 다섯과 화면 낱말, 택배사 이름 표 (AC-FB1-18, PARCEL_RULES PC-1·PC-6·PC-7, D-FB1-04·D-FB1-05)
import { describe, expect, it } from 'vitest'
import {
  BOX_SIZES,
  BOX_SIZE_NAMES,
  CARRIER_CODES,
  CARRIER_NAMES,
  LEGACY_BOX_SIZES,
  WAYBILL_FORMAT_MESSAGE,
  boxSizeOf,
  layoutWaybill,
  loadDocumentFont,
  renderWaybillsPdf,
  type WaybillData,
} from '../src/index.ts'
import type { WaybillItem, WaybillText } from '../src/index.ts'
import { fontBytes, pdfPageTexts } from './helpers.ts'

const isText = (item: WaybillItem): item is WaybillText => item.kind === 'text'

const font = loadDocumentFont(fontBytes())

const BASE: WaybillData = {
  carrier: 'FAKE',
  invoice: '900000000001',
  receiver: { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '', zip: '', memo: '' },
  sender: { name: '다육이네', phone: '0311234567', address: '경기도 성남시 분당구 판교역로 1' },
  itemCount: 1,
  box: '80',
  bookedDate: '2026-10-24',
}

const squash = (text: string): string => text.replace(/\s+/gu, '')

function boxText(data: WaybillData): string | undefined {
  const result = layoutWaybill(data, font)
  if (!result.ok) return undefined
  return result.layout.items.filter(isText).find((item) => item.field === 'box')?.text
}

describe('AC-FB1-18 택배 크기 (세 변의 합)', () => {
  it('목록은 새 코드 다섯, 화면 낱말은 "60cm 이하" 꼴', () => {
    expect([...BOX_SIZES]).toEqual(['60', '80', '100', '120', '160'])
    expect(BOX_SIZE_NAMES).toEqual({ '60': '60cm 이하', '80': '80cm 이하', '100': '100cm 이하', '120': '120cm 이하', '160': '160cm 이하' })
  })

  it('운송장에 "상자 크기 80cm 이하"처럼 찍힌다 — 다섯 코드 모두', () => {
    for (const box of BOX_SIZES) expect(boxText({ ...BASE, box })).toBe(`상자 크기 ${box}cm 이하`)
  })

  it('옮기지 않은 옛 낱말이 와도 차례대로 하나씩 옮긴 낱말로 찍는다 (극소→60·소→80·중→100·대→120)', () => {
    expect(LEGACY_BOX_SIZES).toEqual({ 극소: '60', 소: '80', 중: '100', 대: '120' })
    for (const [old, code] of Object.entries(LEGACY_BOX_SIZES)) {
      expect(boxText({ ...BASE, box: old as keyof typeof LEGACY_BOX_SIZES })).toBe(`상자 크기 ${code}cm 이하`)
    }
  })

  it('표 밖 값은 그 운송장만 FORMAT (글자 그대로 비교 — 공백·전각 없음)', () => {
    for (const bad of ['', ' 80', '８０', '200', '80cm', 'toString', '__proto__', 80]) {
      expect(boxSizeOf(bad)).toBeUndefined()
      const result = layoutWaybill({ ...BASE, box: bad as unknown as WaybillData['box'] }, font)
      expect(result).toEqual({ ok: false, error: { code: 'FORMAT', message: WAYBILL_FORMAT_MESSAGE } })
    }
  })

  it('PDF 글에도 화면 낱말, 옛 낱말은 없다', async () => {
    const { pdf } = await renderWaybillsPdf([{ ...BASE, box: '160' }], font)
    expect(pdf).not.toBeNull()
    const [page] = await pdfPageTexts(pdf as Uint8Array)
    const all = squash((page as string[]).join(''))
    expect(all).toContain(squash('상자 크기 160cm 이하'))
    expect(all).not.toMatch(/극소|상자크기(소|중|대)/u)
  })
})

describe('AC-FB1-18 택배사 이름 표 (PC-1 낱말)', () => {
  it('EPOST = 우체국택배, 그 밖의 새 코드도 설정 화면 낱말, FAKE는 지금 문장 그대로', () => {
    expect([...CARRIER_CODES]).toEqual(['FAKE', 'EPOST', 'CJ', 'HANJIN', 'LOGEN', 'LOTTE'])
    expect(CARRIER_NAMES).toEqual({
      FAKE: '가짜 택배 · 시험용 — 실제로 보낼 수 없어요',
      EPOST: '우체국택배',
      CJ: 'CJ대한통운',
      HANJIN: '한진택배',
      LOGEN: '로젠택배',
      LOTTE: '롯데택배',
    })
  })

  it('운송장 맨 위 택배사 이름이 표 그대로 — 표 밖 코드(직접 입력 OTHER 등)는 FORMAT', () => {
    for (const carrier of CARRIER_CODES) {
      const result = layoutWaybill({ ...BASE, carrier }, font)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const text = result.layout.items
        .filter(isText)
        .filter((item) => item.field === 'carrier')
        .map((item) => item.text)
        .join('')
      expect(squash(text)).toBe(squash(CARRIER_NAMES[carrier]))
    }
    for (const bad of ['OTHER', 'toString', 'constructor', '']) {
      expect(layoutWaybill({ ...BASE, carrier: bad as WaybillData['carrier'] }, font)).toMatchObject({ ok: false, error: { code: 'FORMAT' } })
    }
  })
})
