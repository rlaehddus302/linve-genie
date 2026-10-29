// NIIMBOT 클라이언트의 네이티브 BLE 판 (APP-03) — niimbluelib NiimbotAbstractClient를 BleTransport 위에서 구현한다.
// 패킷 만들기·파싱·협상·인쇄 작업(B1)은 niimbluelib 그대로(NiimbotBluetoothClient와 같은 코드 길), 바뀐 것은 쓰기·알림의 길뿐이다:
// - 알맞은 특성 = notify + writeWithoutResponse (Web Bluetooth 판과 같은 고르기)
// - 쓰기는 MTU − 3 바이트 조각으로 차례로(Web Bluetooth는 운영체제가 나누던 것을 여기서 한다)
// - connect({ authorizedDevice }) 모양을 그대로 받아 @livejjim/printer createNiimbotAdapter의 createClient 자리에 들어간다
import { ConnectResult, NiimbotAbstractClient, Utils, type ConnectionInfo, type NiimbotClientType } from '@mmote/niimbluelib'
import { splitForMtu } from './chunk.ts'
import type { BleCharacteristicInfo, BleDeviceInfo, BleLink, BleTransport } from './transport.ts'
import { BLE_REQUEST_MTU } from './transport.ts'

/** niimbluelib DisconnectEvent·ConnectEvent와 같은 모양 (내보내지 않아 여기서 만든다) */
class DisconnectEvent extends Event {
  constructor() {
    super('disconnect')
  }
}
class ConnectEvent extends Event {
  readonly info: ConnectionInfo
  constructor(info: ConnectionInfo) {
    super('connect')
    this.info = info
  }
}

export interface NiimbotBleClientOptions {
  /** 패킷 사이 쉬는 시간 (niimbluelib 기본 10ms — B1 이슈 #5). 시험은 0 */
  readonly packetIntervalMs?: number
  /** 안드로이드에서 요청할 MTU (기본 247) */
  readonly requestMtu?: number
  readonly connectTimeoutMs?: number
}

/** 고른 장치가 없을 때 — 어댑터가 NOT_SELECTED로 읽는 이름 */
export class NoDeviceError extends Error {
  override readonly name = 'NotFoundError'
  constructor() {
    super('기기를 고르지 않았다')
  }
}

const isDeviceInfo = (value: unknown): value is BleDeviceInfo => typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' && (value as { id: string }).id !== ''

/** 알맞은 특성 고르기 — Web Bluetooth 판과 같다: 짧은 UUID(16비트 서비스)는 건너뛰고 notify + writeWithoutResponse */
export function pickChannel(characteristics: readonly BleCharacteristicInfo[]): BleCharacteristicInfo | undefined {
  return characteristics.find((c) => c.serviceUuid.length >= 5 && c.notify && c.writeWithoutResponse)
}

export class NiimbotBleClient extends NiimbotAbstractClient {
  private readonly transport: BleTransport
  private readonly requestMtu: number
  private readonly connectTimeoutMs: number | undefined
  private link: BleLink | null = null
  private channel: BleCharacteristicInfo | null = null
  private stopMonitor: (() => void) | null = null
  private deviceName: string | null = null

  constructor(transport: BleTransport, options: NiimbotBleClientOptions = {}) {
    super()
    this.transport = transport
    this.requestMtu = options.requestMtu ?? BLE_REQUEST_MTU
    this.connectTimeoutMs = options.connectTimeoutMs
    if (options.packetIntervalMs !== undefined) this.setPacketInterval(options.packetIntervalMs)
  }

  /** 이은 장치 (기억에 쓴다) */
  get device(): BleDeviceInfo | null {
    return this.link === null ? null : { id: this.link.id, name: this.deviceName }
  }

  override async connect(options?: { readonly authorizedDevice?: unknown }): Promise<ConnectionInfo> {
    await this.disconnect()
    const picked = options?.authorizedDevice
    if (!isDeviceInfo(picked)) throw new NoDeviceError()
    const link = await this.transport.connect(picked.id, {
      requestMtu: this.requestMtu,
      ...(this.connectTimeoutMs === undefined ? {} : { timeoutMs: this.connectTimeoutMs }),
      onDisconnect: () => this.onLinkLost(link),
    })
    let channel: BleCharacteristicInfo | undefined
    try {
      channel = pickChannel(await link.characteristics())
    } catch (error) {
      await link.disconnect().catch(() => undefined)
      throw error
    }
    if (channel === undefined) {
      await link.disconnect().catch(() => undefined)
      throw new Error('Suitable device characteristic not found')
    }
    try {
      this.stopMonitor = await link.monitor(channel.serviceUuid, channel.uuid, (bytes) => this.processRawPacket(bytes))
    } catch (error) {
      await link.disconnect().catch(() => undefined)
      throw error
    }
    this.link = link
    this.channel = channel
    this.deviceName = picked.name ?? null
    await this.negotiateAndGetPrinterInfo(() => void this.disconnect())
    const result: ConnectionInfo = {
      ...(this.deviceName === null ? {} : { deviceName: this.deviceName }),
      result: this.getPrinterInfo().connectResult ?? ConnectResult.FirmwareErrors,
    }
    this.emit('connect', new ConnectEvent(result) as never)
    return result
  }

  private onLinkLost(link: BleLink): void {
    if (this.link !== link) return
    this.clearLink()
    this.emit('disconnect', new DisconnectEvent() as never)
  }

  private clearLink(): void {
    this.stopHeartbeat()
    try {
      this.stopMonitor?.()
    } catch {
      // 이미 끊긴 알림 — 무시
    }
    this.stopMonitor = null
    this.link = null
    this.channel = null
  }

  override isConnected(): boolean {
    return this.link !== null && this.channel !== null
  }

  override async disconnect(): Promise<void> {
    const link = this.link
    this.clearLink()
    if (link !== null) await link.disconnect().catch(() => undefined)
  }

  override async sendRaw(data: Uint8Array, force?: boolean): Promise<void> {
    const send = async (): Promise<void> => {
      const link = this.link
      const channel = this.channel
      if (link === null || channel === null) throw new Error('Channel is closed')
      await Utils.sleep(this.packetIntervalMs)
      for (const chunk of splitForMtu(data, link.mtu)) {
        if (this.link !== link) throw new Error('Channel is closed')
        await link.writeWithoutResponse(channel.serviceUuid, channel.uuid, chunk)
      }
      this.emit('rawpacketsent', { data } as never)
    }
    if (force) await send()
    else await this.mutex.runExclusive(send)
  }

  override getType(): NiimbotClientType {
    return 'bluetooth'
  }
}
