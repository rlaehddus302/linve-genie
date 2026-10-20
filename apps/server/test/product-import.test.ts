// AC-I2-50 상품 목록 가져오기 해석 함수 (R-18, D-I2-09) — 골든 밖의 단위 시험: 500·501줄 경계, 어떤 입력에도 예외 없음, 시간은 입력 길이에 비례,
// 넘긴 값을 바꾸지 않음, .xlsx 행 입구가 같은 규칙을 씀, 정규화·금액·휴대폰 번호 판단이 코어 함수와 같음.
import { containsPhoneRun, normalizeText, parseAmount } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { IMPORT_MAX_ROWS, parseProductList, parseProductRows, recheckRows, splitCells, splitImportLines } from '../src/product-import.ts'

const lines = (n: number, start = 1) => Array.from({ length: n }, (_, i) => `${String(start + i)}\t품종${String(i)}\t10000`).join('\n')

describe('AC-I2-50 전체 상한 (R-18 10)', () => {
  it('상품 줄 500개 → 500줄 결과, 501개 → TOO_MANY (빈 줄·머리글은 세지 않는다)', () => {
    const ok = parseProductList(`번호\t품종\t가격\n\n${lines(IMPORT_MAX_ROWS)}\n\n   \n`, { maxNumber: 9999 })
    expect('rows' in ok && ok.rows.length).toBe(500)
    expect('rows' in ok && ok.header).toBe(1)
    expect('rows' in ok && ok.rows.every((row) => !('error' in row))).toBe(true)
    expect(parseProductList(`번호\t품종\t가격\n${lines(501)}`, { maxNumber: 9999 })).toEqual({ error: 'TOO_MANY' })
    expect(parseProductList(lines(501), { maxNumber: 9999 })).toEqual({ error: 'TOO_MANY' })
    // 문제 줄도 상품 줄로 센다
    expect(parseProductList(`${lines(500)}\n칸하나`, { maxNumber: 9999 })).toEqual({ error: 'TOO_MANY' })
  })

  it('.xlsx 행 입구도 같은 상한 — 칸이 모두 빈 행은 세지 않는다', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ line: i + 2, cells: [String(i + 1), '핑크', '10000'] }))
    expect(parseProductRows([{ line: 1, cells: ['번호', '품종', '가격'] }, ...rows.slice(0, 500), { line: 900, cells: ['', ' ', '\t'] }], { maxNumber: 9999 })).toMatchObject({ header: 1 })
    expect(parseProductRows(rows, { maxNumber: 9999 })).toEqual({ error: 'TOO_MANY' })
  })
})

describe('AC-I2-50 예외를 던지지 않는다', () => {
  it('문자열이 아닌 값은 EMPTY', () => {
    for (const value of [undefined, null, 15, {}, [], ['15,핑크,10000'], Symbol('x'), () => '15,a,1000']) {
      expect(parseProductList(value)).toEqual({ error: 'EMPTY' })
    }
    expect(parseProductRows('15,핑크,10000')).toEqual({ error: 'EMPTY' })
    expect(parseProductRows([null, 1, { line: 0, cells: [] }, { line: 'x', cells: [] }, { line: 1, cells: 'abc' }])).toEqual({ error: 'EMPTY' })
  })

  it('설정이 틀리면 기본값(THOUSAND·999)으로 본다', () => {
    const expected = parseProductList('15\t핑크\t10', {})
    expect(expected).toEqual({ header: null, rows: [{ line: 1, no: 15, name: '핑크', price: 10000 }] })
    for (const settings of [null, 7, { unit: 'YEN', maxNumber: 0, existing: '15' }, { maxNumber: 1.5, existing: [null, 'x'] }]) {
      expect(parseProductList('15\t핑크\t10', settings as never)).toEqual(expected)
    }
  })

  it('임의 문자열·제어 글자·짝 없는 서로게이트에도 결과 모양이 맞다', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), fc.constantFrom('WON', 'THOUSAND'), (text, unit) => {
        const result = parseProductList(text, { unit, maxNumber: 999, existing: [3] })
        if ('error' in result) {
          expect(['EMPTY', 'TOO_MANY']).toContain(result.error)
          return
        }
        expect(result.header === null || Number.isInteger(result.header)).toBe(true)
        let previous = 0
        for (const row of result.rows) {
          expect(row.line).toBeGreaterThan(previous)
          previous = row.line
          if ('error' in row) expect(Object.keys(row).sort()).toEqual(['error', 'line'])
          else {
            expect(Object.keys(row).sort()).toEqual(['line', 'name', 'no', 'price'])
            expect(row.price).toBeGreaterThanOrEqual(100)
            expect(row.no).toBeGreaterThanOrEqual(1)
            expect(normalizeText(row.name)).toBe(row.name)
            expect(containsPhoneRun(row.name)).toBe(false)
          }
        }
      }),
      { numRuns: 2000, seed: 20261020 },
    )
  })

  it('넘긴 값을 바꾸지 않는다', () => {
    const existing = Object.freeze([3, 30])
    const settings = Object.freeze({ unit: 'THOUSAND', maxNumber: 999, existing })
    const rows = Object.freeze([Object.freeze({ line: 1, cells: Object.freeze(['3', '핑크', '10']) })])
    expect(() => parseProductList('3\t핑크\t10\n4\t라울\t5', settings)).not.toThrow()
    expect(() => parseProductRows(rows, settings)).not.toThrow()
    expect(existing).toEqual([3, 30])
  })
})

describe('AC-I2-50 시간은 입력 길이에 비례한다', () => {
  it('1MB 글(긴 줄 하나·짝 없는 따옴표 수천 개·줄 수천 개)도 1초 안', () => {
    const inputs = [
      `"${'"'.repeat(2_000)}${'가'.repeat(1_000_000)}`,
      `15,"${'""'.repeat(400_000)},10000`,
      Array.from({ length: 20_000 }, (_, i) => `${String(i)},"핑크${'"'.repeat(30)}`).join('\n'),
      `${'1'.repeat(1_000_000)},핑크,${'2'.repeat(10)}`,
      `15\t${'0'.repeat(500_000)}\t${'1,000,'.repeat(80_000)}`,
      Array.from({ length: 400 }, (_, i) => `${String(i + 1)}\t${'ㅡ0'.repeat(600)}\t${'만'.repeat(600)}`).join('\r\n'),
    ]
    for (const text of inputs) {
      const started = performance.now()
      const result = parseProductList(text, { maxNumber: 9999 })
      const elapsed = performance.now() - started
      expect(result).toBeDefined()
      expect(elapsed, `${String(text.length)}글자`).toBeLessThan(1000)
    }
  })
})

describe('R-18 세부 — 코어 함수를 다시 쓴다', () => {
  it('정규화 = normalizeText, 가격 = parseAmount(price.unit), 휴대폰 번호 = containsPhoneRun', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }),
        fc.string({ maxLength: 12 }),
        fc.constantFrom('WON', 'THOUSAND'),
        (name, price, unit) => {
          const clean = (text: string) => text.replace(/[\t,"\r\n]/g, '')
          const n = clean(name)
          const p = clean(price)
          const result = parseProductList(`7\t${n}\t${p}`, { unit, maxNumber: 9999 })
          if (!('rows' in result)) return
          const row = result.rows[0]
          if (row === undefined) return
          const name2 = normalizeText(n)
          const amount = normalizeText(p) === '' ? null : parseAmount(p, { 'price.unit': unit })
          if (containsPhoneRun(name2)) expect(row).toEqual({ line: 1, error: 'NAME_PHONE' })
          else if (normalizeText(p) === '') expect(row).toEqual({ line: 1, error: 'PRICE_MISSING' })
          else if (amount === null) expect(row).toEqual({ line: 1, error: 'PRICE_INVALID' })
          else if (amount < 100) expect(row).toEqual({ line: 1, error: 'PRICE_TOO_LOW' })
          else expect(row).toEqual({ line: 1, no: 7, name: name2, price: amount })
        },
      ),
      { numRuns: 2000, seed: 1018 },
    )
  })

  it('줄 나누기: 맨 앞 BOM 하나만 지우고, \\r\\n·\\n·\\r로 나누며 줄 번호는 빈 줄도 센다', () => {
    expect(splitImportLines('﻿﻿a\r\nb\rc\n\nd')).toEqual([
      { line: 1, text: '﻿a' },
      { line: 2, text: 'b' },
      { line: 3, text: 'c' },
      { line: 4, text: '' },
      { line: 5, text: 'd' },
    ])
    expect(splitImportLines('')).toEqual([{ line: 1, text: '' }])
  })

  it('칸 나누기: 탭이 있으면 탭, 따옴표 칸 안의 나누는 글자는 글자, 닫는 따옴표 뒤 다른 글자·닫히지 않음은 null', () => {
    expect(splitCells('1,"a,b",3')).toEqual(['1', 'a,b', '3'])
    expect(splitCells('1\t"a\tb"\t3')).toEqual(['1', 'a\tb', '3'])
    expect(splitCells('1,"a""b""",3')).toEqual(['1', 'a"b"', '3'])
    expect(splitCells('1,a"b,3')).toEqual(['1', 'a"b', '3'])
    expect(splitCells('1, "a",3')).toEqual(['1', ' "a"', '3'])
    expect(splitCells('1,"a"b,3')).toBeNull()
    expect(splitCells('1,"ab,3')).toBeNull()
    expect(splitCells('1,,')).toEqual(['1', '', ''])
    expect(splitCells('"",""')).toEqual(['', ''])
  })

  it('.xlsx 행: 줄 번호 = 행 번호, 따옴표 규칙 없음, 넷째 칸부터 빈 칸 지우기, 첫 행 머리글', () => {
    expect(
      parseProductRows(
        [
          { line: 1, cells: ['번호', '품종', '가격'] },
          { line: 3, cells: ['15', '"핑크"', '8.5', '', ''] },
          { line: 4, cells: ['16', '라울'] },
          { line: 5, cells: ['', '라울', '10000', 'x'] },
        ],
        { unit: 'THOUSAND' },
      ),
    ).toEqual({
      header: 1,
      rows: [
        { line: 3, no: 15, name: '"핑크"', price: 8500 },
        { line: 4, error: 'CELLS' },
        { line: 5, error: 'CELLS' },
      ],
    })
  })

  it('등록 직전 다시 검사 (R-18 11): 번호 범위·목록 안 같은 번호·이미 있는 번호·품종 휴대폰 번호·가격 100원 이상 정수', () => {
    expect(
      recheckRows(
        [
          { no: 1, name: '핑크', price: 1000 },
          { no: 1000, name: '핑크', price: 1000 },
          { no: 5, name: '핑크', price: 1000 },
          { no: 6, name: '핑크', price: 1000 },
          { no: 6, name: '라울', price: 1000 },
          { no: 7, name: '김 010-1234-5678', price: 1000 },
          { no: 8, name: '핑크', price: 50 },
          { no: 9, name: '핑크', price: 100.5 },
        ],
        { maxNumber: 999, existing: [5] },
      ),
    ).toEqual([null, 'NUMBER_INVALID', 'EXISTS', 'DUPLICATE', 'DUPLICATE', 'NAME_PHONE', 'PRICE_TOO_LOW', 'PRICE_TOO_LOW'])
  })
})
