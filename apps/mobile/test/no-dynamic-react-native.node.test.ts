// 앱 소스는 react-native를 `import('react-native')`로 부르지 않는다 (D-UX4-127).
// 동적 import는 react-native의 모든 모듈을 한꺼번에 깨워(importAll) 아이폰에서 옛 알림 모듈(PushNotificationIOS)이
// "`new NativeEventEmitter()` requires a non-null argument" 오류를 던지고, 정식 앱은 그 오류로 꺼진다
// (사용자 신고 2026-11-11 "고객에게 문자 보내기 하면 … 앱이 꺼져?" — 아이폰 충돌 기록과 시뮬레이터에서 찾음).
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

const DYNAMIC_RN = /import\(\s*['"]react-native['"]\s*\)/

describe('react-native 동적 import 금지 (D-UX4-127)', () => {
  it('src·app 어디에도 import(\'react-native\')가 없다', () => {
    const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))]
    expect(files.length).toBeGreaterThan(10)
    const found = files.filter((file) => DYNAMIC_RN.test(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, ''))).map((file) => relative(ROOT, file))
    expect(found).toEqual([])
  })

  it('검사가 잡는다', () => {
    expect(DYNAMIC_RN.test("const { Platform } = await import('react-native')")).toBe(true)
    expect(DYNAMIC_RN.test("import { Platform } from 'react-native'")).toBe(false)
  })
})
