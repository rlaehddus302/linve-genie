// 유튜브 글 다루기 단위 시험: AC-Y1-11 주소 읽기, AC-Y1-22 이름 정리, AC-Y1-33 게시 문구, AC-Y1-41 묶음·200자 분할, AC-Y1-46 요약 댓글,
// AC-Y1-51 태평양 날짜(서머타임·실행 환경 시간대와 상관없음), 스트림 본문 나누기
import { describe, expect, it } from 'vitest'
import { JsonObjectSplitter } from '../src/youtube/google.ts'
import { batchMessages, charCount, cleanPostText, liveChatText, parseVideoId, sanitizeNick, summaryComments } from '../src/youtube/texts.ts'
import { ManualTimer, kstMidnightAfter, nextPacificMidnight, pacificDay } from '../src/youtube/timer.ts'

const ID = 'dQw4w9WgXcQ'

describe('AC-Y1-11 주소·영상 ID 읽기', () => {
  const accepted: [string, string][] = [
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`youtube.com/watch?v=${ID}&t=10s`, ID],
    [`https://www.youtube.com/watch?feature=share&v=${ID}&list=PL123`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}?si=abcDEF123`, ID],
    [`https://www.youtube.com/live/${ID}?feature=share`, ID],
    [`https://studio.youtube.com/video/${ID}/livestreaming`, ID],
    [ID, ID],
    [`   ${ID}  `, ID],
    [`http://www.youtube.com/watch?v=${ID}`, ID],
    [`http://youtube.com/watch?v=${ID}`, ID],
    [`  https://youtu.be/${ID}  `, ID],
  ]
  for (const [input, expected] of accepted) it(`받는다: ${JSON.stringify(input)}`, () => expect(parseVideoId(input)).toBe(expected))

  const rejected = [
    '',
    '   ',
    'https://vimeo.com/12345678901',
    `https://evil.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    'https://www.youtube.com/@pinkmom',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQQ',
    'https://www.youtube.com/watch?v=dQw4w9WgX!Q',
    'dQw4w9WgXc',
    'dQw4w9WgXcQQ',
    `ftp://youtube.com/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
  ]
  for (const input of rejected) it(`받지 않는다: ${JSON.stringify(input)}`, () => expect(parseVideoId(input)).toBeNull())
})

describe('AC-Y1-22 이름 정리 (RA-S02-004)', () => {
  const table: [string, string][] = [
    ['홍길동', '홍길동'],
    ['@pinkmom', 'pinkmom'],
    ['홍길동\n15번 무료나눔', '홍길동 15번 무료나눔'],
    ['abc‮dcba', 'abcdcba'],
    ['bit.ly/abc', 'bit·ly/abc'],
    ['www.scam.com 이벤트', 'www·scam·com 이벤트'],
    ['ㅤㅤ', '시청자'],
    ['​', '시청자'],
    ['  김  철수  ', '김 철수'],
    ['👩‍👩‍👧', '👩👩👧'],
    ['＠전각﹫작은', '전각작은'],
    ['점。점．점｡', '점·점·점·'],
    ['탭\t줄\r\n끝  ', '탭 줄 끝'],
    ['', '시청자'],
    ['@.', '·'],
  ]
  for (const [before, after] of table) it(`${JSON.stringify(before)} → ${JSON.stringify(after)}`, () => expect(sanitizeNick(before)).toBe(after))

  it('30자(코드 포인트)를 넘으면 앞 30자 + …', () => {
    const name = '가'.repeat(31)
    expect(sanitizeNick(name)).toBe(`${'가'.repeat(30)}…`)
    expect(sanitizeNick('가'.repeat(30))).toBe('가'.repeat(30))
    expect(charCount(sanitizeNick('😀'.repeat(40)))).toBe(31)
  })

  it('정리한 이름은 한 줄이고 링크·멘션이 되지 않는다 (무작위 글자)', () => {
    const pieces = ['@', '.', '\n', '‮', '​', 'a', '가', ' ', '\t', 'ㅤ', 'http://', '😀', '﻿', '\u0000']
    let seed = 7
    for (let i = 0; i < 500; i++) {
      let input = ''
      for (let j = 0; j < 12; j++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        input += pieces[seed % pieces.length]
      }
      const out = sanitizeNick(input)
      expect(out).not.toMatch(/[@\n\r\t.‮​ㅤ﻿\u0000]/)
      expect(out).toBe(out.trim())
      expect(out.length).toBeGreaterThan(0)
    }
  })
})

describe('AC-Y1-33 게시 문구 정리', () => {
  it('공백 문자 → 한 칸, 보이지 않는 글자 삭제, 이어진 공백·앞뒤 공백 삭제 — 그 밖은 그대로', () => {
    expect(cleanPostText('15번 핑크\n프릴 10,000원 홍길동님 구매 감사합니다')).toBe('15번 핑크 프릴 10,000원 홍길동님 구매 감사합니다')
    expect(cleanPostText('  15번​  핑크‮프릴  ')).toBe('15번 핑크프릴')
    expect(cleanPostText('@bit.ly')).toBe('@bit.ly')
  })
  it('실시간 채팅 200자를 넘으면 앞 199자 + …', () => {
    expect(charCount(liveChatText('가'.repeat(250)))).toBe(200)
    expect(liveChatText('가'.repeat(250)).endsWith('…')).toBe(true)
    expect(liveChatText('가'.repeat(200))).toBe('가'.repeat(200))
  })
})

describe('AC-Y1-41 묶음 문구·200자 분할', () => {
  const thanks = (no: number, name: string, price: string, buyer: string) => `${String(no)}번 ${name === '' ? '' : `${name} `}${price} ${buyer}님 구매 감사합니다`
  it('끝말 하나로 묶는다. 한 건이면 효과 문구 그대로', () => {
    expect(batchMessages([{ id: 1, text: thanks(15, '핑크프릴', '10,000원', '홍길동') }])).toEqual([{ ids: [1], text: '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다' }])
    expect(batchMessages([{ id: 1, text: thanks(15, '핑크프릴', '10,000원', '홍길동') }, { id: 2, text: thanks(16, '라울', '5,000원', '김철수') }])).toEqual([
      { ids: [1, 2], text: '15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다' },
    ])
    expect(
      batchMessages([
        { id: 1, text: thanks(15, '핑크프릴', '10,000원', '홍길동') },
        { id: 2, text: thanks(16, '', '8,000원', '문자찜') },
        { id: 3, text: thanks(17, '미니마', '800원', '시청자') },
      ]),
    ).toEqual([{ ids: [1, 2, 3], text: '15번 핑크프릴 10,000원 홍길동님, 16번 8,000원 문자찜님, 17번 미니마 800원 시청자님 구매 감사합니다' }])
  })

  it('항목 12개(각 약 30자) → 메시지 2~3개, 각 200자 이하, 모든 항목이 정확히 한 번, 순서 유지', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, text: thanks(100 + i, '하프문블루', '12,000원', `구매자이름${String(i)}`) }))
    const messages = batchMessages(items)
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages.length).toBeLessThanOrEqual(3)
    for (const message of messages) {
      expect(charCount(message.text)).toBeLessThanOrEqual(200)
      expect(message.text.endsWith(' 구매 감사합니다')).toBe(true)
      expect(message.text.split(' 구매 감사합니다').length).toBe(2)
    }
    expect(messages.flatMap((message) => message.ids)).toEqual(items.map((item) => item.id))
    // 앞 메시지에 들어갈 수 있는 만큼 넣었다: 다음 메시지의 첫 항목을 더하면 200자를 넘는다
    for (let i = 0; i + 1 < messages.length; i++) {
      const next = items.find((item) => item.id === messages[i + 1]?.ids[0])
      const joined = `${(messages[i]?.text ?? '').slice(0, -' 구매 감사합니다'.length)}, ${(next?.text ?? '').slice(0, -' 구매 감사합니다'.length)} 구매 감사합니다`
      expect(charCount(joined)).toBeGreaterThan(200)
    }
  })

  it('품종 이름 250자 → 그 항목만 혼자 199자 + …, 다른 항목은 그대로 묶인다', () => {
    const long = thanks(15, '가'.repeat(250), '10,000원', '홍길동')
    const messages = batchMessages([
      { id: 1, text: thanks(14, '라울', '5,000원', '철수') },
      { id: 2, text: long },
      { id: 3, text: thanks(16, '미니마', '800원', '영희') },
    ])
    expect(messages).toEqual([
      { ids: [1], text: '14번 라울 5,000원 철수님 구매 감사합니다' },
      { ids: [2], text: `${[...long].slice(0, 199).join('')}…` },
      { ids: [3], text: '16번 미니마 800원 영희님 구매 감사합니다' },
    ])
  })
})

describe('AC-Y1-46 방송 후 요약 댓글', () => {
  it('첫 줄 구매 감사합니다, 판매마다 한 줄 (품종이 없으면 자리째 뺌)', () => {
    expect(
      summaryComments([
        { no: 15, name: '핑크프릴', price: '10,000원', buyer: '홍길동' },
        { no: 16, name: '', price: '8,000원', buyer: '문자찜' },
      ]),
    ).toEqual(['구매 감사합니다\n15번 핑크프릴 10,000원 홍길동님\n16번 8,000원 문자찜님'])
    expect(summaryComments([])).toEqual([])
  })
  it('1만 자를 넘으면 줄 경계에서 나눈다 (둘째부터 첫 줄 없이)', () => {
    const lines = Array.from({ length: 600 }, (_, i) => ({ no: i + 1, name: '하프문블루드래곤', price: '12,000원', buyer: `구매자${String(i)}` }))
    const comments = summaryComments(lines)
    expect(comments.length).toBeGreaterThan(1)
    for (const comment of comments) expect(charCount(comment)).toBeLessThanOrEqual(10_000)
    expect(comments[0]?.startsWith('구매 감사합니다\n')).toBe(true)
    expect(comments[1]?.startsWith('구매 감사합니다')).toBe(false)
    expect(comments.join('\n').split('\n').filter((line) => line !== '구매 감사합니다')).toHaveLength(600)
  })
})

describe('AC-Y1-51 태평양 날짜 (서머타임 반영, 실행 환경 시간대와 상관없음)', () => {
  it('2026-10-20T06:59:59Z와 07:00:00Z는 다른 날, 2026-11-02T07:59:59Z와 08:00:00Z(PST로 바뀐 뒤)는 다른 날', () => {
    expect(pacificDay(Date.parse('2026-10-20T06:59:59Z'))).toBe('2026-10-19')
    expect(pacificDay(Date.parse('2026-10-20T07:00:00Z'))).toBe('2026-10-20')
    expect(pacificDay(Date.parse('2026-11-02T07:59:59Z'))).toBe('2026-11-01')
    expect(pacificDay(Date.parse('2026-11-02T08:00:00Z'))).toBe('2026-11-02')
    // 3월 서머타임 시작 (2026-03-08)
    expect(pacificDay(Date.parse('2026-03-08T07:59:59Z'))).toBe('2026-03-07')
    expect(pacificDay(Date.parse('2026-03-09T06:59:59Z'))).toBe('2026-03-08')
    expect(pacificDay(Date.parse('2026-03-09T07:00:00Z'))).toBe('2026-03-09')
  })
  it('다음 초기화 시각 = 다음 태평양 자정', () => {
    expect(new Date(nextPacificMidnight(Date.parse('2026-10-20T06:59:59Z'))).toISOString()).toBe('2026-10-20T07:00:00.000Z')
    expect(new Date(nextPacificMidnight(Date.parse('2026-11-01T12:00:00Z'))).toISOString()).toBe('2026-11-02T08:00:00.000Z')
    expect(new Date(nextPacificMidnight(Date.parse('2026-03-08T12:00:00Z'))).toISOString()).toBe('2026-03-09T07:00:00.000Z')
  })
  it('Intl(America/Los_Angeles)과 한 해 내내 같다', () => {
    const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 37 * 60 * 1000) expect(pacificDay(t)).toBe(format.format(new Date(t)))
  })
  it('KST 봉인 시각: 2026-10-18 + 30일 0시 = 2026-11-17T00:00:00+09:00', () => {
    expect(new Date(kstMidnightAfter('2026-10-18', 30)).toISOString()).toBe('2026-11-16T15:00:00.000Z')
  })
})

describe('스트림 본문 나누기', () => {
  it('배열을 조금씩 보내도, 이어 붙여도, 문자열 안의 괄호도 객체 단위로 나눈다', () => {
    const splitter = new JsonObjectSplitter()
    const text = '[{"a":"}{[","b":{"c":1}},\n{"d":"\\"}"}]'
    const out: unknown[] = []
    for (const char of text) out.push(...splitter.push(char))
    expect(out).toEqual([{ a: '}{[', b: { c: 1 } }, { d: '"}' }])
    expect(splitter.partial).toBe(false)
    const second = new JsonObjectSplitter()
    expect(second.push('{"x":1}{"y":')).toEqual([{ x: 1 }])
    expect(second.partial).toBe(true)
  })
})

describe('주입한 시계', () => {
  it('advance로 그 사이 sleep을 시각 순으로 푼다', async () => {
    const timer = new ManualTimer(0)
    const order: number[] = []
    void timer.sleep(3000).then(() => order.push(3))
    void timer.sleep(1000).then(() => order.push(1))
    const controller = new AbortController()
    void timer.sleep(2000, controller.signal).then(() => order.push(2))
    controller.abort()
    await timer.advance(5000)
    expect(order).toEqual([2, 1, 3])
    expect(timer.now()).toBe(5000)
  })
})
