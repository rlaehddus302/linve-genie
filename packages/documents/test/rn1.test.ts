// AC-RN1-08 문서 정보 이름(확인서·영수증 PDF·운송장 PDF·판매대장 엑셀) · AC-RN1-09 이름 상수 한 곳 · AC-RN1-10 보이는 소스에 옛 이름 0개 (UX-01, D-RN1-03·04)
import { readFileSync, readdirSync } from 'node:fs'
import type { EngineState } from '@livejjim/core'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { SERVICE_NAME, buildReceipt, ledgerToXlsx, renderReceiptPdf, renderReceiptsPdf, renderWaybillsPdf, type ReceiptData, type WaybillData } from '../src/index.ts'
import { fontBytes, replayGolden } from './helpers.ts'

const OLD_NAME = '라이브' + '찜'
const SRC = new URL('../src/', import.meta.url)
const SHOP = { name: '초록다육', account: { bank: '농협', number: '302-9988-7766-11', holder: '김판매' }, accountNote: '' }
const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)

function receipt(state: EngineState, buyer: string): ReceiptData {
  const result = buildReceipt({ state, buyer, date: '2026-10-18', shop: SHOP, rehearsal: false, createdAt: CREATED })
  if (!result.ok) throw new Error(result.error.message)
  return result.receipt
}

/** 줄 주석과 블록 주석을 지운 소스. 문자열·템플릿 안의 // 는 지우지 않는다 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i] as string
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1
      out += source.slice(i, j + 1)
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

/** 주석 밖에 나오는 글자 수 */
function countOutsideComments(source: string, word: string): number {
  return stripComments(source).split(word).length - 1
}

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(new URL(name, SRC), 'utf8') }))
}

describe('AC-RN1-08 문서 정보의 서비스 이름', () => {
  it('확인서 PDF(한 명)의 만든 프로그램·생성기가 라이브지니', async () => {
    const pdf = await PDFDocument.load(await renderReceiptPdf(receipt(replayGolden('G-ENG-201'), 'UC_A'), fontBytes()), { updateMetadata: false })
    expect(pdf.getCreator()).toBe('라이브지니')
    expect(pdf.getProducer()).toBe('라이브지니')
  })

  it('여러 명을 묶은 PDF도 같다', async () => {
    const state = replayGolden('G-ENG-201')
    const pdf = await PDFDocument.load(await renderReceiptsPdf([receipt(state, 'UC_A'), receipt(state, 'UC_A')], fontBytes()), { updateMetadata: false })
    expect(pdf.getCreator()).toBe('라이브지니')
    expect(pdf.getProducer()).toBe('라이브지니')
  })

  it('운송장 PDF(T1)의 만든 프로그램·생성기도 라이브지니', async () => {
    const waybill: WaybillData = {
      carrier: 'FAKE',
      invoice: '900000000001',
      receiver: { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '서울시청 3층', zip: '04524', memo: '' },
      sender: { name: '다육이네', phone: '0311234567', address: '경기도 성남시 분당구 판교역로 1' },
      itemCount: 1,
      box: '80', // FB1 D-FB1-05 — 택배 크기 코드
      bookedDate: '2026-10-22',
    }
    const result = await renderWaybillsPdf([waybill], fontBytes())
    if (result.pdf === null) throw new Error('운송장 PDF를 만들지 못했어요')
    const pdf = await PDFDocument.load(result.pdf, { updateMetadata: false })
    expect(pdf.getCreator()).toBe('라이브지니')
    expect(pdf.getProducer()).toBe('라이브지니')
  })

  it('판매대장 엑셀의 만든 이가 라이브지니', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await ledgerToXlsx([])) as unknown as ArrayBuffer)
    expect(workbook.creator).toBe('라이브지니')
  })
})

describe('AC-RN1-09 이름 상수', () => {
  it('SERVICE_NAME = 라이브지니', () => {
    expect(SERVICE_NAME).toBe('라이브지니')
  })

  it('라이브지니 글자는 상수 파일 한 곳에만 있다', () => {
    const holders = sourceFiles().filter((file) => countOutsideComments(file.text, SERVICE_NAME) > 0).map((file) => file.name)
    expect(holders).toEqual(['brand.ts'])
    expect(countOutsideComments(readFileSync(new URL('brand.ts', SRC), 'utf8'), SERVICE_NAME)).toBe(1)
  })
})

describe('AC-RN1-10 packages/documents/src 주석 밖 옛 이름 0개', () => {
  it('src 파일마다 0개', () => {
    const found = sourceFiles()
      .map((file) => ({ name: file.name, count: countOutsideComments(file.text, OLD_NAME) }))
      .filter((file) => file.count > 0)
    expect(found).toEqual([])
  })

  it('검사가 실제로 잡는다: 문장에 넣으면 세고, 주석에만 있으면 세지 않는다', () => {
    expect(countOutsideComments(`doc.setCreator('${OLD_NAME}')`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`const a = \`${OLD_NAME} 확인서\` // ${OLD_NAME}`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`const url = 'https://x.y/${OLD_NAME}'`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`// ${OLD_NAME}\n/* ${OLD_NAME} */\nconst a = 1`, OLD_NAME)).toBe(0)
  })
})
