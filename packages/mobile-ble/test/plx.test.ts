// react-native-ble-plx 묶기 — 가짜 BleManager로: 상태 이름, 찾기 거르기(이름·서비스), 연결·MTU·특성·알림(base64)·쓰기(base64)·끊김 한 번.
import type { BleError, Characteristic, Device, Service, State } from 'react-native-ble-plx'
import { describe, expect, it } from 'vitest'
import { BLE_DEFAULT_MTU, createPlxTransport, decodeBase64, encodeBase64, radioStateOf, type BleManagerLike } from '../src/index.ts'

type ScanListener = (error: BleError | null, device: Device | null) => void
type MonitorListener = (error: BleError | null, characteristic: Characteristic | null) => void

function fakeManager(options: { mtu?: number; state?: string } = {}) {
  const log: string[] = []
  let scanListener: ScanListener | null = null
  let disconnectListener: (() => void) | null = null
  let monitorListener: MonitorListener | null = null
  const writes: { service: string; characteristic: string; bytes: Uint8Array }[] = []
  const manager: BleManagerLike & { emitDevice(d: Partial<Device>): void; emitDisconnect(): void; emitValue(bytes: Uint8Array): void; readonly writes: typeof writes; readonly log: string[] } = {
    log,
    writes,
    state: async () => (options.state ?? 'PoweredOn') as State,
    onStateChange(listener, emitCurrent) {
      log.push(`onStateChange:${String(emitCurrent)}`)
      listener('PoweredOff' as State)
      return { remove: () => log.push('stateSub.remove') }
    },
    async startDeviceScan(uuids, scanOptions, listener) {
      log.push(`scan:${String(uuids)}:${JSON.stringify(scanOptions)}`)
      scanListener = listener
    },
    async stopDeviceScan() {
      log.push('stopScan')
      scanListener = null
    },
    async connectToDevice(id, connectOptions) {
      log.push(`connect:${id}:${JSON.stringify(connectOptions)}`)
      return { id, mtu: options.mtu ?? 0 } as Device
    },
    async cancelDeviceConnection(id) {
      log.push(`cancel:${id}`)
      return { id } as Device
    },
    onDeviceDisconnected(_id, listener) {
      disconnectListener = () => listener(null, null)
      return { remove: () => log.push('lostSub.remove') }
    },
    async discoverAllServicesAndCharacteristicsForDevice(id) {
      log.push(`discover:${id}`)
      return { id } as Device
    },
    async servicesForDevice() {
      return [{ uuid: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2' } as Service, { uuid: '00001800-0000-1000-8000-00805f9b34fb' } as Service]
    },
    async characteristicsForDevice(_id, serviceUUID) {
      if (serviceUUID.startsWith('e7810a71')) {
        return [{ uuid: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', isNotifiable: true, isWritableWithoutResponse: true } as Characteristic]
      }
      return [{ uuid: '2a00', isNotifiable: false, isWritableWithoutResponse: false } as Characteristic]
    },
    monitorCharacteristicForDevice(_id, _service, _characteristic, listener) {
      monitorListener = listener
      return { remove: () => log.push('monitor.remove') }
    },
    async writeCharacteristicWithoutResponseForDevice(_id, service, characteristic, base64Value) {
      writes.push({ service, characteristic, bytes: decodeBase64(base64Value)! })
      return {} as Characteristic
    },
    async writeCharacteristicWithResponseForDevice(_id, service, characteristic, base64Value) {
      log.push(`writeWithResponse:${characteristic}`)
      writes.push({ service, characteristic, bytes: decodeBase64(base64Value)! })
      return {} as Characteristic
    },
    emitDevice(d) {
      scanListener?.(null, d as Device)
    },
    emitDisconnect() {
      disconnectListener?.()
    },
    emitValue(bytes) {
      monitorListener?.(null, { value: encodeBase64(bytes) } as Characteristic)
    },
  }
  return manager
}

describe('radioStateOf', () => {
  it('ble-plx 상태 이름 → 장치 상태', () => {
    expect(radioStateOf('PoweredOn')).toBe('on')
    expect(radioStateOf('PoweredOff')).toBe('off')
    expect(radioStateOf('Unauthorized')).toBe('unauthorized')
    expect(radioStateOf('Unsupported')).toBe('unsupported')
    expect(radioStateOf('Resetting')).toBe('unknown')
    expect(radioStateOf('Unknown')).toBe('unknown')
  })
})

describe('createPlxTransport', () => {
  it('state·onStateChange', async () => {
    const manager = fakeManager({ state: 'PoweredOff' })
    const transport = createPlxTransport(manager)
    expect(await transport.state()).toBe('off')
    const seen: string[] = []
    const stop = transport.onStateChange((s) => seen.push(s))
    stop()
    expect(seen).toEqual(['off'])
    expect(manager.log).toContain('stateSub.remove')
  })

  it('찾기: 모두 받아 이름 앞자리 또는 서비스로 거르고, 같은 장치는 한 번, 멈추면 stopDeviceScan', () => {
    const manager = fakeManager()
    const transport = createPlxTransport(manager)
    const found: { id: string; name: string | null }[] = []
    const stop = transport.scan({ namePrefixes: ['B', 'D'], serviceUuids: ['e7810a71-73ae-499d-8c15-faa9aef0c3f2'] }, (d) => found.push(d))
    manager.emitDevice({ id: '1', name: 'B1-G1', localName: null, serviceUUIDs: null })
    manager.emitDevice({ id: '1', name: 'B1-G1', localName: null, serviceUUIDs: null })
    manager.emitDevice({ id: '2', name: null, localName: null, serviceUUIDs: ['E7810A71-73AE-499D-8C15-FAA9AEF0C3F2'] })
    manager.emitDevice({ id: '3', name: 'P50_X', localName: null, serviceUUIDs: null })
    manager.emitDevice({ id: '4', name: null, localName: 'd110', serviceUUIDs: null })
    expect(found).toEqual([
      { id: '1', name: 'B1-G1' },
      { id: '2', name: null },
      { id: '4', name: 'd110' },
    ])
    expect(manager.log[0]).toBe('scan:null:{"allowDuplicates":false}')
    stop()
    expect(manager.log).toContain('stopScan')
  })

  it('찾기 matchCase: 이름 앞자리를 대소문자까지 본다(L-12 3), 이름은 광고의 이름(localName)을 먼저', () => {
    const manager = fakeManager()
    const transport = createPlxTransport(manager)
    const found: { id: string; name: string | null }[] = []
    const stop = transport.scan({ namePrefixes: ['P12_'], matchCase: true }, (d) => found.push(d))
    manager.emitDevice({ id: '1', name: null, localName: 'P12_A', serviceUUIDs: null })
    manager.emitDevice({ id: '2', name: null, localName: 'p12_b', serviceUUIDs: null })
    manager.emitDevice({ id: '3', name: 'P12_OLD', localName: 'X9', serviceUUIDs: null })
    manager.emitDevice({ id: '4', name: 'P12_C', localName: '', serviceUUIDs: null })
    stop()
    expect(found).toEqual([
      { id: '1', name: 'P12_A' },
      { id: '4', name: 'P12_C' },
    ])
  })

  it('응답 있는 쓰기는 writeCharacteristicWithResponseForDevice(base64), 특성의 응답 있는 쓰기 여부를 알린다', async () => {
    const manager = fakeManager()
    const transport = createPlxTransport(manager)
    const link = await transport.connect('AA:BB', { onDisconnect: () => undefined })
    await link.writeWithResponse('ff00', 'ff02', Uint8Array.of(1, 2, 3))
    expect(manager.log).toContain('writeWithResponse:ff02')
    expect([...(manager.writes.at(-1)?.bytes ?? [])]).toEqual([1, 2, 3])
  })

  it('연결: requestMTU·timeout 넘김, 서비스·특성 모으기, 알림은 base64 → 바이트, 쓰기는 base64, MTU는 장치 값(이상하면 23)', async () => {
    const manager = fakeManager({ mtu: 185 })
    const transport = createPlxTransport(manager)
    let dropped = 0
    const link = await transport.connect('AA:BB', { requestMtu: 247, timeoutMs: 5_000, onDisconnect: () => dropped++ })
    expect(manager.log).toContain('connect:AA:BB:{"requestMTU":247,"timeout":5000}')
    expect(manager.log).toContain('discover:AA:BB')
    expect(link.mtu).toBe(185)
    const characteristics = await link.characteristics()
    expect(characteristics).toEqual([
      { serviceUuid: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', uuid: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', notify: true, writeWithoutResponse: true },
      { serviceUuid: '00001800-0000-1000-8000-00805f9b34fb', uuid: '2a00', notify: false, writeWithoutResponse: false },
    ])
    const got: Uint8Array[] = []
    const stop = await link.monitor('s', 'c', (bytes) => got.push(bytes))
    manager.emitValue(new Uint8Array([0x55, 0x55, 0xc2, 0x01, 0x02, 0xc1, 0xaa, 0xaa]))
    expect(got).toEqual([new Uint8Array([0x55, 0x55, 0xc2, 0x01, 0x02, 0xc1, 0xaa, 0xaa])])
    await link.writeWithoutResponse('s', 'c', new Uint8Array([1, 2, 3]))
    expect(manager.writes).toEqual([{ service: 's', characteristic: 'c', bytes: new Uint8Array([1, 2, 3]) }])
    stop()
    expect(manager.log).toContain('monitor.remove')
    manager.emitDisconnect()
    manager.emitDisconnect()
    expect(dropped).toBe(1)
    const noMtu = await createPlxTransport(fakeManager({ mtu: 0 })).connect('X', { onDisconnect: () => undefined })
    expect(noMtu.mtu).toBe(BLE_DEFAULT_MTU)
  })

  it('앱이 끊으면 cancelDeviceConnection, 그 뒤 끊김 알림은 없다', async () => {
    const manager = fakeManager()
    const transport = createPlxTransport(manager)
    let dropped = 0
    const link = await transport.connect('AA:BB', { onDisconnect: () => dropped++ })
    await link.disconnect()
    expect(manager.log).toContain('cancel:AA:BB')
    expect(manager.log).toContain('lostSub.remove')
    manager.emitDisconnect()
    expect(dropped).toBe(0)
  })
})
