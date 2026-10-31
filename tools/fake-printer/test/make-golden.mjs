// 골든 파일 만들기 — TS 가짜(packages/mobile-ble createFakeB1 · packages/printer createFakeBluetooth·buildPrintJob)가
// 같은 입력 바이트에 내는 응답과 받은 점을 JSON으로 적는다. Swift 가짜 프린터의 자체 시험(fake-printer-selftest)이 이 파일과 맞춰 본다.
// 실행: node tools/fake-printer/test/make-golden.mjs  (저장소 루트에서, pnpm install 뒤)
// 패키지 소스(.ts)를 그대로 들여온다(Node 24 타입 지우기). 시각·난수를 쓰지 않아 몇 번 돌려도 같은 파일이 나온다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBitmap, setPixel } from '../../../packages/label/src/index.ts'
import { createFakeB1, createFakeBleTransport, createNativeB1Adapter } from '../../../packages/mobile-ble/src/index.ts'
import { BAUATO_PPA2L, MARKLIFE_P12, MARKLIFE_P50, MARKLIFE_S2, MARKLIFE_X2, buildPrintJob, createFakeBluetooth } from '../../../packages/printer/src/index.ts'
import { rotateClockwise } from '../../../packages/printer/src/job.ts'
import { GATT_BUNDLES } from '../../../packages/printer/src/bluetooth.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'golden')
mkdirSync(outDir, { recursive: true })

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (text) => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16))
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 시험 그림 (packages/mobile-ble/test/fakes.ts의 sampleImage와 같은 꼴): 테두리 + 대각선 + 씨앗으로 다른 점 */
function sampleImage(seed, width, height) {
  const image = createBitmap(width, height)
  for (let x = 0; x < width; x++) {
    setPixel(image, x, 0, true)
    setPixel(image, x, height - 1, true)
    setPixel(image, x, Math.floor((x * height) / width), true)
  }
  for (let y = 0; y < height; y++) {
    setPixel(image, 0, y, true)
    setPixel(image, width - 1, y, true)
    setPixel(image, (y * 7 + seed * 13) % width, y, true)
  }
  return image
}

/** 시각 없이 걸어 두기만 하는 타이머 (심박이 돌지 않게) */
const idleTimer = { setTimeout: () => 0, clearTimeout: () => undefined }

/** niimbluelib이 찍는 진행 글(console.log·warn)은 골든과 상관없다 — 끈다 */
console.log = () => undefined
console.warn = () => undefined
console.info = () => undefined

/** B1: 앱 어댑터로 한 장을 찍어 프린터가 받은 쓰기 조각을 모은 뒤, 새 가짜 B1(바로 답함)에 조각마다 넣어 답을 적는다 */
async function b1Golden(mtu, name) {
  const fake = createFakeBleTransport({ mtu })
  const chunks = []
  const original = fake.printer.write.bind(fake.printer)
  fake.printer.write = (bytes) => {
    chunks.push(new Uint8Array(bytes))
    original(bytes)
  }
  const adapter = createNativeB1Adapter({
    transport: fake.transport,
    pickDevice: (scan) => new Promise((resolve) => scan.onDevices((devices) => resolve(devices[0] ?? null))),
    timer: idleTimer,
    client: { packetIntervalMs: 0 },
  })
  const connected = await adapter.connect('bluetooth')
  if (!connected.ok) throw new Error(`B1 연결 실패: ${JSON.stringify(connected)}`)
  const image = sampleImage(3, 384, 240)
  const printed = await adapter.print(image, { density: 3 })
  if (!printed.ok) throw new Error(`B1 출력 실패: ${JSON.stringify(printed)}`)
  await adapter.disconnect()
  await flush()

  // 덧붙이는 조각: 모르는 명령·다른 정보 요청·잡음 바이트·두 조각에 걸친 패킷
  const packet = (cmd, data) => {
    let chk = cmd ^ data.length
    for (const b of data) chk ^= b
    return Uint8Array.from([0x55, 0x55, cmd, data.length, ...data, chk, 0xaa, 0xaa])
  }
  const battery = packet(0x40, [10])
  chunks.push(packet(0x40, [7]), Uint8Array.from([0x00, 0x12, 0x55]), packet(0x99, [1, 2, 3]), battery.subarray(0, 4), battery.subarray(4), packet(0xdc, [3]), packet(0xa3, [1]))

  const replay = createFakeB1({ schedule: (run) => run() })
  let pending = []
  replay.onNotify((bytes) => pending.push(hex(bytes)))
  const steps = chunks.map((chunk) => {
    pending = []
    replay.write(chunk)
    return { write: hex(chunk), notify: pending }
  })
  const pages = replay.printed.map((p) => ({
    rows: p.rows,
    cols: p.cols,
    copies: p.copies,
    density: p.density,
    labelType: p.labelType,
    rasterRows: p.rasterRows,
    bitmap: hex(p.bitmap),
  }))
  const golden = { kind: 'b1', mtu, steps, pages }
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(golden, null, 1)}\n`)
  return golden
}

/** Marklife: 작업 바이트를 조각으로 나눠 가짜 Web Bluetooth 기기에 쓰고, 조각마다 흐름 제어(ff03)·알림(ff01)으로 나온 것을 적는다 */
async function marklifeGolden({ name, deviceName, profile, images, chunkSize, options, bundle = 'A', noFlow = false }) {
  const spec = GATT_BUNDLES[bundle]
  // noFlow: 꾸러미 A에 흐름 제어(ff03)가 없는 기기 (D-PRN2-03)
  const fake = createFakeBluetooth({ name: deviceName, bundle, ...(noFlow ? { missingCharacteristics: ['ff03'] } : {}), ...options })
  const device = await fake.bluetooth.requestDevice({ filters: [{ namePrefix: profile.namePrefix }], optionalServices: [] })
  const server = await device.gatt.connect()
  const service = await server.getPrimaryService(spec.service)
  const write = await service.getCharacteristic(spec.write)
  const notify = await service.getCharacteristic(spec.notify)
  const flow = spec.flow === null || noFlow ? null : await service.getCharacteristic(spec.flow)
  let pending = []
  const listen = (char, label) =>
    char.addEventListener('characteristicvaluechanged', () => {
      const v = char.value
      pending.push({ char: label, bytes: hex(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) })
    })
  listen(notify, bundle === 'A' ? 'ff01' : 'fd02')
  if (flow !== null) listen(flow, 'ff03')
  await notify.startNotifications()
  if (flow !== null) await flow.startNotifications()
  const onSubscribe = pending
  const steps = []
  const jobs = []
  for (const image of images) {
    const job = buildPrintJob(profile, image)
    if (!job.ok) throw new Error(`작업 바이트 실패: ${job.code}`)
    const sent = profile.rotate === 'CW90' ? rotateClockwise(image) : image
    jobs.push({ width: sent.width, height: sent.height, bitmap: hex(sent.data), length: job.bytes.length })
    for (let at = 0; at < job.bytes.length; at += chunkSize) {
      pending = []
      await write.writeValueWithoutResponse(job.bytes.subarray(at, at + chunkSize))
      steps.push({ write: hex(job.bytes.subarray(at, at + chunkSize)), notify: pending })
    }
  }
  const golden = {
    kind: 'marklife',
    bundle,
    protocol: profile.protocol,
    deviceName,
    options: {
      initialCredits: options.initialCredits === undefined ? 4 : options.initialCredits,
      creditsPerPacket: options.creditsPerPacket ?? 1,
      mtu: options.mtu ?? null,
      ...(options.ack === undefined ? {} : { ack: options.ack }),
    },
    onSubscribe,
    steps,
    jobs,
    attempts: fake.attempts.map((a) => ({ complete: a.complete, acked: a.acked, length: a.bytes.length })),
  }
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(golden, null, 1)}\n`)
  return golden
}

await b1Golden(23, 'b1-mtu23')
await b1Golden(185, 'b1-mtu185')
await marklifeGolden({ name: 's2-yxq2', deviceName: 'S2_FAKE_BLE', profile: MARKLIFE_S2, images: [sampleImage(5, 384, 240), sampleImage(6, 384, 160)], chunkSize: 90, options: {} })
await marklifeGolden({
  name: 's2-yxq2-nocredit-mtu',
  deviceName: 'S2_FAKE_BLE',
  profile: MARKLIFE_S2,
  images: [sampleImage(7, 384, 240)],
  chunkSize: 20,
  options: { initialCredits: null, creditsPerPacket: 0, mtu: 23 },
})
await marklifeGolden({ name: 'p50-yxq3', deviceName: 'P50_FAKE', profile: MARKLIFE_P50, images: [sampleImage(8, 384, 240), sampleImage(10, 384, 160)], chunkSize: 90, options: {} })
await marklifeGolden({ name: 'x2-yxq8-c', deviceName: 'X2-FAKE', profile: MARKLIFE_X2, bundle: 'C', images: [sampleImage(9, 384, 240), sampleImage(11, 384, 200)], chunkSize: 90, options: { initialCredits: null, creditsPerPacket: 0 } })
await marklifeGolden({ name: 'p12-l11', deviceName: 'P12_FAKE', profile: MARKLIFE_P12, images: [sampleImage(2, 320, 96), sampleImage(4, 240, 96)], chunkSize: 90, options: {} })
// 바우아토 (Luck Jingle — D-PRN2-02): OK(4F 4B) 끝 알림, 흐름 제어(ff03) 없는 꾸러미 A (D-PRN2-03)
await marklifeGolden({
  name: 'bauato-luckjingle-ok-noflow',
  deviceName: 'PPA2L_FAKE',
  profile: BAUATO_PPA2L,
  images: [sampleImage(12, 384, 240), sampleImage(13, 384, 120)],
  chunkSize: 90,
  noFlow: true,
  options: { initialCredits: null, creditsPerPacket: 0, ack: 'ok' },
})

// 스스로 맞춰 보기: 골든의 첫 B1 쪽은 보낸 그림과 같은 점이어야 한다 (가짜 B1의 줄 풀기가 맞는지)
const b1 = JSON.parse((await import('node:fs')).readFileSync(join(outDir, 'b1-mtu23.json'), 'utf8'))
const page = b1.pages[0]
const sent = sampleImage(3, 384, 240)
const got = fromHex(page.bitmap)
let diff = 0
for (let i = 0; i < sent.data.length; i++) if (sent.data[i] !== got[i]) diff++
if (diff > 0) process.exitCode = 1
process.stdout.write(`골든을 만들었다: ${outDir} (B1 쪽 ${b1.pages.length}개, 보낸 그림과 다른 바이트 ${diff}개)\n`)
