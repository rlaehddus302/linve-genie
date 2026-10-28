// 크롬 받아쓰기 '창금' → '창근' (재생 채점: 한 판매자 녹음에서만 자주 나옴) — 기본 사전 창금(exactOnly)의 별칭 '창근'. 만든 문장.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractVoice, prepareVoiceDictionary, readSegments } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const read = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => [p.no, p.name, p.price])
const file = JSON.parse(readFileSync(new URL('../data/varieties.ko.json', import.meta.url), 'utf8')) as { varieties: { name: string; aliases: string[]; exactOnly?: boolean; receipt?: boolean }[] }

describe("창금의 별칭 '창근'", () => {
  it('데이터: 창금(손으로 고른 이름, exactOnly 그대로)의 별칭에 창근, 영수증 이름 SP창금엔 별칭을 더하지 않음(D-V3-115)', () => {
    const entry = file.varieties.find((item) => item.name === '창금')
    expect(entry?.aliases).toContain('창근')
    expect(entry?.exactOnly).toBe(true)
    expect(entry?.receipt).toBeUndefined()
    expect(file.varieties.find((item) => item.name === 'SP창금')?.aliases).toEqual([])
  })

  it('"12번 창근 30만 원" → 12번 · 창금 · 300,000원 (끝말 붙은 꼴·가격 뒤 번호도)', () => {
    expect(read('12번 창근 30만 원')).toEqual([[12, '창금', 300_000]])
    expect(read('12번 창근이 30만 원')).toEqual([[12, '창금', 300_000]])
    expect(read('창근 30만 원 12번')).toEqual([[12, '창금', 300_000]])
    expect(extractVoice('12번 창근 30만 원', { dictionary: DICT }).name).toBe('창금')
  })

  it('"12번 sp 창근 30만 원" → 품종 빈 칸으로 고정 — SP와 창금이 따로 맞고 어느 쪽도 다른 쪽을 품지 않아 비움(R-17 5, 별칭 전엔 SP만 들어가던 것)', () => {
    // SP창금은 영수증 이름이라 별칭 없이 공백만 다른 모양으로만 맞는다 — '창근'으로 들린 꼴은 SP창금이 아니다
    for (const text of ['12번 sp 창근 30만 원', '12번 SP 창근 30만 원', '12번 에스피 창근 30만 원']) expect(read(text), text).toEqual([[12, null, 300_000]])
    // 똑같이 들리면 SP창금 — 소문자 `sp 창금`도 (D-V3-120 대소문자 무시, AC-V3-100 (m)). `에스피 창금`(한글 읽기)은 아직 빈 칸
    expect(read('12번 SP 창금 30만 원')).toEqual([[12, 'SP창금', 300_000]])
    expect(read('12번 sp 창금 30만 원')).toEqual([[12, 'SP창금', 300_000]])
    expect(read('12번 에스피 창금 30만 원')).toEqual([[12, null, 300_000]])
  })

  it("'창근'은 공백만 다를 때만 — 한 자모·한 글자 다른 꼴(장근·창군·창곤)은 창금이 되지 않는다", () => {
    for (const text of ['12번 장근 30만 원', '12번 창군 30만 원', '12번 창곤 30만 원']) {
      expect(read(text), text).toEqual([[12, null, 300_000]])
      expect(extractVoice(text, { dictionary: DICT }).name, text).toBeNull()
    }
  })
})
