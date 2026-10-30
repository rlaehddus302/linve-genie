// PRN2 적대 시험 (test-domain): 프로필 하나를 더하는 일은 표에 한 줄을 더하는 것이다 — 코드 분기 없이 (AC-PRN2-11, L-12 1 "목록 (PRN2 개정)", D-PRN2-01·05).
// ① 실제 표 파일(profiles.ts)을 임시로 복사해 표에 가짜 줄 둘(L-12 Luck Jingle 방식 `Q5_` · NIIMBOT 모델 `B3S`)만 더한 판을 불러,
//    판정(pickListTarget)·찾기 거르기·크기 목록·지원 단계·실험 안내·알릴 프로필 ID가 다른 코드 없이 따라오는지 본다. 원래 줄의 답(골든 list)은 그대로다.
// ② 켠 표를 인자로 받는 길(웹 한 목록 어댑터·Marklife 어댑터·NIIMBOT 어댑터·앱 계열 표·앱 고르기)에 같은 가짜 줄을 넣어 이어지고 찍히는지 본다.
// ③ 코드에 프로필 ID 글자가 박힌 곳이 표 파일 말고는 없다(모델 이름으로 가르는 분기 없음).
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBitmap } from '@livejjim/label'
import {
  LABEL_PROFILES,
  NIIMBOT_B21,
  NIIMBOT_PROFILES,
  PRINTER_PROFILES,
  buildPrintJob,
  createB1Adapter,
  createFakeNiimbotBluetooth,
  createMarklifeAdapter,
  createNiimbotAdapter,
  createWebPrinterAdapter,
  pickListFilter,
  pickListTarget,
  printerRequestOptions,
  systemTimer,
  type BluetoothRequestOptions,
  type ModelProfile,
  type NiimbotProfile,
  type PrinterResult,
} from '@livejjim/printer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFakeBleTransport, createPrinterPicker, familyOf, marklifeFamily, niimbotFamily } from '../../../packages/mobile-ble/src/index.ts'
import { ManualBle, StepTimer } from '../n1/ble-mock.ts'
import { golden } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const PRINTER_SRC = join(ROOT, 'packages', 'printer', 'src')

/** 가짜 L-12 줄 — 있는 방식(Luck Jingle)·새 이름 앞자리·새 크기 묶음 */
const FAKE_Q5: ModelProfile = Object.freeze({
  id: 'FAKE_Q5',
  maker: 'Fake',
  displayName: '가짜 Q5',
  protocol: 'LUCKJINGLE',
  dpi: 203,
  headDots: 384,
  rotate: 'NONE',
  sizes: Object.freeze(['50x50', '50x30'] as const),
  defaultSize: '50x50',
  density: null,
  experimental: true,
  fallbackApp: '가짜 앱',
  namePrefix: 'Q5_',
})
/** 가짜 NIIMBOT 줄 — niimbluelib 모델 B3S (지금 표에 없는 모델) */
const FAKE_B3S: NiimbotProfile = Object.freeze({ ...NIIMBOT_B21, id: 'NIIMBOT_B3S', model: 'B3S', displayName: 'NIIMBOT B3S', experimental: true })

const FAKE_Q5_SRC = `{ id: 'FAKE_Q5', maker: 'Fake', displayName: '가짜 Q5', protocol: 'LUCKJINGLE', dpi: 203, headDots: 384, rotate: 'NONE', sizes: ['50x50', '50x30'], defaultSize: '50x50', density: null, experimental: true, fallbackApp: '가짜 앱', namePrefix: 'Q5_' }`
const FAKE_B3S_SRC = `{ ...NIIMBOT_B21, id: 'NIIMBOT_B3S', model: 'B3S', displayName: 'NIIMBOT B3S', experimental: true }`

type ProfilesModule = typeof import('../../../packages/printer/src/profiles.ts')
let dir = ''
let extended: ProfilesModule

/** 표 파일에서 표 한 줄을 더하는 자리 하나를 바꾼다 (자리가 정확히 하나여야 한다 — 아니면 표 모양이 바뀐 것) */
function addRow(source: string, anchor: string, replacement: string): string {
  const count = source.split(anchor).length - 1
  if (count !== 1) throw new Error(`표 자리 '${anchor}'가 ${String(count)}번 있다 — 표 모양이 바뀌었으면 이 시험의 자리도 고친다`)
  return source.replace(anchor, replacement)
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'livejjim-prn2-row-'))
  const label = pathToFileURL(join(ROOT, 'packages', 'label', 'src', 'index.ts')).href
  for (const file of ['adapter.ts', 'errors.ts']) writeFileSync(join(dir, file), readFileSync(join(PRINTER_SRC, file), 'utf8').replaceAll("'@livejjim/label'", `'${label}'`))
  let profiles = readFileSync(join(PRINTER_SRC, 'profiles.ts'), 'utf8').replaceAll("'@livejjim/label'", `'${label}'`)
  // 표에 줄을 더하는 일만 한다 (코드는 그대로)
  profiles = addRow(profiles, 'Object.freeze([B1_PROFILE, NIIMBOT_B1_SE, NIIMBOT_B21, NIIMBOT_D110])', `Object.freeze([B1_PROFILE, NIIMBOT_B1_SE, NIIMBOT_B21, NIIMBOT_D110, deepFreeze(${FAKE_B3S_SRC} as NiimbotProfile)])`)
  profiles = addRow(profiles, 'Object.freeze([...MARKLIFE_PROFILES, BAUATO_PPA2L])', `Object.freeze([...MARKLIFE_PROFILES, BAUATO_PPA2L, deepFreeze(${FAKE_Q5_SRC} as ModelProfile)])`)
  writeFileSync(join(dir, 'profiles.ts'), profiles)
  extended = (await import(pathToFileURL(join(dir, 'profiles.ts')).href)) as ProfilesModule
})

afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true })
})

describe('AC-PRN2-11 ① 실제 표 파일에 한 줄씩 더한 판 — 코드는 그대로', () => {
  it('켠 표에 두 줄이 늘었다 (14 → 16), 원래 줄은 그대로', () => {
    expect(extended.PRINTER_PROFILES.map((p) => p.id)).toEqual([...NIIMBOT_PROFILES.map((p) => p.id), 'NIIMBOT_B3S', ...LABEL_PROFILES.map((p) => p.id), 'FAKE_Q5'])
    for (const p of PRINTER_PROFILES) expect(JSON.stringify(extended.printerProfile(p.id))).toBe(JSON.stringify(p))
  })

  it('고르기 목록 판정: 새 앞자리 `Q5_` → 새 줄, 새 모델 이름 꼴 `B3S-`·`B3S_` → NIIMBOT (글자 그대로)', () => {
    expect(extended.pickListTarget('Q5_00AB')).toBe('FAKE_Q5')
    expect(extended.pickListTarget('Q5_00AB', [extended.NIIMBOT_SERVICE_UUID])).toBe('FAKE_Q5')
    expect(extended.pickListTarget('q5_00AB')).toBeNull()
    expect(extended.pickListTarget(' Q5_00AB')).toBeNull()
    expect(extended.pickListTarget('B3S-1234')).toBe('NIIMBOT')
    expect(extended.pickListTarget('B3S_1234')).toBe('NIIMBOT')
    expect(extended.pickListTarget('B3S1234')).toBeNull()
    // 더하기 전 표에서는 목록 밖이었다
    expect(pickListTarget('Q5_00AB')).toBeNull()
    expect(pickListTarget('B3S-1234')).toBeNull()
  })

  it('골든 list의 원래 답은 줄을 더해도 그대로', () => {
    for (const c of golden('list')) expect(extended.pickListTarget(c.name, c.services ?? []), c.id).toBe(c.out.list)
  })

  it('찾기 거르기(웹 filters·앱 찾기)에 새 앞자리·새 모델 이름 꼴이 든다', () => {
    const f = extended.pickListFilter()
    expect(f.labelNamePrefixes).toContain('Q5_')
    expect(f.niimbotNamePrefixes).toEqual(expect.arrayContaining(['B3S-', 'B3S_']))
    expect(f.labelNamePrefixes).toEqual([...pickListFilter().labelNamePrefixes, 'Q5_'])
  })

  it('크기 목록·크기 판단·지원 단계·실험 안내·알릴 프로필 ID가 새 줄을 따른다', () => {
    expect(extended.labelSizesForProfileId('FAKE_Q5')).toEqual(['50x50', '50x30'])
    expect(extended.profileSupportsSize('FAKE_Q5', '50x50')).toBe(true)
    expect(extended.profileSupportsSize('FAKE_Q5', '50x40')).toBe(false)
    expect(extended.labelSizesForProfileId('NIIMBOT_B3S')).toEqual(['50x30', '50x20', '50x40'])
    expect(extended.printerSupportStage('FAKE_Q5')).toBe('EXPERIMENTAL')
    expect(extended.printerSupportStage('NIIMBOT_B3S')).toBe('EXPERIMENTAL')
    expect(extended.experimentalNotice(extended.printerProfile('FAKE_Q5')!)).toBe('실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 가짜 앱에서 인쇄해 주세요.')
    expect(extended.connectedProfileId({ state: 'CONNECTED', profile: extended.printerProfile('FAKE_Q5')! })).toBe('FAKE_Q5')
    expect(extended.connectedProfileId({ state: 'PRINTING', profile: extended.printerProfile('NIIMBOT_B3S')! })).toBe('NIIMBOT_B3S')
    // 더하기 전 판에서는 모름 → B1 목록·그림 파일로만
    expect(extended.labelSizesForProfileId('FAKE_Q6')).toEqual(['50x30', '50x20', '50x40'])
    expect(extended.printerSupportStage('FAKE_Q6')).toBe('IMAGE_ONLY')
  })

  it('Marklife 어댑터 기본 목록(LABEL_PROFILES)에도 새 줄이 든다', () => {
    expect(extended.LABEL_PROFILES.map((p) => p.id).at(-1)).toBe('FAKE_Q5')
    expect(extended.profileForDeviceName('Q5_77')?.id).toBe('FAKE_Q5')
  })
})

// ─── ② 켠 표를 인자로 받는 길 ───

const TABLE: readonly ModelProfile[] = [...NIIMBOT_PROFILES, FAKE_B3S, ...LABEL_PROFILES, FAKE_Q5]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

describe('AC-PRN2-11 ② 켠 표에 줄을 넣으면 어댑터·앱 고르기가 따라온다', () => {
  it('웹 한 목록 어댑터: 고르기 창 filters에 Q5_·B3S-가 들고, Q5_ 기기를 고르면 L-12 쪽으로 이어 Luck Jingle 바이트로 찍는다', async () => {
    const timer = new StepTimer()
    let total = -1
    let sent = 0
    const ble: ManualBle = new ManualBle({
      name: 'Q5_00AB',
      timer,
      onFlowStart: [[0x01, 0x04]],
      onWriteEnd: (_i, w) => {
        ble.sendFlow([0x01, 0x01])
        sent += w.bytes.length
        if (sent === total) timer.schedule(() => ble.sendNotify([0x4f, 0x4b]), 5)
      },
    })
    let request: BluetoothRequestOptions | undefined
    const adapter = createWebPrinterAdapter({
      profiles: TABLE,
      timer,
      environment: () => ({ bluetooth: { getAvailability: () => Promise.resolve(true), requestDevice: (r: BluetoothRequestOptions) => ((request = r), Promise.resolve(ble.device)) }, userAgent: UA, maxTouchPoints: 0 }),
    })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    const prefixes = ((request as unknown as { filters: { namePrefix?: string }[] }).filters ?? []).map((f) => f.namePrefix)
    expect(prefixes).toEqual(expect.arrayContaining(['Q5_', 'B3S-', 'B3S_']))
    expect(printerRequestOptions(TABLE)).toEqual(request)
    expect(adapter.kind).toBe('LABEL')
    expect(adapter.profile.id).toBe('FAKE_Q5')
    const image = createBitmap(384, 40)
    const job = buildPrintJob(FAKE_Q5, image)
    if (!job.ok) throw new Error(job.code)
    total = job.bytes.length
    let result: PrinterResult | undefined
    void adapter.print(image).then((r) => (result = r))
    for (let i = 0; i < 100 && result === undefined; i++) await timer.advance(1_000)
    // Luck Jingle 방식이라 OK(4F 4B)도 끝이다 (방식 = 데이터)
    expect(result).toEqual({ ok: true })
    expect(Buffer.from(ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    await adapter.disconnect()
  })

  it('Marklife 어댑터에 새 줄만 넣어도 이름으로 고른다 (고르기 창 거르기 = [Q5_])', async () => {
    const timer = new StepTimer()
    const ble = new ManualBle({ name: 'Q5_9', timer, onFlowStart: [[0x01, 0x04]] })
    const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: [FAKE_Q5] })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(adapter.profile.id).toBe('FAKE_Q5')
    expect(ble.requests[0]?.filters.map((f) => f.namePrefix)).toEqual(['Q5_'])
    await adapter.disconnect()
  })

  it('NIIMBOT 어댑터(createNiimbotAdapter — createB1Adapter는 켠 표 고정): 켠 표에 B3S 줄이 있으면 모델 B3S를 그 프로필로 쓰고, 없으면 WRONG_MODEL', async () => {
    const yes = createFakeNiimbotBluetooth({ model: 'B3S', name: 'B3S-0001' })
    const withRow = createNiimbotAdapter({ environment: () => yes.environment, createClient: yes.createClient, timer: systemTimer, profiles: [...NIIMBOT_PROFILES, FAKE_B3S] })
    expect(await withRow.connect('bluetooth')).toEqual({ ok: true })
    expect(withRow.profile.id).toBe('NIIMBOT_B3S')
    await withRow.disconnect()
    const no = createFakeNiimbotBluetooth({ model: 'B3S', name: 'B3S-0001' })
    const without = createB1Adapter({ environment: () => no.environment, createClient: no.createClient, timer: systemTimer })
    expect(await without.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL', detail: '모델: B3S' } })
  })

  it('앱 계열 표: 새 줄을 넣은 계열이 Q5_·B3S-를 맡고, 고르기 목록 줄은 "가짜 Q5 · 실험"', () => {
    const families = [marklifeFamily({ profiles: [...LABEL_PROFILES, FAKE_Q5] }), niimbotFamily({ profiles: [...NIIMBOT_PROFILES, FAKE_B3S] })]
    expect(familyOf('Q5_1', families)).toBe('MARKLIFE')
    expect(familyOf('B3S-1', families)).toBe('NIIMBOT')
    expect(familyOf('Q5_1', [marklifeFamily(), niimbotFamily()])).toBeNull()
    const fake = createFakeBleTransport()
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice: () => Promise.resolve(null), families })
    const entries = picker.entries([
      { id: 'A1', name: 'Q5_1', rssi: -40 },
      { id: 'A2', name: 'B3S-1', rssi: -50 },
    ])
    expect(entries.map((e) => e.detail)).toEqual(['가짜 Q5 · 실험 · 신호 강함', 'NIIMBOT · 신호 강함'])
  })
})

describe('AC-PRN2-11 ③ 프로필 ID 글자는 표 파일에만 있다', () => {
  const IDS = PRINTER_PROFILES.map((p) => p.id)
  const dirs = [PRINTER_SRC, join(ROOT, 'packages', 'mobile-ble', 'src'), join(ROOT, 'apps', 'server', 'src'), join(ROOT, 'apps', 'web', 'src'), join(ROOT, 'apps', 'mobile', 'src')]
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(d, e.name)] : []))
  it('profiles.ts(표)와 adapter.ts(B1 줄·방식 이름) 밖의 제품 코드에 프로필 ID 글자가 없다 — 모델로 가르는 분기 없음', () => {
    const hits: string[] = []
    for (const file of dirs.flatMap(walk)) {
      if (file === join(PRINTER_SRC, 'profiles.ts') || file === join(PRINTER_SRC, 'adapter.ts')) continue
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n')
      for (const id of IDS) if (new RegExp(`['"\`]${id}['"\`]`).test(code)) hits.push(`${file.slice(ROOT.length + 1)}: ${id}`)
    }
    expect(hits).toEqual([])
  })
})
