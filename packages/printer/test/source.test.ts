// 프린터 패키지 소스 검사 (AC-P1-60) — apps/**를 import하지 않고, 대기열은 시계·난수를 쓰지 않으며, 그림 형식은 라벨 패키지 것 하나다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .sort()
  .map((file) => ({ file, text: code(readFileSync(join(SRC, file), 'utf8')) }))

describe('프린터 소스 검사', () => {
  it('apps/**와 Node 모듈을 import하지 않는다 (브라우저에서 돈다)', () => {
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/from\s+['"][^'"]*apps\//)
      expect(text, file).not.toMatch(/from\s+['"](node:|fs|path)['"/]/)
    }
  })

  it('대기열·실행기는 시계·난수를 읽지 않는다 (시각은 주입)', () => {
    for (const { file, text } of files.filter((f) => f.file === 'queue.ts' || f.file === 'runner.ts' || f.file === 'fake.ts')) {
      expect(text, file).not.toMatch(/\bDate\b|Math\.random|performance\.now|crypto\./)
    }
  })

  it('그림 형식은 @livejjim/label의 LabelBitmap을 쓴다 (따로 정의하지 않는다)', () => {
    for (const { file, text } of files) expect(text, file).not.toMatch(/interface\s+\w*Bitmap\b/)
    expect(files.some(({ text }) => /from '@livejjim\/label'/.test(text))).toBe(true)
  })
})
