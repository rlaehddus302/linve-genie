// 앱은 요금을 모른다 (PAY2 AC-PAY2-01, BILLING_RULES BL-11 1·AC1, BL-INV-9, D-PAY-01):
// (1) 앱 소스(src·app, 시험 파일 제외)의 문자열·JSX 글(주석 제외)에 요금 화면 주소·구매 권유 낱말이 없다.
// (2) 의존성 이름에 결제 SDK·앱 안 결제 모듈이 없다. (3) app.json에 결제 권한·앱 안 구입 기능이 없다.
// (4) 앱 export 번들(ios·android)에 요금 화면 주소 글자와 포트원·토스 SDK 모듈이 없다 — 이 시험이 직접 export한다.
// 금지 글자를 한 줄 넣으면 검사가 실패하는 것도 보인다.
// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { FORBIDDEN_BUNDLE, FORBIDDEN_NATIVE, forbiddenDependencies, scanSource } from './billing-free-scan.ts'

const ROOT = join(import.meta.dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const sources = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))]

describe('앱 소스에 요금 낱말이 없다 (AC-PAY2-01 (1))', () => {
  it('문자열·JSX 글에 요금 화면 주소·"요금"·"결제"·"구매하기"·"이용권을 사"·"부가세"·"구독"·"업그레이드"가 없다', () => {
    expect(sources.length).toBeGreaterThan(10)
    const problems = sources.flatMap((file) => scanSource(file, readFileSync(file, 'utf8')).map((found) => `${relative(ROOT, file)}:${String(found.line)} "${found.word}" — ${found.text}`))
    expect(problems).toEqual([])
  })

  it('금지 글자를 한 줄 넣으면 검사가 잡는다 (문자열·템플릿·JSX 글·속성) — 주석·import 경로는 보지 않는다', () => {
    const clean = "// 요금 이야기는 주석이라 괜찮다\n/* 결제 */\nexport const a = '방송 목록'\n"
    expect(scanSource('a.ts', clean)).toEqual([])
    expect(scanSource('b.ts', `${clean}export const b = '요금 화면 열기'\n`).map((f) => f.word)).toEqual(['요금'])
    expect(scanSource('c.ts', `${clean}export const c = \`\${'x'}/pricing\`\n`).map((f) => f.word)).toEqual(['/pricing'])
    expect(scanSource('d.tsx', `${clean}export const D = () => <p title="부가세 포함">이용권을 사 주세요</p>\n`).map((f) => f.word).sort()).toEqual(['부가세', '이용권을 사'].sort())
    expect(scanSource('e.ts', `${clean}export const e = fetch('/api/billing')\n`).map((f) => f.word).sort()).toEqual(['/api/billing', '/billing'].sort())
    expect(scanSource('f.tsx', `${clean}export const F = () => <b>구독 업그레이드 구매하기</b>\n`).map((f) => f.word).sort()).toEqual(['구독', '구매하기', '업그레이드'].sort())
  })
})

describe('앱 의존성·설정에 결제 모듈·권한이 없다 (AC-PAY2-01 (2)(3))', () => {
  it('package.json 의존성 이름에 portone·toss·iap·purchase·billing·revenuecat이 없다', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    expect(forbiddenDependencies(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))).toEqual([])
    // 검사가 잡는지: 금지 이름 하나씩
    expect(forbiddenDependencies(['@portone/browser-sdk', '@tosspayments/sdk', 'react-native-iap', 'expo-in-app-purchases', 'react-native-purchases', 'billing-kit', 'expo'])).toHaveLength(6)
  })

  it('app.json(과 만들어진 네이티브 설정)에 com.android.vending.BILLING·앱 안 구입 기능이 없다', () => {
    const configs = [join(ROOT, 'app.json')]
    for (const native of ['android/app/src/main/AndroidManifest.xml', 'ios']) {
      const full = join(ROOT, native)
      if (!existsSync(full)) continue
      if (statSync(full).isDirectory()) {
        for (const entry of readdirSync(full, { recursive: true }) as string[]) if (/\.(plist|entitlements|pbxproj)$/.test(entry)) configs.push(join(full, entry))
      } else configs.push(full)
    }
    for (const file of configs) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN_NATIVE) expect(pattern.test(text), `${relative(ROOT, file)}: ${String(pattern)}`).toBe(false)
    }
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { android: { permissions: string[] }; plugins: unknown[] } }
    expect(app.expo.android.permissions.some((name) => /BILLING/i.test(name))).toBe(false)
    expect(forbiddenDependencies(app.expo.plugins.map((plugin) => (Array.isArray(plugin) ? String(plugin[0]) : String(plugin))))).toEqual([])
  })
})

describe('앱 export 번들에 요금 화면 주소·결제 SDK가 없다 (AC-PAY2-01 (4))', () => {
  const out = mkdtempSync(join(tmpdir(), 'livejjim-app-export-'))
  afterAll(() => rmSync(out, { recursive: true, force: true }))

  it(
    'expo export(ios·android) 번들 글자에 /billing·/pricing·/api/billing·포트원·토스 모듈이 없다',
    () => {
      const expo = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'expo.cmd' : 'expo')
      const result = spawnSync(expo, ['export', '--platform', 'ios', '--platform', 'android', '--output-dir', out], {
        cwd: ROOT,
        env: { ...process.env, CI: '1', NODE_ENV: 'production' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      const dir = join(out, '_expo', 'static', 'js')
      const platforms = readdirSync(dir)
      expect(platforms.sort()).toEqual(['android', 'ios'])
      for (const platform of platforms) {
        const bundles = readdirSync(join(dir, platform))
        expect(bundles.length).toBeGreaterThan(0)
        for (const name of bundles) {
          const text = readFileSync(join(dir, platform, name), 'latin1')
          // 번들이 비지 않았다: 앱이 부르는 서버 경로 글자가 들어 있다
          expect(text.includes('/api/broadcasts'), `${platform}/${name}: 앱 글자`).toBe(true)
          for (const pattern of FORBIDDEN_BUNDLE) expect(pattern.test(text), `${platform}/${name}: ${String(pattern)}`).toBe(false)
        }
      }
    },
    600_000,
  )
})
