// D-UX4-72 (사용자 지시 2026-11-10 "클릭할 수 있는 모든 버튼들을 꾹 눌렀을 때 꾹 눌리는 경험을 통일 … 앞으로도. 뒤로가기 버튼은 빼고"):
// 누를 수 있는 것은 모두 kit의 Tap(또는 press.tsx 안 PressScale·SoftChip)으로 만든다. react-native의 Pressable·Touchable*을 직접 쓰는 곳은
// 바로 윗줄에 "누름 예외: 까닭" 주석이 있어야 한다(뒤로 가기·시트 바깥·글 칸·숨은 누름). 새 화면이 그냥 Pressable을 쓰면 이 시험이 막는다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
/** 앱 화면 코드가 있는 곳 (expo-router 경로 app/ 포함) */
const DIRS = [SRC, join(ROOT, 'app')]
/** 눌림 틀을 만드는 곳 — 여기만 Pressable을 직접 쓴다 */
const PRESS_HOME = 'src/ui/kit/press.tsx'
const RAW_PRESS = /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)\b/
const EXCEPTION = /누름 예외:\s*\S/
/** JSX가 아닌 꼴로 Pressable을 쓰는 것 (createAnimatedComponent(Pressable)·createElement(Pressable)·다른 이름으로 담기) */
const RAW_NAME = /\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)\b/

function sources(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}
const allSources = () => DIRS.flatMap(sources)

/** 파일마다 예외 주석 없이 직접 쓴 누름 자리: "파일:줄 <Pressable" */
function rawPressSites(): string[] {
  const found: string[] = []
  for (const path of allSources()) {
    const file = relative(ROOT, path).split('\\').join('/')
    if (file === PRESS_HOME) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const code = line.trim()
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('{/*')) return
      const hit = RAW_PRESS.exec(line)
      if (hit === null) {
        // 가져오기 줄·닫는 꼬리표 말고 이름을 그대로 쓰면 예외 주석으로도 넘어가지 않는다
        const named = RAW_NAME.exec(line.replace(/<\/[A-Za-z]+>/g, ''))
        if (named !== null && !/^import\b/.test(code)) found.push(`${file}:${String(index + 1)} ${named[1] ?? ''}`)
        return
      }
      // 바로 윗줄(빈 줄은 건너뜀)에 "// 누름 예외: …" 또는 "{/* 누름 예외: … */}"
      let above = index - 1
      while (above >= 0 && lines[above]?.trim() === '') above -= 1
      if (above >= 0 && EXCEPTION.test(lines[above] ?? '')) return
      found.push(`${file}:${String(index + 1)} <${hit[1] ?? ''}`)
    })
  }
  return found
}

describe('누르면 꾸욱 — 뒤로 가기 말고는 모두 같은 손맛 (D-UX4-72)', () => {
  it('src 안 .tsx는 Pressable·Touchable*을 직접 쓰지 않는다 (press.tsx와 "누름 예외:" 주석 자리만)', () => {
    const sites = rawPressSites()
    expect(sites, `Tap(ui/kit)으로 바꾸거나, 뒤로 가기·시트 바깥·글 칸처럼 줄어들면 안 되는 자리면 바로 윗줄에 "// 누름 예외: 까닭"을 단다:\n${sites.join('\n')}`).toEqual([])
  })

  it('예외 주석은 까닭과 함께, 그리고 정말 직접 누름 자리 위에만', () => {
    const stray: string[] = []
    for (const path of allSources()) {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!line.includes('누름 예외')) return
        let below = index + 1
        while (below < lines.length && lines[below]?.trim() === '') below += 1
        if (!EXCEPTION.test(line) || !RAW_PRESS.test(lines[below] ?? '')) stray.push(`${relative(ROOT, path)}:${String(index + 1)}`)
      })
    }
    expect(stray, `떠도는 "누름 예외" 주석:\n${stray.join('\n')}`).toEqual([])
  })

  it('뒤로 가기 단추는 예외로 남아 있다 (줄어들지 않는다)', () => {
    const app = readFileSync(join(SRC, 'ui/kit/app.tsx'), 'utf8')
    expect(app).toMatch(/누름 예외: 뒤로 가기[^\n]*\n\s*<Pressable role="button" aria-label=\{label\}/)
  })
})
