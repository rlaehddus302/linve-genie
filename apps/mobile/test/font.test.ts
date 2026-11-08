// 앱 글꼴 Pretendard (D-UX3-69): 아이폰·안드로이드가 같은 글꼴로 그려 글자 크기·폭이 같게 보인다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { font, PRETENDARD } from '../src/ui/kit/font.ts'
import { WEIGHT } from '../src/ui/kit/tokens.ts'

const ROOT = join(import.meta.dirname, '..')
const appJson = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } }

function embeddedFonts(): string[] {
  const entry = appJson.expo.plugins.find((plugin): plugin is [string, { fonts: string[] }] => Array.isArray(plugin) && plugin[0] === 'expo-font')
  return entry?.[1].fonts ?? []
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('Pretendard 글꼴 파일', () => {
  it('앱이 쓰는 굵기마다 파일이 있고, 앱 빌드(expo-font)가 그 파일을 넣는다', () => {
    const embedded = embeddedFonts()
    for (const weight of [...Object.values(WEIGHT), '900'] as const) {
      const file = `./assets/fonts/${PRETENDARD[weight].file}.otf`
      expect(existsSync(join(ROOT, file)), file).toBe(true)
      expect(embedded).toContain(file)
    }
    // 글꼴 이용 허락(SIL OFL 1.1)을 함께 둔다
    expect(readFileSync(join(ROOT, 'assets/fonts/Pretendard-LICENSE.txt'), 'utf8')).toContain('SIL Open Font License')
  })
})

describe('font()', () => {
  it('기기에서는 굵기별 글꼴 이름만 주고 굵기를 또 주지 않는다 (안드로이드 겹친 굵게 막기)', () => {
    expect(font('700', 'android')).toEqual({ fontFamily: 'Pretendard-SemiBold' })
    expect(font('700', 'ios')).toEqual({ fontFamily: 'Pretendard-SemiBold' })
    expect(font(undefined, 'ios')).toEqual({ fontFamily: 'Pretendard-Regular' })
  })

  it('웹은 글꼴 파일이 없으니 실제로 그리는 굵기를 준다', () => {
    expect(font('700', 'web')).toEqual({ fontFamily: 'Pretendard-SemiBold', fontWeight: '600' })
  })

  it('중간·굵게·아주 굵게는 한 단계 가볍게 그리고, 서로 굵기 차이는 지킨다 (D-UX3-70)', () => {
    expect(PRETENDARD[WEIGHT.regular].weight).toBe('400')
    expect(PRETENDARD[WEIGHT.book].weight).toBe('500')
    expect(PRETENDARD[WEIGHT.medium].weight).toBe('500')
    expect(PRETENDARD[WEIGHT.bold].weight).toBe('600')
    expect(PRETENDARD[WEIGHT.heavy].weight).toBe('700')
    const drawn = [WEIGHT.regular, WEIGHT.medium, WEIGHT.bold, WEIGHT.heavy].map((weight) => Number(PRETENDARD[weight].weight))
    expect(drawn).toEqual([...drawn].sort((a, b) => a - b))
    expect(new Set(drawn).size).toBe(drawn.length)
  })
})

describe('앱의 모든 글이 Pretendard를 쓴다', () => {
  // 일부러 시스템 글꼴: 그림 글자(이모지) · 화면에 안 보이는 인증번호 입력 칸 · 코드용 고정폭 글꼴
  const ALLOWED = [/item\.icon|{ fontSize: 24, lineHeight: 30 }/, /color: 'transparent', fontSize: 1 }/, /fontFamily: Platform\.select\(\{ ios: 'Menlo'/]

  it('글자 스타일(fontSize·fontWeight)은 font()와 함께 쓴다', () => {
    const misses: string[] = []
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      if (file.endsWith('font.ts')) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (!/fontSize:|fontWeight:/.test(line) || line.includes('font(')) return
        if (ALLOWED.some((pattern) => pattern.test(line))) return
        misses.push(`${file.slice(ROOT.length + 1)}:${String(index + 1)}`)
      })
    }
    expect(misses).toEqual([])
  })
})
