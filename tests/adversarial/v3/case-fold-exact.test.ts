// V3 적대 시험 (test-domain, D-V3-120, AC-V3-100 (m), R-17 5·8, D-V3-115·116): 공백만 다른 맞춤의 로마자 대소문자 무시를 공격한다.
// 노리는 것: 대소문자 무시가 0.8·한 글자 다른 맞춤까지 넓혀 영수증 이름(exactOnly)이 비슷한 말에 맞음, 한 로마자만 다른 말이 맞음,
// 결과가 사전 이름이 아니라 들은 소문자 모양이 됨, 배운 별칭이 대소문자만 다른 꼴로 사전 이름을 가로챔, 이번 방송 이름의 exactOnly가 대소문자 때문에 풀림.
// 문장은 모두 만든 문장이다 (실방송 원문·닉네임 없음).
import { DEFAULT_DICTIONARY, DEFAULT_VARIETIES, canLearnAlias, prepareVoiceDictionary, readRegistration, readSegments } from '@livejjim/voice'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const DICT = prepareVoiceDictionary()
type Dict = ReturnType<typeof prepareVoiceDictionary>
const nameOf = (text: string, dictionary: Dict = DICT): string | null | undefined => {
  const picks = readSegments(text, { dictionary, final: true, maxNumber: 999 }).picks
  expect(picks, text).toHaveLength(1)
  return picks[0]?.name
}

describe('D-V3-120 — 공백·대소문자만 다르면 사전 이름 그대로', () => {
  it.each([
    ['12번 Sp창금 30만 원', 'SP창금'],
    ['12번 sP 창금 30만 원', 'SP창금'],
    ['12번 sp 창금 30만 원', 'SP창금'],
    ['12번 Ufo 녹금 30만 원', 'UFO 녹금'],
    ['12번 ufo녹금 30만 원', 'UFO 녹금'],
    ['12번 Bts 30만 원', 'BTS'],
    ['12번 bt s 30만 원', 'BTS'],
    ['12번 fbi 30만 원', 'FBI'],
    ['12번 gm 30만 원', 'GM'],
    ['12번 sp 골드 30만 원', 'SP골드'],
    ['12번 sp 아리아 골드 30만 원', 'SP아리아골드'],
    ['12번 bts 금무지 30만 원', 'BTS금무지'],
  ])('"%s" → %s (들은 소문자 모양이 아니라 사전 이름)', (text, name) => {
    expect(nameOf(text)).toBe(name)
    const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
    expect(ready?.name).toBe(name)
    expect(ready?.nameNeedsCheck).toBe(false)
  })
})

describe('D-V3-120 — 대소문자 무시는 0.8·한 글자 다른 맞춤을 넓히지 않는다', () => {
  // 영수증 이름(exactOnly)은 대소문자를 무시해도 한 자모 다르면 맞지 않는다 — 짧은 SP·BTS·UFO만 맞거나 비움
  it.each([
    ['12번 sp 창곰 30만 원', 'SP'],
    ['12번 sp창곰 30만 원', null],
    ['12번 SP창곰 30만 원', null],
    ['12번 sp 찬금 30만 원', 'SP'],
    ['12번 sp 골도 30만 원', 'SP'],
    ['12번 sp 아리아 골도 30만 원', 'SP'],
    ['12번 bts 금무치 30만 원', 'BTS'],
    ['12번 ufo 녹곰 30만 원', 'UFO'],
  ])('영수증 이름과 한 자모 다른 "%s" → %s (긴 영수증 이름 아님)', (text, name) => {
    expect(nameOf(text)).toBe(name)
  })

  // 로마자 한 글자만 다른 말은 대소문자 무시로 맞는 것이 아니다
  it.each(['12번 btx 30만 원', '12번 fbl 30만 원', '12번 ufc 30만 원', '12번 gn 30만 원', '12번 sb창금 30만 원'])('로마자 한 글자 다른 "%s" → 품종 비움', (text) => {
    expect(nameOf(text)).toBeNull()
  })

  // SP녹금은 0.8 후보(exactOnly 아님): 거리는 원래 글로 잰다 — 대문자 꼴은 지금처럼 맞고, 소문자로 적었다고 0.8이 넓어지지 않는다
  it('0.8 후보 SP녹금: "SP녹곰"은 지금처럼 SP녹금, "sp녹곰"·"Sp녹곰"은 대소문자 무시로 맞추지 않는다', () => {
    expect(nameOf('12번 SP녹곰 30만 원')).toBe('SP녹금')
    expect(nameOf('12번 sp녹곰 30만 원')).toBeNull()
    expect(nameOf('12번 Sp녹곰 30만 원')).toBeNull()
  })

  it('판매 이력 이름(0.8 후보) SP창금: "SP창곰"은 이력 0.8로 맞고, "sp창곰"은 대소문자 무시로 넓어지지 않는다', () => {
    const history = prepareVoiceDictionary({ history: ['SP창금'] })
    expect(nameOf('12번 SP창곰 30만 원', history)).toBe('SP창금')
    expect(nameOf('12번 sp창곰 30만 원', history)).toBeNull()
  })

  // D-V3-116 (마): 이번 방송 이름이 영수증 이름과 공백만 다르면(대소문자도 무시) 이력 자리에서도 exactOnly 그대로
  it.each([
    [['sp창금'], ['SP창금']],
    [['SP창금'], ['sp 창금']],
  ])('이력 %j · 이번 방송 %j → "SP창곰"·"sp창곰"은 비움 (대소문자 섞여도 exactOnly가 풀리지 않음)', (history, current) => {
    const now = prepareVoiceDictionary({ history, current })
    expect(nameOf('12번 SP창곰 30만 원', now)).toBeNull()
    expect(nameOf('12번 sp창곰 30만 원', now)).toBeNull()
  })
})

describe('D-V3-120 — 배운 별칭이 대소문자만 다른 꼴로 사전 이름을 가로채지 못한다 (D-V2-17)', () => {
  it('"Ufo"·"sP창금"은 사전 이름과 같은 모양이라 배우지 않는다', () => {
    expect(canLearnAlias('Ufo', '라울')).toBe(false)
    expect(canLearnAlias('sP창금', '보니타')).toBe(false)
  })
  it('이미 저장된 별칭 "Ufo → 라울"·"sp창금 → 보니타"는 버리고 사전 이름이 이긴다', () => {
    const dictionary = prepareVoiceDictionary({ learned: [{ heard: 'Ufo', name: '라울', usedAt: 0 }, { heard: 'sp창금', name: '보니타', usedAt: 0 }] })
    expect(nameOf('12번 ufo 30만 원', dictionary)).toBe('UFO')
    expect(nameOf('12번 sp창금 30만 원', dictionary)).toBe('SP창금')
  })
})

describe('D-V3-120 — 사전 밖 낱말 zeta 전제 (다른 적대 시험이 쓰는 낱말)', () => {
  it.each(['zeta', 'Zeta', 'ZETA'])('"%s"는 사전에 없다 → 품종 비움', (word) => {
    const forms = DEFAULT_VARIETIES.flatMap((item) => [item.name, ...(item.aliases ?? [])])
    expect(forms.some((form) => form.replace(/\s/g, '').toLowerCase() === word.toLowerCase())).toBe(false)
    expect(nameOf(`12번 ${word} 30만 원`)).toBeNull()
  })
})

describe('D-V3-120 — 성질: 로마자 대소문자를 마구 섞어도 품종은 사전 이름 그대로이거나 빈칸', () => {
  const NAMES = new Set(DEFAULT_DICTIONARY)
  const VOCAB = ['자', '요 아이', '이거', 'sp', '창금', '창곰', 'sp창금', '녹금', '녹곰', 'bts', 'ufo', 'fbi', 'gm', '골드', '아리아', 'zeta', '금무지', '라울', '예쁘죠'] as const
  const flip = (word: string, mask: readonly boolean[]): string => [...word].map((char, i) => (mask[i % mask.length] === true ? char.toUpperCase() : char)).join('')

  it('무작위 문장 · 무작위 대소문자 → 등록 품종은 null이거나 기본 사전 이름(들은 모양 아님)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...VOCAB), fc.array(fc.boolean(), { minLength: 1, maxLength: 4 })), { minLength: 1, maxLength: 5 }),
        (words) => {
          const text = `12번 ${words.map(([word, mask]) => flip(word, mask)).join(' ')} 30만 원`
          const ready = readRegistration(text, { dictionary: DICT, final: true }).ready
          if (ready === null || ready.name === null) return
          expect(NAMES.has(ready.name), text).toBe(true)
        },
      ),
      { numRuns: 600 },
    )
  })
})
