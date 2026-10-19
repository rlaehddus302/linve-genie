// AC-S04-32 금지 린트: apps/**/src(시험 제외)는 @livejjim/core/golden을 import하지 않고 TEST_PHONE_SECRET을 쓰지 않는다.
// 루트 eslint.config.mjs 규칙이 실제로 잡는지 확인한다(별칭 import·다시 내보내기·동적 import·require·코어 test 폴더 직접 경로 포함).
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, overrideConfigFile: join(ROOT, 'eslint.config.mjs') })
})

async function problems(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) })
  return (result?.messages ?? []).filter((message) => message.severity === 2).map((message) => `${message.ruleId ?? ''}: ${message.message}`)
}

const FORBIDDEN: Record<string, string> = {
  '정적 import': "import { smsPhoneFields } from '@livejjim/core/golden'\nexport const f = smsPhoneFields",
  '별칭 import': "import { TEST_PHONE_SECRET as key } from '@livejjim/core/golden'\nexport const k = key",
  '이름 공간 import': "import * as golden from '@livejjim/core/golden'\nexport const g = golden",
  '타입 import': "import type { GoldenApi } from '@livejjim/core/golden'\nexport type G = GoldenApi",
  '다시 내보내기': "export { smsPhoneFields } from '@livejjim/core/golden'",
  '전부 다시 내보내기': "export * from '@livejjim/core/golden'",
  '하위 경로': "import x from '@livejjim/core/golden/cli'\nexport const y = x",
  '동적 import': "export const load = () => import('@livejjim/core/golden')",
  '동적 import(템플릿)': 'export const load = () => import(`@livejjim/core/golden`)',
  require: "declare const require: (id: string) => unknown\nexport const g = require('@livejjim/core/golden')",
  '코어 test 폴더 상대 경로': "import { smsPhoneFields } from '../../../packages/core/test/golden/api.ts'\nexport const f = smsPhoneFields",
  '코어 test 폴더 동적 import': "export const load = () => import('../../../packages/core/test/golden/api.ts')",
  '키 이름 (환경변수)': "export const key = process.env['TEST_PHONE_SECRET']",
  '키 이름 (식별자)': 'const TEST_PHONE_SECRET = "x"\nexport const key = TEST_PHONE_SECRET',
  '키 이름 (템플릿)': 'export const key = `${"TEST_"}TEST_PHONE_SECRET`',
}

describe('AC-S04-32 테스트 전용 코드 금지 린트', () => {
  for (const [label, code] of Object.entries(FORBIDDEN)) {
    it(`apps/server/src·apps/web/src에서 ${label}을 막는다`, async () => {
      for (const file of ['apps/server/src/probe.ts', 'apps/server/src/deep/nested/probe.ts', 'apps/web/src/probe.tsx']) {
        const found = await problems(code, file)
        expect(found.length, `${file}: ${label}`).toBeGreaterThan(0)
        expect(found.join('\n')).toMatch(/테스트 전용 코드|@livejjim\/core\/golden|packages\/core\/test/)
      }
    })
  }

  it('시험 파일(apps/*/test)에서는 쓸 수 있다', async () => {
    for (const code of Object.values(FORBIDDEN).slice(0, 3)) expect(await problems(code, 'apps/server/test/probe.ts')).toEqual([])
  })

  it('보통 코어 import는 막지 않는다', async () => {
    expect(await problems("import { applyEvent } from '@livejjim/core'\nexport const a = applyEvent", 'apps/server/src/probe.ts')).toEqual([])
  })

  it('웹 소스는 XSS 금지 규칙도 그대로 받는다 (규칙을 합쳤다)', async () => {
    const found = await problems('export const A = (p: { h: string }) => <div dangerouslySetInnerHTML={{ __html: p.h }} />', 'apps/web/src/probe.tsx')
    expect(found.join('\n')).toMatch(/dangerouslySetInnerHTML/)
  })

  it('지금 서버 소스에는 골든 import·키 이름이 없다', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(full)
      }
    }
    walk(join(ROOT, 'apps/server/src'))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, relative(ROOT, file)).not.toMatch(/@livejjim\/core\/golden|TEST_PHONE_SECRET|core\/test\/golden/)
    }
  })
})
