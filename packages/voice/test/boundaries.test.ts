// AC-P2-15 끄기(VOC-05) · AC-P2-14 키·주소 없음 · AC-P2-40 실행 환경 — 코드 검사.
// - apps/**·packages/core/src·packages/label·packages/documents는 @livejjim/voice에 기대지 않는다(P2는 화면·서버를 연결하지 않는다).
// - packages/voice/src는 Node 전용 모듈을 import하지 않고, 시계·난수를 직접 읽지 않으며, 공급자 주소·키가 없다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SOURCE = /\.(?:[cm]?[jt]sx?|json|html|vue|svelte)$/

function files(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (SOURCE.test(name)) out.push(full)
  }
  return out
}

const rel = (path: string): string => relative(ROOT, path)

describe('AC-P2-15 음성 패키지 없이 돈다 — 다른 곳은 @livejjim/voice에 기대지 않는다', () => {
  const scopes = ['apps', 'packages/core/src', 'packages/label', 'packages/documents']

  it.each(scopes)('%s 안에 @livejjim/voice·packages/voice 참조가 없다', (scope) => {
    const offenders = files(join(ROOT, scope)).filter((file) => /@livejjim\/voice|packages\/voice|\.\.\/voice\//.test(readFileSync(file, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('검사 범위가 비어 있지 않다 (경로가 틀려 아무것도 안 보는 시험 방지)', () => {
    expect(files(join(ROOT, 'apps')).length).toBeGreaterThan(10)
    expect(files(join(ROOT, 'packages/core/src')).length).toBeGreaterThan(5)
  })
})

describe('AC-P2-40·AC-P2-14 packages/voice/src', () => {
  const sources = files(join(ROOT, 'packages/voice/src'))

  it('소스 파일이 있다', () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  it.each(sources.map((file) => [rel(file), file]))('%s: Node 전용 모듈·시계·난수를 쓰지 않는다', (_name, file) => {
    const text = readFileSync(file, 'utf8')
    expect(text).not.toMatch(/from\s+['"](?:node:|fs['"]|path['"]|os['"]|child_process|crypto['"]|http|https|net['"])/)
    expect(text).not.toMatch(/\brequire\s*\(|\bprocess\.|\bBuffer\b/)
    expect(text).not.toMatch(/Date\.now|new Date\(\s*\)|Math\.random|performance\.now/)
  })

  it.each(sources.map((file) => [rel(file), file]))('%s: 공급자 주소·키·토큰 값이 없다', (_name, file) => {
    const text = readFileSync(file, 'utf8')
    expect(text).not.toMatch(/deepgram\.com|vito\.ai|rtzr\.ai|returnzero\.com|wss?:\/\/|https?:\/\//i)
    expect(text).not.toMatch(/api[_-]?key|apikey|secret|bearer|authorization|access[_-]?token/i)
    expect(text).not.toMatch(/token\s*[:=]\s*['"`]/i)
  })
})
