// NiimbotBleClient — 가짜 B1 위에서 협상·모델·MTU 조각·끊김·알맞은 특성 고르기 (APP-03).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { B1_MODEL_ID, FAKE_B1_SERVICE, NiimbotBleClient, NoDeviceError, createFakeBleTransport, pickChannel, splitForMtu } from '../src/index.ts'

beforeAll(() => {
  // niimbluelib은 지원하지 않는 정보 조회를 console.warn으로 알린다 — 시험 출력을 조용히
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

const clients: NiimbotBleClient[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect()
})

function make(options: Parameters<typeof createFakeBleTransport>[0] = {}) {
  const fake = createFakeBleTransport(options)
  const client = new NiimbotBleClient(fake.transport, { packetIntervalMs: 0 })
  clients.push(client)
  return { fake, client }
}

describe('연결', () => {
  it('고른 기기로 잇고 협상·모델(B1)·심박까지 niimbluelib 그대로 — 고르기 창은 어댑터 몫', async () => {
    const { fake, client } = make()
    const info = await client.connect({ authorizedDevice: fake.device })
    expect(info).toEqual({ deviceName: 'B1-FAKE01', result: 2 })
    expect(client.isConnected()).toBe(true)
    expect(client.getModelMetadata()?.model).toBe('B1')
    expect(client.getPrinterInfo().modelId).toBe(B1_MODEL_ID)
    expect(client.getType()).toBe('bluetooth')
    expect(client.device).toEqual(fake.device)
    // 첫 요청은 연결(193), 그다음 모델 조회(64)
    expect(fake.printer.requests.slice(0, 2)).toEqual([193, 64])
  })

  it('고른 기기가 없으면 NotFoundError(어댑터가 NOT_SELECTED로 읽음)', async () => {
    const { client } = make()
    await expect(client.connect()).rejects.toBeInstanceOf(NoDeviceError)
    await expect(client.connect({ authorizedDevice: { name: 'x' } })).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('알맞은 특성(notify + writeWithoutResponse)이 없으면 끊고 실패 — Web Bluetooth 판과 같은 문장', async () => {
    const { fake, client } = make({ characteristics: [{ serviceUuid: FAKE_B1_SERVICE, uuid: 'x', notify: true, writeWithoutResponse: false }] })
    await expect(client.connect({ authorizedDevice: fake.device })).rejects.toThrow('Suitable device characteristic not found')
    expect(fake.connected).toBe(false)
    expect(client.isConnected()).toBe(false)
  })

  it('pickChannel: 짧은 서비스(16비트)는 건너뛰고 첫 notify+writeWithoutResponse', () => {
    expect(
      pickChannel([
        { serviceUuid: '1800', uuid: 'a', notify: true, writeWithoutResponse: true },
        { serviceUuid: FAKE_B1_SERVICE, uuid: 'b', notify: true, writeWithoutResponse: false },
        { serviceUuid: FAKE_B1_SERVICE, uuid: 'c', notify: true, writeWithoutResponse: true },
      ])?.uuid,
    ).toBe('c')
    expect(pickChannel([])).toBeUndefined()
  })

  it('프린터가 답하지 않으면(협상 시간 초과) 끊고 실패 — 어댑터의 다시 잇기 한 번 대상', async () => {
    const { fake, client } = make({ printer: { silent: [193] } })
    const started = Date.now()
    await expect(client.connect({ authorizedDevice: fake.device })).rejects.toThrow(/Unable to perform initial negotiate/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(fake.connected).toBe(false)
  })

  it('블루투스가 꺼져 있으면 연결이 실패한다', async () => {
    const { fake, client } = make({ radio: 'off' })
    await expect(client.connect({ authorizedDevice: fake.device })).rejects.toThrow(/not enabled/)
  })
})

describe('쓰기 조각 (MTU)', () => {
  it('MTU 23이면 20바이트씩, 이어 붙이면 패킷 그대로 — 프린터는 모든 패킷을 풀어 낸다', async () => {
    const { fake, client } = make({ mtu: 23 })
    await client.connect({ authorizedDevice: fake.device })
    const before = fake.printer.writes
    const packet = new Uint8Array([0x55, 0x55, 0x21, 0x01, 0x03, 0x23, 0xaa, 0xaa]) // setDensity 3 (8바이트)
    await client.sendRaw(packet)
    expect(fake.printer.writes - before).toBe(1)
    const long = new Uint8Array(61).fill(0x11)
    await client.sendRaw(long)
    expect(fake.printer.writes - before).toBe(1 + 4)
    expect(fake.printer.received.slice(-61)).toEqual(long)
    expect(splitForMtu(long, 23).map((c) => c.length)).toEqual([20, 20, 20, 1])
  })

  it('MTU 247이면 한 번에 쓴다', async () => {
    const { fake, client } = make({ mtu: 247 })
    await client.connect({ authorizedDevice: fake.device })
    const before = fake.printer.writes
    await client.sendRaw(new Uint8Array(200))
    expect(fake.printer.writes - before).toBe(1)
  })

  it('끊긴 뒤 쓰면 "Channel is closed"', async () => {
    const { fake, client } = make()
    await client.connect({ authorizedDevice: fake.device })
    fake.dropLink()
    await expect(client.sendRaw(new Uint8Array(4))).rejects.toThrow('Channel is closed')
  })
})

describe('끊김', () => {
  it('프린터 쪽에서 끊기면 disconnect 사건 한 번, 연결 없음', async () => {
    const { fake, client } = make()
    await client.connect({ authorizedDevice: fake.device })
    let events = 0
    client.on('disconnect', () => events++)
    fake.dropLink()
    fake.dropLink()
    expect(events).toBe(1)
    expect(client.isConnected()).toBe(false)
    expect(client.device).toBeNull()
  })

  it('앱이 끊으면 전송도 끊기고 심박이 멈춘다; 다시 이으면 새 연결', async () => {
    const { fake, client } = make()
    await client.connect({ authorizedDevice: fake.device })
    await client.disconnect()
    expect(fake.connected).toBe(false)
    expect(client.isHeartbeatStarted()).toBe(true) // niimbluelib: 타이머 없음 = true
    await client.connect({ authorizedDevice: fake.device })
    expect(fake.connectCount).toBe(2)
    expect(client.isConnected()).toBe(true)
  })
})
