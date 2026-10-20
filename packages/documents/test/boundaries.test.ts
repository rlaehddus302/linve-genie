// AC-P2-40 패키지 구조·실행 환경 · AC-P2-21 다시 계산하는 코드 없음 — 코드 검사.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PACKAGES = new URL('../../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, PACKAGES), 'utf8')
/** 주석을 뺀 코드 (설명 주석에 적힌 API 이름은 검사하지 않는다) */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const sources = (pkg: string): [string, string][] =>
  readdirSync(new URL(`${pkg}/src/`, PACKAGES))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [`${pkg}/src/${name}`, read(`${pkg}/src/${name}`)])

describe('AC-P2-40 문서 패키지 src는 브라우저와 Node 둘 다에서 돈다', () => {
  const files = sources('documents')

  it('소스 파일이 있다', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  it.each(files)('%s: Node 전용 모듈·전역, 파일·네트워크, 시계·난수, 실행 환경 언어 API를 쓰지 않는다', (_name, source) => {
    const text = code(source)
    expect(text).not.toMatch(/from\s+['"](?:node:|fs['"]|path['"]|os['"]|zlib['"]|stream['"]|buffer['"]|child_process|http|https|url['"])/)
    expect(text).not.toMatch(/\brequire\s*\(|\bprocess\.|\bBuffer\b|__dirname|readFile|fetch\(|XMLHttpRequest/)
    expect(text).not.toMatch(/Date\.now|new Date\(\s*\)|Math\.random|performance\.now/)
    expect(text).not.toMatch(/\bIntl\b|localeCompare|toLocale/)
  })

  it.each(files)('%s: 캔버스·DOM에 기대지 않는다 (같은 함수가 브라우저와 Node에서 같은 그림을 만든다)', (_name, source) => {
    const text = code(source)
    expect(text).not.toMatch(/\bdocument\.|OffscreenCanvas|HTMLCanvasElement|getContext\(|\bwindow\./)
  })
})

describe('AC-P2-21 문서는 금액을 다시 계산하지 않는다 (코드 검사)', () => {
  const all = sources('documents')
    .map(([, text]) => code(text))
    .join('\n')
  /** 금액을 다루는 파일 (확인서·대장) */
  const amounts = code(read('documents/src/receipt.ts')) + code(read('documents/src/ledger.ts'))

  it('코어 정산 계산·배송비 규칙을 다시 쓰지 않는다', () => {
    expect(all).not.toMatch(/\bsettle\b\s*[,(}]/)
    expect(all).not.toMatch(/baseFee|freeThreshold|shipping\.\w+'/)
  })

  it('금액 뺄셈은 남은 금액 하나, 줄 가격 더하기는 맞춤 검사(linesMatchSettlement) 하나', () => {
    expect(all.match(/settlement\.total - settlement\.received/g)).toHaveLength(1)
    expect(all.match(/\+= line\.price/g)).toHaveLength(1)
    expect(amounts.match(/\.reduce\(/g)).toBeNull()
    expect(amounts.match(/\.price\s*\+|\+\s*\w+\.price|\.subtotal\s*[+-]|\.shipping\s*[+-]|\.adjustments\s*[+-]/g)).toBeNull()
  })
})

describe('AC-P2-40 패키지·의존성·글꼴', () => {
  it.each(['documents', 'voice'])('@livejjim/%s 의존성은 정확한 버전으로 고정한다', (pkg) => {
    const manifest = JSON.parse(read(`${pkg}/package.json`)) as { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    expect(manifest.name).toBe(`@livejjim/${pkg}`)
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(version, name).toMatch(/^(?:workspace:\*|\d+\.\d+\.\d+)$/)
    }
  })

  it('글꼴 파일은 OFL 라이선스 파일과 함께 둔다', () => {
    const fonts = readdirSync(new URL('documents/fonts/', PACKAGES))
    expect(fonts).toContain('OFL.txt')
    expect(fonts.some((name) => /\.(?:ttf|otf)$/.test(name))).toBe(true)
    const license = read('documents/fonts/OFL.txt')
    expect(license).toContain('SIL Open Font License')
    expect(license).toContain('Pretendard')
  })
})
