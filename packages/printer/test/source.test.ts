// 프린터 패키지 소스 검사 (AC-P1-60·AC-N1-20·50·61) — apps/**·Node 모듈(node:·zlib·fs)을 import하지 않고(브라우저와 Node가 같은 압축 코드),
// 대기열·작업 바이트·Marklife 어댑터·가짜 기기는 시계·난수를 쓰지 않으며, 그림 형식은 라벨 패키지 것 하나다. GPL 코드·제조사 SDK 흔적이 없다.
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
  it('apps/**와 Node 모듈(node:·zlib·fs·path)을 import하지 않는다 (브라우저에서 돈다 — 브라우저와 Node가 같은 압축 코드)', () => {
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining(['job.ts', 'deflate.ts', 'marklife.ts', 'fake-bluetooth.ts', 'profiles.ts', 'browser-support.ts', 'bluetooth.ts']))
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/from\s+['"][^'"]*apps\//)
      expect(text, file).not.toMatch(/from\s+['"](node:|fs|path|zlib|pako|fflate)['"/]/)
      expect(text, file).not.toMatch(/import\(\s*['"](node:|zlib|fs)/)
      expect(text, file).not.toMatch(/\brequire\(/)
    }
  })

  it('대기열·실행기·작업 바이트·압축·Marklife 어댑터·가짜 기기는 시계·난수를 읽지 않는다 (시각은 주입)', () => {
    const pure = ['queue.ts', 'runner.ts', 'fake.ts', 'job.ts', 'deflate.ts', 'marklife.ts', 'fake-bluetooth.ts', 'profiles.ts', 'browser-support.ts']
    for (const { file, text } of files.filter((f) => pure.includes(f.file))) {
      expect(text, file).not.toMatch(/\bDate\b|Math\.random|performance\.now|crypto\.|Intl\.|toLocale/)
    }
  })

  it('모델 이름으로 갈라지는 코드가 없다 — 작업 바이트·어댑터는 방식·돌림·농도 칸(데이터)만 본다 (AC-N1-03)', () => {
    for (const { file, text } of files.filter((f) => ['job.ts', 'marklife.ts', 'fake-bluetooth.ts'].includes(f.file))) {
      expect(text, file).not.toMatch(/MARKLIFE_(P50|S2|X2|P11|P12|P15|L13|LP90|LP15)\b|BAUATO_PPA2L|'(P50|S2|X2|P11|P12|P15|L13|LP90|LP15)_'/)
    }
  })

  it('GPL 참고 구현(LaBLEr·BleWebler)·제조사 SDK(marklife-label-printer-web-kit)를 쓰지 않는다 (AC-N1-61)', () => {
    const manifest = readFileSync(join(SRC, '..', 'package.json'), 'utf8')
    expect(manifest).not.toMatch(/labler|blewebler|marklife-label-printer-web-kit/i)
    for (const { file, text } of files) expect(text, file).not.toMatch(/labler|blewebler|marklife-label-printer-web-kit|GPL/i)
  })

  it('그림 형식은 @livejjim/label의 LabelBitmap을 쓴다 (따로 정의하지 않는다)', () => {
    for (const { file, text } of files) expect(text, file).not.toMatch(/interface\s+\w*Bitmap\b/)
    expect(files.some(({ text }) => /from '@livejjim\/label'/.test(text))).toBe(true)
  })
})
