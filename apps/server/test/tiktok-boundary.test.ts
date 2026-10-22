// 틱톡 모듈 경계 정적 시험 (N2b-1, AC-N2b-1-01·03, D-N2b-1-08).
// - apps/server/src/tiktok/**는 저장소·DB·쓰기 경로·실시간 알림·API 모듈을 import하지 않는다(레코드는 콜백으로만 나간다, 파일·DB에 쓰지 않는다).
// - 라이브러리 tiktok-live-connector를 import하는 서버 소스는 모듈 안 감싸개 파일(library.ts) 하나뿐이다.
// - 모듈 소스에 sendMessage라는 이름이 없다(글 올리기 없음).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as tiktok from '../src/tiktok/index.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const MODULE = join(SRC, 'tiktok')

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : /\.[cm]?[jt]sx?$/.test(name) ? [full] : []
    })
}

/** import·export from·동적 import·require의 모듈 이름들 */
function specifiers(source: string): string[] {
  const out: string[] = []
  const patterns = [/\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g, /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g]
  for (const re of patterns) for (const m of source.matchAll(re)) if (m[1] !== undefined) out.push(m[1])
  return out
}

const moduleFiles = walk(MODULE)

describe('AC-N2b-1-01 독립 모듈', () => {
  it('모듈 파일들이 있다', () => {
    expect(moduleFiles.map((f) => relative(MODULE, f))).toEqual(
      expect.arrayContaining(['index.ts', 'target.ts', 'comment.ts', 'connection.ts', 'library.ts', 'fake.ts', 'settings.ts', 'consent.ts', 'failure.ts', 'messages.ts']),
    )
  })

  it('모듈은 모듈 안 파일·로그(../log.ts)·라이브러리(감싸개 하나)만 import한다 — 저장소·DB·쓰기 경로·실시간 알림·API·파일 쓰기 없음', () => {
    const problems: string[] = []
    for (const file of moduleFiles) {
      const name = relative(MODULE, file)
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        const inModule = spec.startsWith('./') && !spec.includes('..')
        const allowed = inModule || spec === '../log.ts' || (spec === 'tiktok-live-connector' && name === 'library.ts')
        if (!allowed) problems.push(`${name}: ${spec}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('서버 소스에서 라이브러리를 import하는 파일은 src/tiktok/library.ts 하나뿐', () => {
    const importers = walk(SRC)
      .filter((file) => specifiers(readFileSync(file, 'utf8')).some((spec) => spec === 'tiktok-live-connector' || spec.startsWith('tiktok-live-connector/')))
      .map((file) => relative(SRC, file))
    expect(importers).toEqual([join('tiktok', 'library.ts')])
  })

  // N2b-2(AC-N2b-1-62 "index.ts 하나에서만 가져다 쓴다")가 서버에 잇는다 — 바뀐 기존 시험: "잇지 않는다" → "index.ts로만 잇는다"(dev-notes)
  it('모듈 밖 서버 소스는 틱톡 모듈을 tiktok/index.ts로만 잇는다 (모듈 안 파일을 바로 가져다 쓰지 않는다)', () => {
    const deep = walk(SRC)
      .filter((file) => !file.startsWith(MODULE))
      .flatMap((file) =>
        specifiers(readFileSync(file, 'utf8'))
          .filter((spec) => /(^|\/)tiktok\//.test(spec) && !/(^|\/)tiktok\/index\.ts$/.test(spec))
          .map((spec) => `${relative(SRC, file)}: ${spec}`),
      )
    expect(deep).toEqual([])
  })

  it('import 검사가 금지된 경로를 잡는다', () => {
    expect(specifiers("import { Service } from '../service.ts'\nexport { x } from '../db/schema.ts'\nconst m = await import('../store.ts')\nrequire('../hub.ts')")).toEqual([
      '../service.ts',
      '../db/schema.ts',
      '../store.ts',
      '../hub.ts',
    ])
  })
})

describe('AC-N2b-1-03 읽기만 — 글 올리기 없음', () => {
  it('모듈 소스에 sendMessage라는 이름이 없다', () => {
    for (const file of moduleFiles) expect(readFileSync(file, 'utf8'), relative(MODULE, file)).not.toMatch(/sendMessage/i)
  })

  it('모듈이 내보내는 것 중에 틱톡에 무엇을 보내는 함수가 없다', () => {
    const names = Object.keys(tiktok)
    for (const name of names) expect(name, name).not.toMatch(/^(send|post|reply|comment|like|gift|follow|share|publish|write)/i)
    expect(names).not.toContain('sendMessage')
  })

  it('연결을 만드는 함수의 입력에 쿠키·세션·로그인 칸이 없다 (형 — 이 줄이 형 검사를 통과하면 안 된다)', () => {
    const options: tiktok.TikTokConnectionOptions = {
      sellerId: 's',
      target: tiktok.checkTikTokTarget('seller_kim').ok ? (tiktok.checkTikTokTarget('seller_kim') as { target: tiktok.TikTokTarget }).target : (undefined as never),
      webcast: new tiktok.FakeWebcast().factory,
      onRecord: () => undefined,
      // @ts-expect-error 세션 칸은 없다 (AC-N2b-1-03)
      sessionId: 'planted',
    }
    expect(options.sellerId).toBe('s')
  })
})
