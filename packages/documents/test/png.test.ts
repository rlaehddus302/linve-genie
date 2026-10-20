// AC-P2-25 휴대폰 공유 이미지: PNG 한 장, 폭 1080px, 높이는 내용만큼. PDF와 같은 데이터·같은 글꼴·같은 배치 모델(쪽 번호 빼고), 맨 아래 고지.
import type { EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import {
  IMAGE_WIDTH_PX,
  LEGAL_NOTICE,
  buildReceipt,
  layoutReceipt,
  layoutTexts,
  loadDocumentFont,
  renderReceiptPng,
  type LayoutText,
  type ReceiptData,
} from '../src/index.ts'
import { decodePng, fontBytes, play, replayGolden, sale, type EventInput } from './helpers.ts'

const SHOP = { name: '초록다육', account: { bank: '농협', number: '302-9988-7766-11', holder: '김판매' }, accountNote: '입금자명은 닉네임으로 적어 주세요' }
const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const font = loadDocumentFont(fontBytes())
const G201 = replayGolden('G-ENG-201')

function receipt(state: EngineState, buyer: string): ReceiptData {
  const result = buildReceipt({ state, buyer, date: '2026-10-18', shop: SHOP, rehearsal: false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}

describe('AC-P2-25 휴대폰 공유 이미지', () => {
  const data = receipt(G201, 'UC_A')
  const png = renderReceiptPng(data, fontBytes())
  const image = decodePng(png)

  it('PNG 한 장, 폭 1080px, 회색조 8비트, 높이는 배치 높이만큼', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(image.width).toBe(IMAGE_WIDTH_PX)
    expect(image.bitDepth).toBe(8)
    expect(image.colorType).toBe(0)
    const page = layoutReceipt(data, font, 'image').pages[0]
    expect(layoutReceipt(data, font, 'image').pages).toHaveLength(1)
    expect(image.height).toBe(Math.ceil(((page?.height ?? 0) * IMAGE_WIDTH_PX) / (page?.width ?? 1)))
  })

  it('빈 그림이 아니다 — 배경(흰색)과 다른 화소가 있고, 글자 자리에 잉크가 있다', () => {
    const dark = image.pixels.filter((value) => value < 128).length
    expect(dark).toBeGreaterThan(5000)
    expect(image.pixels.filter((value) => value === 255).length).toBeGreaterThan(image.pixels.length / 2)
    // 제목 글자 상자 안에 진한 화소가 있다
    const title = layoutReceipt(data, font, 'image').pages[0]?.items.find((item): item is LayoutText => item.kind === 'text' && item.text === '구매 내역 확인서')
    expect(title).toBeDefined()
    const scale = IMAGE_WIDTH_PX / 595.28
    let ink = 0
    for (let y = Math.floor((title?.y ?? 0) * scale); y < Math.ceil(((title?.y ?? 0) + (title?.height ?? 0)) * scale); y++) {
      for (let x = Math.floor((title?.x ?? 0) * scale); x < Math.ceil(((title?.x ?? 0) + (title?.width ?? 0)) * scale); x++) if ((image.pixels[y * image.width + x] as number) < 100) ink++
    }
    expect(ink).toBeGreaterThan(200)
  })

  it('그리는 글자 목록이 PDF와 같다(쪽 번호 빼고), 맨 아래에 고지 문장', () => {
    const imageTexts = layoutTexts(layoutReceipt(data, font, 'image'))
    const pdfTexts = layoutTexts(layoutReceipt(data, font, 'pdf'), ['content', 'notice'])
    expect(imageTexts).toEqual(pdfTexts)
    expect(imageTexts.at(-1)).toBe(LEGAL_NOTICE)
    expect(imageTexts).not.toContain('1/1')
  })

  it('여러 쪽짜리 확인서도 이미지는 한 장 — PDF의 내용 글자와 같고 고지는 맨 아래 한 번', () => {
    const events: EventInput[] = []
    for (let i = 1; i <= 60; i++) events.push(...sale(i, 'UC_A', '길동', { name: `품종${String(i)}호` }))
    const long = receipt(play(events), 'UC_A')
    const imageLayout = layoutReceipt(long, font, 'image')
    const pdfLayout = layoutReceipt(long, font, 'pdf')
    expect(pdfLayout.pages.length).toBeGreaterThan(1)
    expect(imageLayout.pages).toHaveLength(1)
    expect(layoutTexts(imageLayout, ['content'])).toEqual(layoutTexts(pdfLayout, ['content']))
    expect(layoutTexts(imageLayout, ['notice'])).toEqual([LEGAL_NOTICE])
    expect(layoutTexts(imageLayout).at(-1)).toBe(LEGAL_NOTICE)
    const tall = decodePng(renderReceiptPng(long, font))
    expect(tall.width).toBe(1080)
    expect(tall.height).toBeGreaterThan(image.height * 2)
  })

  it('같은 확인서·글꼴이면 같은 바이트 (글꼴 바이트로 넘기든 읽어 둔 글꼴로 넘기든)', () => {
    expect(renderReceiptPng(data, font)).toEqual(png)
  })

  it('개인정보: 이미지에 그리는 글자에 전화번호 전체·ref·구매자 ID·채널 ID·조정 사유가 없다 (AC-P2-27)', () => {
    for (const buyer of ['UC_A', 'sms:s1']) {
      const text = layoutTexts(layoutReceipt(receipt(G201, buyer), font, 'image')).join(' ')
      for (const secret of ['010-1234-5678', '01012345678', 'sms:', 'UC_', '단골 할인']) expect(text).not.toContain(secret)
    }
    expect(layoutTexts(layoutReceipt(receipt(G201, 'sms:s1'), font, 'image'))).toContain('5678')
  })

  it('그릴 수 없는 글자는 빼고 그린다 (🌵다육맘 → 다육맘)', () => {
    const emoji = receipt(play(sale(1, 'UC_A', '🌵다육맘\n')), 'UC_A')
    const texts = layoutTexts(layoutReceipt(emoji, font, 'image'))
    expect(texts[texts.indexOf('구매자') + 1]).toBe('다육맘')
    expect(decodePng(renderReceiptPng(emoji, font)).width).toBe(1080)
  })
})
