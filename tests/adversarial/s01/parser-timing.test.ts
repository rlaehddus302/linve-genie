// S01 적대 테스트 (test-domain): 적대 입력에도 파서 시간이 폭주하지 않는다 (AC-S01-03, NFR-01·NFR-04).
// AC가 정한 최소 입력에 더해, 손으로 짠 스캐너·가격 찾기(끝에서 6토큰)·한글 단위 해석을 노린 입력을 넣는다.
// 회귀 테스트: 지금 구현은 통과한다(가장 느린 입력이 수 ms). 1초 기준은 AC 그대로다.
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { parseAmount, parseChat, parseKoreanNumber, parseQuickInput } from '@livejjim/core'

const LENGTH = 10_000
const LIMIT_MS = 1000

/** unit을 반복해 길이 LENGTH 안팎으로 만든다 */
const repeat = (unit: string, length = LENGTH): string => unit.repeat(Math.ceil(length / unit.length))

const ADVERSARIAL: Readonly<Record<string, string>> = {
  // AC-S01-03이 정한 최소 목록
  '"1 " 반복': repeat('1 '),
  '"1," 반복': repeat('1,'),
  '"15"+"!" 반복': `15${'!'.repeat(LENGTH)}`,
  '"❤️" 반복': repeat('❤️'),
  '"찜 " 반복 뒤 "15"': `${repeat('찜 ')}15`,
  '"1번 " 반복 뒤 "?"': `${repeat('1번 ')}?`,
  '"만" 반복': repeat('만'),
  '"십" 반복': repeat('십'),
  '"15 "+"핑크 " 반복 뒤 "10"': `15 ${repeat('핑크 ')}10`,
  // 스캐너·금액 덩어리 판정
  '숫자만 1만 자': repeat('1'),
  '",000" 묶음 반복': `1${repeat(',000')}`,
  '",00" 틀린 묶음 반복': `1${repeat(',00')}`,
  '"1." 반복': repeat('1.'),
  '"1." 뒤 0 반복': `1.${repeat('0')}`,
  '"1/" 반복': repeat('1/'),
  '"15"+", " 반복+"28"': `15${repeat(', ')}28`,
  '"1 번 " 반복': repeat('1 번 '),
  '"15 "+"~ " 반복': `15 ${repeat('~ ')}`,
  '"15"+VS16 반복': `15${repeat(String.fromCodePoint(0xfe0f))}`,
  '"1"+ZWJ 반복': `1${repeat(String.fromCodePoint(0x200d))}`,
  '"15 취소"+"ㅠ" 반복': `15 취소${repeat('ㅠ')}`,
  '"15 취소" 반복': repeat('15 취소 '),
  '짝 없는 서로게이트 반복': repeat(String.fromCharCode(0xd83d)),
  '전각 숫자 반복': repeat('１'),
  '전각 공백 반복 뒤 15': `${repeat(String.fromCodePoint(0x3000))}15`,
  // 금액·한글 수사
  '"구천구백구십구" 반복': repeat('구천구백구십구'),
  '"천백십" 반복': repeat('천백십'),
  '"1만 2,500원 " 반복': repeat('1만 2,500원 '),
  '"원" 반복': repeat('원'),
  '"9" 1만 자 뒤 "원"': `${repeat('9')}원`,
  '"0." 뒤 9 반복 + 만': `0.${repeat('9')}만`,
  // 빠른 입력: 가격 찾기는 끝에서 6토큰, 품종은 나머지 전부
  '빠른 입력: 번호 뒤 "만 " 반복': `15 ${repeat('만 ')}`,
  '빠른 입력: 번호 뒤 "1 " 반복': `15 ${repeat('1 ')}`,
  '빠른 입력: 마지막 토큰이 1만 자': `15 핑크 ${repeat('1만')}`,
  '빠른 입력: 마지막 토큰이 숫자 1만 자': `15 핑크 ${repeat('9')}`,
  '빠른 입력: 슬래시 반복': `15/${repeat('/')}`,
  '빠른 입력: 슬래시 형식 + "핑크/" 반복': `15/${repeat('핑크/')}10`,
  '빠른 입력: 번호 뒤 "만 천 백 십 오 원 " 반복': `15 ${repeat('만 천 백 십 오 원 ')}`,
}

describe('AC-S01-03 회귀: 적대 입력 하나당 1초 안 (네 함수, 채팅은 STRICT·LOOSE)', () => {
  for (const [label, text] of Object.entries(ADVERSARIAL)) {
    it(label, () => {
      const timings: Record<string, number> = {}
      const time = (name: string, run: () => unknown): void => {
        const start = performance.now()
        run()
        timings[name] = performance.now() - start
      }
      time('chat STRICT', () => parseChat(text))
      time('chat LOOSE', () => parseChat(text, { 'claim.parseMode': 'LOOSE' }))
      time('amount THOUSAND', () => parseAmount(text))
      time('amount WON', () => parseAmount(text, { 'price.unit': 'WON' }))
      time('korean-number', () => parseKoreanNumber(text))
      time('quick-input', () => parseQuickInput(text))
      for (const [name, ms] of Object.entries(timings)) expect(ms, `${label} / ${name}`).toBeLessThan(LIMIT_MS)
    })
  }
})

describe('AC-S01-03 회귀: 200자 이하 보통 채팅 1만 건을 모드마다 1초 안에', () => {
  const samples = [
    '15번 찜할게요!!',
    '이거 얼마예요?',
    '15번 2개 가능해요? 너무 예뻐요',
    '12,500원이요?',
    '15 취소요 ㅠㅠ',
    '안녕하세요 오늘도 좋은 방송 감사합니다 ',
    '1.5만 맞나요?',
    '15번 18번 중에 뭐가 나아요?',
    '찜 15 28 31',
    '❤️❤️❤️ 언니 오늘 너무 예뻐요 ㅋㅋㅋ',
  ]
  const chats = Array.from({ length: 10_000 }, (_, i) => {
    const base = samples[i % samples.length] as string
    return `${base} ${String((i % 999) + 1)} ${'ㅋ'.repeat(i % 60)}`.slice(0, 200)
  })

  for (const mode of ['STRICT', 'LOOSE'] as const) {
    it(mode, () => {
      const start = performance.now()
      for (const chat of chats) parseChat(chat, { 'claim.parseMode': mode })
      expect(performance.now() - start).toBeLessThan(LIMIT_MS)
    })
  }
})
