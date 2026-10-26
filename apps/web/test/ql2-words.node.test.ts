// @vitest-environment node
// QL2 AC-QL2-40 (D-QL2-09 ①): 화면 문장 가운데 "'이 기기에서 출력'을 눌러"가 든 것은 모두 "프린터를 연결"도 들어 있다 — 없는 단추를 먼저 누르라고 하지 않는다.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe("'이 기기에서 출력' 안내 문장 (AC-QL2-40)", () => {
  /** 테스트 결과 "예" 뒤 문장 — 이미 프린터가 연결된 뒤에만 보여 프린터 연결을 다시 말하지 않는다 (AC-QL2-40의 이름 붙은 예외) */
  const AFTER_TEST_YES = '좋아요. 이 기기에서 출력하려면'

  it("화면 문장 가운데 '이 기기에서 출력'을 누르라는 것은 모두 \"프린터를 연결\"도 들어 있다 (예외: 테스트 결과 \"예\" 뒤 문장)", () => {
    const files: URL[] = []
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir))
        else if (/\.tsx?$/.test(entry.name)) files.push(new URL(entry.name, dir))
      }
    }
    walk(new URL('../src/', import.meta.url))
    const found: string[] = []
    const missing: string[] = []
    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const code = line.trim()
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('{/*')) continue
        if (!code.includes('눌러')) continue
        if (!code.includes('이 기기에서 출력') && !code.includes('PRINT_ACTION.thisDevice')) continue
        if (code.includes(AFTER_TEST_YES)) continue
        found.push(code)
        if (!code.includes('프린터를 연결')) missing.push(`${file.pathname}: ${code}`)
      }
    }
    // 콘솔 출력 기기 없음·포장 출력 기기 없음·해볼 일 ⑤ — 셋 이상을 실제로 보았다
    expect(found.length).toBeGreaterThanOrEqual(3)
    expect(missing).toEqual([])
  })
})
