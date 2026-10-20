// N1 적대 테스트 (test-domain) 라운드 0 — 재현한 버그 (AC-N1-42·50, LABEL_RULES L-12 5·7).
// TD-N1-001: 쓰기 오류(끊김)가 gattserverdisconnected 알림보다 먼저 오면 출력은 DISCONNECTED인데 상태는 PRINTING에 머문다.
//            그 사이 판매자가 `다시 연결`을 누르면 연결 창을 열지 않고 OK, 다음 출력은 BUSY.
// TD-N1-002: 가짜 기기 — 작업 중간에 TIMEOUT이 나면 다음 출력의 조각이 앞 시도에 이어 붙어 '출력마다' 기록이 깨지고,
//            다음 출력은 끝까지 받은 작업인데도 `AA`를 보내지 않아 늘 TIMEOUT이다.
//            D-N1-12(진행이 멈춘 20초) 뒤로는 크레딧이 안 오는 것만으로 작업 중간 TIMEOUT이 나지 않는다(조각이 1.03초마다 나가 끝까지 간다).
//            작업 중간 TIMEOUT은 쓰기가 멈출 때(가짜 기기 stallWriteAtPacket)만 나므로 그것으로 재현한다.
import { createBitmap, setPixel, type LabelBitmap } from '@livejjim/label'
import { MARKLIFE_S2, buildPrintJob, createFakeBluetooth, createMarklifeAdapter, type PrinterResult } from '@livejjim/printer'
import { describe, expect, it } from 'vitest'
import { ManualBle, StepTimer } from './ble-mock.ts'

/** 잘 줄지 않는 S2 그림 (조각이 여러 개 나가게) */
function noisy(height: number): LabelBitmap {
  const img = createBitmap(384, height)
  let s = 7
  for (let y = 0; y < height; y++)
    for (let x = 0; x < 384; x++) {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      if ((s & 3) === 0) setPixel(img, x, y, true)
    }
  return img
}

describe('AC-N1-42 끊김 — 쓰기 오류가 끊김 알림보다 먼저 온 경우', () => {
  it('TD-N1-001: 출력이 DISCONNECTED로 끝나면 상태도 DISCONNECTED이고, 다시 연결은 기기 고르기 창을 다시 연다', async () => {
    const timer = new StepTimer()
    const ble = new ManualBle({ name: 'S2_AB12', timer, onFlowStart: [[0x01, 0x04]] })
    const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    let result: PrinterResult | undefined
    void adapter.print(noisy(100)).then((r) => (result = r))
    await timer.advance(60)
    expect(ble.writes.length).toBeGreaterThan(0)
    // 연결이 끊겼다: gatt.connected는 false이고 쓰기는 NetworkError로 거절되지만 gattserverdisconnected 알림은 아직 오지 않았다
    ble.connected = false
    for (let i = 0; i < 100 && !result; i++) {
      ble.sendFlow([0x01, 0x01])
      await timer.advance(30)
    }
    expect(result).toBeDefined()
    expect((result as PrinterResult).ok).toBe(false)
    if ((result as PrinterResult).ok) return
    expect((result as Extract<PrinterResult, { ok: false }>).error.code).toBe('DISCONNECTED')
    // 결과가 끊김이면 상태도 끊김이어야 한다(L-12 5 — "그 전에 연결이 끊기면 DISCONNECTED", 상태 네 가지 계약)
    expect(adapter.state).toBe('DISCONNECTED')
    // 판매자가 `다시 연결`을 누르면 새로 연결한다 (출력 중이라며 그냥 OK를 돌려주지 않는다)
    ble.connected = false
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(ble.requests.length).toBe(2)
    expect(adapter.state).toBe('CONNECTED')
  })
})

describe('AC-N1-50 가짜 기기 — 출력마다 따로 기록한다', () => {
  it('TD-N1-002 (D-N1-12 뒤): 크레딧이 전혀 안 오는 기기에서는 작업 중간 TIMEOUT이 없다 — 1.03초마다 끝까지 보내고 출력 OK, 시도 하나', async () => {
    const timer = new StepTimer()
    const fake = createFakeBluetooth({ name: 'S2_FAKE01', timer, initialCredits: null, creditsPerPacket: 0 })
    const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    const img = noisy(240)
    const job = buildPrintJob(MARKLIFE_S2, img)
    if (!job.ok) throw new Error(job.code)
    const chunks = Math.ceil(job.bytes.length / 90)
    // 옛 규칙(출력 시작 20초)이면 반드시 중간에 끊기는 크기다
    expect(1_000 + (chunks - 1) * 1_030).toBeGreaterThan(20_000)
    let first: PrinterResult | undefined
    void adapter.print(img).then((r) => (first = r))
    for (let i = 0; i < 4_000 && !first; i++) await timer.advance(100)
    expect(first).toEqual({ ok: true })
    expect(fake.packets).toHaveLength(chunks)
    expect(fake.attempts).toHaveLength(1)
    expect(fake.attempts[0]).toMatchObject({ complete: true, acked: true })
    expect(Buffer.from(fake.attempts[0]?.bytes ?? []).equals(Buffer.from(job.bytes))).toBe(true)
    expect(timer.now).toBeGreaterThanOrEqual(1_000 + (chunks - 1) * 1_030)
  })

  it('TD-N1-002: 작업 중간에 TIMEOUT(쓰기 멈춤)이 난 뒤의 다음 출력은 새 시도로 기록되고, 끝까지 받으면 AA를 보내 출력 OK가 된다', async () => {
    const timer = new StepTimer()
    // 첫 출력의 6번째 조각 쓰기가 끝나지 않는다(연결은 그대로) → 5번째 쓰기가 끝나고 20초에 작업 중간 TIMEOUT
    const fake = createFakeBluetooth({ name: 'S2_FAKE01', timer, initialCredits: null, creditsPerPacket: 0, jobs: { 1: { stallWriteAtPacket: 6 } } })
    const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })

    let first: PrinterResult | undefined
    void adapter.print(noisy(240)).then((r) => (first = r))
    for (let i = 0; i < 300 && !first; i++) await timer.advance(100)
    expect(first).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'TIMEOUT' }) }))
    // 5번째 조각(1,000 + 4 × 1,030 = 5,120ms)의 쓰기가 끝나고 20초
    expect(timer.now).toBeGreaterThanOrEqual(25_120)
    expect(timer.now).toBeLessThan(25_220)
    expect(fake.attempts).toHaveLength(1)
    expect(fake.attempts[0]?.complete).toBe(false)
    expect(fake.attempts[0]?.packets).toHaveLength(5)

    // 다음 출력: 작은 그림 하나(조각 하나) — 크레딧을 넉넉히 준다
    const small = createBitmap(384, 16)
    const job = buildPrintJob(MARKLIFE_S2, small)
    if (!job.ok) throw new Error(job.code)
    let second: PrinterResult | undefined
    void adapter.print(small).then((r) => (second = r))
    for (let i = 0; i < 300 && !second; i++) {
      fake.sendFlow([0x01, 0x04])
      await timer.advance(100)
    }
    // 출력마다 조각을 이어 붙인 바이트를 따로 돌려준다 (L-12 7, AC-N1-50)
    expect(fake.attempts).toHaveLength(2)
    const attempt = fake.attempts[1]
    expect(attempt && Buffer.from(attempt.bytes).equals(Buffer.from(job.bytes))).toBe(true)
    expect(attempt?.complete).toBe(true)
    expect(attempt?.acked).toBe(true)
    expect(second).toEqual({ ok: true })
    // 앞 출력의 멈춘 쓰기가 이제 끝나도 기록·결과가 바뀌지 않는다
    fake.releaseStalledWrites()
    await timer.advance(30_000)
    expect(fake.attempts).toHaveLength(2)
    expect(fake.printed).toHaveLength(1)
  })
})
