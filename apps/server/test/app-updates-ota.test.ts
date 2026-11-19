// D-OTA-01 앱 화면 새 버전 나눠 주기 (사용자 지시 2026-11-12 "ui 수정하면 실제 휴대폰에 업데이트 되는데에 얼마나 걸려? 그리고 최대한 빨리하는 방법 없어?" → "네, 만들어").
// Expo Updates 프로토콜 1: 지문이 맞는 앱에만 지금 묶음을 주고, 이미 그것이거나 없으면 "새 것 없음", 폴더 밖 파일은 못 받는다.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { registerAppUpdates } from '../src/app-updates.ts'
import { isServerPath } from '../src/web.ts'

const ID = '0f1e2d3c-4b5a-6978-8a9b-acbdcedf0011'
const RUNTIME = 'abc123fingerprint'
const BUNDLE = 'console.log("새 화면")'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lg-ota-'))
  const update = join(dir, 'ios', RUNTIME, ID)
  mkdirSync(join(update, '_expo/static/js/ios'), { recursive: true })
  mkdirSync(join(update, 'assets'), { recursive: true })
  writeFileSync(join(update, '_expo/static/js/ios/entry-1.hbc'), BUNDLE)
  writeFileSync(join(update, 'assets/aa11'), PNG)
  writeFileSync(join(update, 'metadata.json'), JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { ios: { bundle: '_expo/static/js/ios/entry-1.hbc', assets: [{ path: 'assets/aa11', ext: 'png' }] } } }))
  writeFileSync(join(update, 'expoConfig.json'), JSON.stringify({ name: '라이브지니', extra: { smsIntake: 'off' } }))
  writeFileSync(join(update, 'created-at'), '2026-11-12T06:00:00Z\n')
  writeFileSync(join(dir, 'ios', RUNTIME, 'current'), `${ID}\n`)
  writeFileSync(join(dir, 'secret.txt'), '비밀')
  return dir
}

function app(dir: string | null) {
  return createApp({ appUpdates: (hono) => registerAppUpdates(hono, { dir, origin: 'https://livegenie.kr' }) })
}

function ask(target: ReturnType<typeof app>, headers: Record<string, string>) {
  return target.request('/app-updates/manifest', { headers: { 'expo-protocol-version': '1', ...headers } })
}

/** multipart 본문에서 이름이 name인 부분의 JSON */
async function part(response: Response, name: string): Promise<unknown> {
  const type = response.headers.get('content-type') ?? ''
  const boundary = /boundary=(\S+)/.exec(type)?.[1] ?? ''
  for (const chunk of (await response.text()).split(`--${boundary}`)) {
    if (chunk.includes(`name="${name}"`)) return JSON.parse(chunk.slice(chunk.indexOf('\r\n\r\n') + 4).trim())
  }
  return undefined
}

describe('GET /app-updates/manifest (D-OTA-01)', () => {
  it('지문이 맞으면 지금 묶음 목록을 준다 — 해시·주소·앱 설정이 들어 있다', async () => {
    const response = await ask(app(folder()), { 'expo-platform': 'ios', 'expo-runtime-version': RUNTIME })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^multipart\/mixed; boundary=/)
    expect(response.headers.get('expo-protocol-version')).toBe('1')
    expect(response.headers.get('expo-sfv-version')).toBe('0')
    const manifest = (await part(response, 'manifest')) as { id: string; runtimeVersion: string; createdAt: string; launchAsset: unknown; assets: unknown; extra: unknown }
    expect(manifest.id).toBe(ID)
    expect(manifest.runtimeVersion).toBe(RUNTIME)
    expect(manifest.createdAt).toBe('2026-11-12T06:00:00.000Z')
    expect(manifest.launchAsset).toEqual({
      hash: createHash('sha256').update(BUNDLE).digest('base64url'),
      key: createHash('md5').update(BUNDLE).digest('hex'),
      contentType: 'application/javascript',
      fileExtension: '.bundle',
      url: `https://livegenie.kr/app-updates/files/ios/${RUNTIME}/${ID}/_expo/static/js/ios/entry-1.hbc`,
    })
    expect(manifest.assets).toEqual([
      { hash: createHash('sha256').update(PNG).digest('base64url'), key: createHash('md5').update(PNG).digest('hex'), contentType: 'image/png', fileExtension: '.png', url: `https://livegenie.kr/app-updates/files/ios/${RUNTIME}/${ID}/assets/aa11` },
    ])
    expect(manifest.extra).toEqual({ expoClient: { name: '라이브지니', extra: { smsIntake: 'off' } } })
  })

  it('이미 그 묶음인 앱·지문이 다른 앱·다른 플랫폼·폴더 없음 → 새 것 없음 지시', async () => {
    const dir = folder()
    const same = await ask(app(dir), { 'expo-platform': 'ios', 'expo-runtime-version': RUNTIME, 'expo-current-update-id': ID })
    const otherRuntime = await ask(app(dir), { 'expo-platform': 'ios', 'expo-runtime-version': 'old-fingerprint' })
    const android = await ask(app(dir), { 'expo-platform': 'android', 'expo-runtime-version': RUNTIME })
    const none = await ask(app(null), { 'expo-platform': 'ios', 'expo-runtime-version': RUNTIME })
    for (const response of [same, otherRuntime, android, none]) {
      expect(response.status).toBe(200)
      expect(await part(response, 'directive')).toEqual({ type: 'noUpdateAvailable' })
    }
  })

  it('플랫폼·지문이 이상하면 400', async () => {
    const target = app(folder())
    expect((await ask(target, { 'expo-platform': 'web', 'expo-runtime-version': RUNTIME })).status).toBe(400)
    expect((await ask(target, { 'expo-platform': 'ios', 'expo-runtime-version': '../x' })).status).toBe(400)
    expect((await ask(target, { 'expo-platform': 'ios' })).status).toBe(400)
  })
})

describe('GET /app-updates/files/* (D-OTA-01)', () => {
  it('묶음 파일은 그대로, 오래 캐시', async () => {
    const response = await app(folder()).request(`/app-updates/files/ios/${RUNTIME}/${ID}/_expo/static/js/ios/entry-1.hbc`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('content-type')).toBe('application/javascript')
    expect(await response.text()).toBe(BUNDLE)
  })

  it('폴더 밖·없는 파일은 404', async () => {
    const target = app(folder())
    for (const path of [`/app-updates/files/ios/${RUNTIME}/${ID}/../../../secret.txt`, `/app-updates/files/ios/${RUNTIME}/${ID}/%2e%2e/%2e%2e/%2e%2e/secret.txt`, `/app-updates/files/ios/${RUNTIME}/not-an-id/metadata.json`, `/app-updates/files/ios/${RUNTIME}/${ID}/nope.js`]) {
      const response = await target.request(path)
      expect(response.status, path).toBe(404)
      expect(await response.text()).not.toContain('비밀')
    }
  })

  it('/app-updates는 화면 문서로 빠지지 않는 서버 경로', () => {
    expect(isServerPath('/app-updates/manifest')).toBe(true)
    expect(isServerPath('/app-updates/files/ios/x')).toBe(true)
  })
})

// D-APK-LINK-01 사용자 지시(2026-11-20) "안드로이드 apk 다운 링크 만들어" — 맥 미니가 만든 마지막 APK를 고정 주소로
describe('GET /app-updates/android.apk (D-APK-LINK-01)', () => {
  it('폴더의 android.apk를 설치 파일로 내려준다 — 같은 주소가 늘 새 것이라 캐시하지 않는다', async () => {
    const dir = folder()
    const apk = Buffer.from('PK\u0003\u0004 가짜 앱')
    writeFileSync(join(dir, 'android.apk'), apk)
    const response = await app(dir).request('/app-updates/android.apk')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="livegenie.apk"')
    expect(response.headers.get('content-length')).toBe(String(apk.length))
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(Buffer.from(await response.arrayBuffer()).equals(apk)).toBe(true)
  })

  it('아직 올린 APK가 없거나 폴더가 없으면 404', async () => {
    expect((await app(folder()).request('/app-updates/android.apk')).status).toBe(404)
    expect((await app(null).request('/app-updates/android.apk')).status).toBe(404)
  })

  it('화면 문서로 빠지지 않는 서버 경로', () => {
    expect(isServerPath('/app-updates/android.apk')).toBe(true)
  })
})
