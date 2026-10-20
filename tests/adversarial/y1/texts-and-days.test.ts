// Y1 적대 테스트 (test-domain): 글 다루기·태평양 날짜 (AC-Y1-11·22·41·51). 통과한 공격을 회귀로 남긴다.
import { batchMessages, charCount, nextPacificMidnight, pacificDay, parseVideoId, sanitizeNick } from '@livejjim/server'
import { describe, expect, it } from 'vitest'

describe('이름 정리 (AC-Y1-22) — 실제 시청자 닉네임', () => {
  it('TD-Y1-009(회귀): 한글 채움·방향 바꾸기·폭 없는 글자·전각 @·전각 점·줄바꿈이 섞여도 한 줄, 멘션·주소 없음, 30자 + …', () => {
    const cases: [string, string][] = [
      ['ㅤ홍길동ㅤ', '홍길동'],
      ['‮ofni.www', 'ofni·www'],
      ['＠pink．mom', 'pink·mom'],
      ['김\r\n철수 님', '김 철수 님'],
      ['​‍﻿', '시청자'],
      ['가'.repeat(31), `${'가'.repeat(30)}…`],
      ['👩‍👩‍👧 엄마', '👩👩👧 엄마'],
    ]
    for (const [input, expected] of cases) expect(sanitizeNick(input), JSON.stringify(input)).toBe(expected)
  })
})

describe('묶음 분할 (AC-Y1-41)', () => {
  it('TD-Y1-010(회귀): 항목 12개·중간에 250자 품종 하나 → 모든 메시지 200자 이하, 모든 효과가 정확히 한 번·순서 유지, 긴 항목만 199자 + …', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, text: `${String(i + 1)}번 핑크프릴구피 1${String(i)},000원 시청자${String(i)}님 구매 감사합니다` }))
    items.splice(5, 0, { id: 99, text: `6번 ${'긴'.repeat(250)} 1,000원 홍길동님 구매 감사합니다` })
    const messages = batchMessages(items)
    for (const message of messages) {
      expect(charCount(message.text)).toBeLessThanOrEqual(200)
      expect(message.text.endsWith(' 구매 감사합니다') || message.text.endsWith('…')).toBe(true)
    }
    expect(messages.flatMap((message) => message.ids)).toEqual(items.map((item) => item.id))
    const long = messages.find((message) => message.ids.includes(99))
    expect(long?.ids).toEqual([99])
    expect(charCount(long?.text ?? '')).toBe(200)
    expect(long?.text.endsWith('…')).toBe(true)
  })
})

describe('주소 읽기 (AC-Y1-11)', () => {
  it('TD-Y1-011(회귀): 판매자가 붙여 넣을 법한 주소 — 받을 것·받지 않을 것', () => {
    const id = 'AbC_dEf-123'
    for (const ok of [`  https://youtu.be/${id}?si=xYz  `, `youtube.com/watch?feature=share&v=${id}&t=10s`, `HTTPS://M.YOUTUBE.COM/watch?v=${id}`, `https://www.youtube.com/live/${id}?feature=share`, `https://studio.youtube.com/video/${id}/livestreaming`]) {
      expect(parseVideoId(ok), ok).toBe(id)
    }
    for (const bad of [`https://youtube.com.evil.example/watch?v=${id}`, `https://www.youtube.com/@pinkguppy`, `https://www.youtube.com/playlist?list=PL${id}`, `https://youtu.be/${id}x`, `javascript:alert(1)//youtu.be/${id}`, '']) {
      expect(parseVideoId(bad), bad).toBeNull()
    }
  })
})

describe('태평양 날짜 (AC-Y1-51) — 실행 환경 시간대와 상관없다', () => {
  it('TD-Y1-012(회귀): 서머타임 시작·끝 경계와 다음 초기화 시각', () => {
    expect(pacificDay(Date.parse('2026-10-20T06:59:59Z'))).toBe('2026-10-19')
    expect(pacificDay(Date.parse('2026-10-20T07:00:00Z'))).toBe('2026-10-20')
    expect(pacificDay(Date.parse('2026-11-02T07:59:59Z'))).toBe('2026-11-01')
    expect(pacificDay(Date.parse('2026-11-02T08:00:00Z'))).toBe('2026-11-02')
    // 서머타임이 끝나는 날(11/1, 25시간) — 다음 자정은 PST 기준
    expect(new Date(nextPacificMidnight(Date.parse('2026-11-01T08:30:00Z'))).toISOString()).toBe('2026-11-02T08:00:00.000Z')
    // 서머타임이 시작하는 날(3/8, 23시간) — 그날 자정은 PST, 다음 자정은 PDT
    expect(pacificDay(Date.parse('2026-03-08T07:59:59Z'))).toBe('2026-03-07')
    expect(new Date(nextPacificMidnight(Date.parse('2026-03-08T12:00:00Z'))).toISOString()).toBe('2026-03-09T07:00:00.000Z')
  })
})
