// @vitest-environment node
// 화면 코드 검사 (AC-S06b-30·33, D-099·D-100): 규칙의 원천은 엔진 하나다.
// - 합치기 미리 보기: 화면에 R-11의 "앞선 쪽" 순서(확정 > 충돌 > 대기 > 보류)·막는 조건을 구현한 함수가 없다 — 서버가 코어 previewMerge로 계산한 값을 낱말로만 바꾼다.
// - 문자찜 결과: 뒤 4자리로 구매자를 짐작하는 함수(smsHolder 같은 것)가 없다 — 쓰기 응답의 buyer를 쓴다.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../src/', import.meta.url)

function sources(dir: URL = SRC): { readonly file: string; readonly text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir)
    if (entry.isDirectory()) out.push(...sources(url))
    else if (/\.tsx?$/.test(entry.name)) out.push({ file: url.pathname.slice(SRC.pathname.length), text: readFileSync(url, 'utf8') })
  }
  return out
}

const files = sources()

describe('화면 코드 검사', () => {
  it('화면 소스를 읽었다 (빈 목록으로 통과하지 않게)', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((item) => item.file === 'lib/buyers.ts')).toBe(true)
  })

  it('AC-S06b-33: R-11의 남는 찜 순서·막는 조건을 구현한 함수가 없다 (합치기 미리 보기는 서버 계산)', () => {
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/STATUS_ORDER|function ahead\b|function planMerge|targetActive|bothWinners/)
      // 상태끼리 견주어 남는 쪽을 고르는 표 (1등 0 · 충돌 1 · 대기 2 · 보류 3)
      expect(text, file).not.toMatch(/CONFIRMED:\s*0,\s*CONFLICT:\s*1/)
    }
  })

  it('AC-S06b-30: 뒤 4자리로 구매자를 짐작하는 함수가 없다 (문자찜 결과는 쓰기 응답의 buyer)', () => {
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/smsHolder|SmsHolder/)
      expect(text, file).not.toMatch(/phoneLast4\s*!==\s*phoneLast4|phoneLast4\s*===\s*phoneLast4/)
    }
  })

  it('AC-S06b-20: 화면 어디에도 "번째 문자" 표기가 없다', () => {
    for (const { file, text } of files) expect(text, file).not.toContain('번째 문자')
  })
})

describe('아이폰(사파리) 음성 코드 검사 (I5)', () => {
  it('AC-I5-13 (D-I5-07): 클라우드 음성 화면·키 칸이 없고 클라우드 어댑터를 부르지 않는다', () => {
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/Deepgram|리턴제로|클라우드 음성|유료 음성/)
      expect(text, file).not.toMatch(/CloudSpeechEngine|createCloudSpeech|CloudSpeech/)
    }
  })

  it('D-036·D-I5-05: 음성 화면 코드는 기기 이름(UA)을 읽지 않는다 — 기능 값(navigator.standalone)만', () => {
    const voiceFiles = files.filter((item) => item.file.startsWith('voice/') || item.file === 'components/VoicePanel.tsx')
    // SRV1: 사파리 홈 화면 앱 판단(voice/standalone.ts)은 크롬·사파리 받아쓰기 길과 함께 없앴다 — 빈 목록으로 통과하지 않게 마이크 연결 파일로 본다
    expect(voiceFiles.map((item) => item.file)).toContain('voice/transport.ts')
    for (const { file, text } of voiceFiles) expect(text, file).not.toMatch(/userAgent|userAgentData|isIosSafari/)
  })
})
