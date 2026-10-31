// 임시 앱 아이콘·스플래시·Play 그림을 만든다 (정식 디자인 전까지 자리 채움).
// 초록 단색 바탕 + 흰 글자 "지니". 저장소에 이미 있는 @napi-rs/canvas(packages/label)를 쓴다.
//   node apps/mobile/scripts/make-icons.mjs [Play 그림 폴더]
// 앱 안 그림 → apps/mobile/assets/ (커밋). Play 그림(512 아이콘·1024×500 그래픽)은 폴더를 줄 때만 그곳에 쓴다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const require = createRequire(join(ROOT, '..', '..', 'packages', 'label', 'package.json'))
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')

const GREEN = '#1F8A4C'
const WHITE = '#FFFFFF'
const WORD = '지니'
const FONT_FILE = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
const FONT = GlobalFonts.registerFromPath(FONT_FILE, 'IconFont') ? 'IconFont' : 'sans-serif'

/** w×h 그림. bg가 null이면 투명. 글자는 가운데, 높이 = textScale×min(w,h) */
function draw(w, h, { bg, textScale, sub }) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (bg !== null) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
  }
  ctx.fillStyle = WHITE
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const size = Math.round(Math.min(w, h) * textScale)
  ctx.font = `bold ${size}px ${FONT}`
  ctx.fillText(WORD, w / 2, sub === undefined ? h / 2 : h * 0.44)
  if (sub !== undefined) {
    ctx.font = `bold ${Math.round(size * 0.28)}px ${FONT}`
    ctx.fillText(sub, w / 2, h * 0.44 + size * 0.75)
  }
  return canvas.encode('png')
}

async function save(path, png) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, await png)
  console.log(`만듦: ${path}`)
}

const assets = join(ROOT, 'assets')
// 앱 아이콘(1024, 바탕 포함)
await save(join(assets, 'icon.png'), draw(1024, 1024, { bg: GREEN, textScale: 0.36 }))
// 적응형 아이콘 앞면(1024 투명) — 108dp 중 가운데 66dp(약 61%) 안전영역 안에 글자를 둔다. 바탕색은 app.json backgroundColor
await save(join(assets, 'adaptive-icon.png'), draw(1024, 1024, { bg: null, textScale: 0.24 }))
// 스플래시 가운데 그림(투명 바탕 위 글자, 바탕색은 app.json splash.backgroundColor)
await save(join(assets, 'splash-icon.png'), draw(1024, 1024, { bg: null, textScale: 0.3 }))

const playDir = process.argv[2]
if (playDir !== undefined) {
  await save(join(playDir, 'play-icon-512.png'), draw(512, 512, { bg: GREEN, textScale: 0.36 }))
  await save(join(playDir, 'feature-graphic-1024x500.png'), draw(1024, 500, { bg: GREEN, textScale: 0.42, sub: '라이브 방송 찜·라벨 도우미' }))
}
