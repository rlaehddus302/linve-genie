// 앱 화면 새 버전 나눠 주기 (D-OTA-01): 휴대폰 앱(expo-updates)이 켤 때 묻는 곳. Expo Updates 프로토콜 1.
//   GET /app-updates/manifest  머리글 expo-platform(ios|android)·expo-runtime-version(앱 버전 지문)
//     → 그 지문에 맞는 가장 새 묶음의 목록(multipart "manifest"), 없거나 이미 그것이면 "noUpdateAvailable" 지시
//   GET /app-updates/files/<platform>/<runtime>/<id>/<경로>  묶음 파일(바뀌지 않는다 — 오래 캐시)
//   GET /app-updates/android.apk  안드로이드 앱 내려받기 링크(D-APK-LINK-01) — 맥 미니가 마지막으로 만든 출시 APK(<폴더>/android.apk)
// 로그인·Origin 검사 밖이다: 앱이 로그인 전에도 묻고, 나가는 것은 누구나 받는 앱 화면 코드뿐(비밀 없음).
// 폴더(LIVEJJIM_APP_UPDATES_DIR): <platform>/<runtime>/current(지금 묶음 id 한 줄) · <platform>/<runtime>/<id>/
//   (expo export 결과 metadata.json·_expo/…·assets/…, 앱 설정 expoConfig.json, 올린 시각 created-at). 맥 미니 자동 내보내기가 넣는다.
// 지문이 다른 앱(네이티브 부품이 다른 옛 앱)에는 아무것도 주지 않는다 — 맞지 않는 화면 코드가 앱을 깨지 않게.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { join, resolve, sep } from 'node:path'
import type { Hono } from 'hono'

const PLATFORMS = new Set(['ios', 'android'])
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/
const UPDATE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const IMMUTABLE = 'public, max-age=31536000, immutable'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  bundle: 'application/javascript',
  hbc: 'application/javascript',
  js: 'application/javascript',
}

interface ExportMetadata {
  readonly fileMetadata: Readonly<Record<string, { readonly bundle: string; readonly assets: readonly { readonly path: string; readonly ext: string }[] }>>
}

interface ManifestAsset {
  readonly hash: string
  readonly key: string
  readonly contentType: string
  readonly fileExtension: string
  readonly url: string
}

export interface AppUpdateManifest {
  readonly id: string
  readonly createdAt: string
  readonly runtimeVersion: string
  readonly launchAsset: ManifestAsset
  readonly assets: readonly ManifestAsset[]
  readonly metadata: Record<string, never>
  readonly extra: { readonly expoClient: unknown }
}

export interface AppUpdatesOptions {
  /** 묶음 폴더. null이면 늘 "새 것 없음" */
  readonly dir: string | null
  /** 파일 주소 앞부분 (https://livegenie.kr) */
  readonly origin: string
}

function safeSegments(path: string): boolean {
  const parts = path.split('/')
  return parts.length > 0 && parts.every((part) => SAFE_SEGMENT.test(part) && part !== '.' && part !== '..')
}

/** 묶음 폴더 안의 파일만 — 밖으로 나가는 경로는 null */
function inside(root: string, ...parts: string[]): string | null {
  const base = resolve(root)
  const full = resolve(base, ...parts)
  return full.startsWith(base + sep) ? full : null
}

function directiveResponse(): Response {
  return multipart([{ name: 'directive', body: JSON.stringify({ type: 'noUpdateAvailable' }) }])
}

function multipart(parts: readonly { readonly name: string; readonly body: string }[]): Response {
  const boundary = `lg-${createHash('sha256').update(parts.map((part) => part.body).join('|')).digest('hex').slice(0, 24)}`
  const body = parts.map((part) => `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${part.body}\r\n`).join('') + `--${boundary}--\r\n`
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
      'expo-protocol-version': '1',
      'expo-sfv-version': '0',
      'Cache-Control': 'private, max-age=0',
    },
  })
}

function badRequest(): Response {
  return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: '잘못된 요청이에요.' } }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** 지금 묶음 목록을 만든다 (같은 묶음은 한 번만 해시한다). 없거나 깨졌으면 null */
export function createManifestReader(options: AppUpdatesOptions): (platform: string, runtime: string) => Promise<AppUpdateManifest | null> {
  const cache = new Map<string, AppUpdateManifest>()
  return async (platform, runtime) => {
    const { dir } = options
    if (dir === null || !PLATFORMS.has(platform) || !SAFE_SEGMENT.test(runtime)) return null
    const pointer = inside(dir, platform, runtime, 'current')
    if (pointer === null) return null
    const id = (await readText(pointer))?.trim() ?? ''
    if (!UPDATE_ID.test(id)) return null
    const key = `${platform}/${runtime}/${id}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const folder = inside(dir, platform, runtime, id)
    if (folder === null) return null
    const metaText = await readText(join(folder, 'metadata.json'))
    const configText = await readText(join(folder, 'expoConfig.json'))
    const createdAt = (await readText(join(folder, 'created-at')))?.trim() ?? ''
    if (metaText === null || configText === null || Number.isNaN(Date.parse(createdAt))) return null
    const files = (JSON.parse(metaText) as ExportMetadata).fileMetadata[platform]
    if (files === undefined || !safeSegments(files.bundle)) return null
    const base = `${options.origin}/app-updates/files/${platform}/${runtime}/${id}`
    const describe = async (path: string, ext: string, launch: boolean): Promise<ManifestAsset | null> => {
      if (!safeSegments(path)) return null
      const full = inside(folder, ...path.split('/'))
      if (full === null) return null
      const data = await readFile(full)
      return {
        hash: createHash('sha256').update(data).digest('base64url'),
        key: createHash('md5').update(data).digest('hex'),
        contentType: launch ? 'application/javascript' : (CONTENT_TYPES[ext] ?? 'application/octet-stream'),
        fileExtension: launch ? '.bundle' : `.${ext}`,
        url: `${base}/${path}`,
      }
    }
    const launchAsset = await describe(files.bundle, 'bundle', true)
    const assets = await Promise.all(files.assets.map((asset) => describe(asset.path, asset.ext, false)))
    if (launchAsset === null || assets.some((asset) => asset === null)) return null
    const manifest: AppUpdateManifest = {
      id,
      createdAt: new Date(createdAt).toISOString(),
      runtimeVersion: runtime,
      launchAsset,
      assets: assets.filter((asset): asset is ManifestAsset => asset !== null),
      metadata: {},
      extra: { expoClient: JSON.parse(configText) as unknown },
    }
    cache.clear()
    cache.set(key, manifest)
    return manifest
  }
}

export function registerAppUpdates(app: Hono, options: AppUpdatesOptions): void {
  const read = createManifestReader(options)

  app.get('/app-updates/manifest', async (c) => {
    const platform = c.req.header('expo-platform') ?? c.req.query('platform') ?? ''
    const runtime = c.req.header('expo-runtime-version') ?? c.req.query('runtime-version') ?? ''
    if (!PLATFORMS.has(platform) || !SAFE_SEGMENT.test(runtime)) return badRequest()
    let manifest: AppUpdateManifest | null
    try {
      manifest = await read(platform, runtime)
    } catch {
      manifest = null
    }
    if (manifest === null || c.req.header('expo-current-update-id') === manifest.id) return directiveResponse()
    return multipart([
      { name: 'manifest', body: JSON.stringify(manifest) },
      { name: 'extensions', body: JSON.stringify({ assetRequestHeaders: {} }) },
    ])
  })

  app.get('/app-updates/files/*', async (c) => {
    const { dir } = options
    const rest = c.req.path.slice('/app-updates/files/'.length)
    const [platform = '', runtime = '', id = '', ...path] = rest.split('/')
    if (dir === null || !PLATFORMS.has(platform) || !SAFE_SEGMENT.test(runtime) || !UPDATE_ID.test(id) || path.length === 0 || !safeSegments(path.join('/'))) return notFound()
    const full = inside(dir, platform, runtime, id, ...path)
    if (full === null) return notFound()
    try {
      if (!(await stat(full)).isFile()) return notFound()
      const data = await readFile(full)
      const ext = path[path.length - 1]?.split('.').pop() ?? ''
      return new Response(data, { status: 200, headers: { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': IMMUTABLE } })
    } catch {
      return notFound()
    }
  })

  // 안드로이드 앱 내려받기 (D-APK-LINK-01): 휴대폰 브라우저에서 누르면 바로 받아 설치. 같은 주소가 늘 가장 새 APK라 캐시하지 않는다
  app.get('/app-updates/android.apk', async (c) => {
    const { dir } = options
    const full = dir === null ? null : inside(dir, 'android.apk')
    if (full === null) return notFound()
    try {
      const info = await stat(full)
      if (!info.isFile()) return notFound()
      const headers = {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': String(info.size),
        'Content-Disposition': 'attachment; filename="livegenie.apk"',
        'Cache-Control': 'no-cache',
        'Last-Modified': info.mtime.toUTCString(),
      }
      if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { status: 200, headers })
    } catch {
      return notFound()
    }
  })
}
