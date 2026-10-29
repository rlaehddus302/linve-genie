import { useSyncExternalStore } from 'react'
import { Modal, PermissionsAndroid, Platform, ScrollView } from 'react-native'
import { BleManager } from 'react-native-ble-plx'
import { getAudioCapture } from '@livejjim/mobile-audio/native'
import { BLE_RESTORE_IDENTIFIER, createNativeB1Adapter, createPlxTransport, type BleDeviceInfo, type DevicePicker, type BleTransport } from '@livejjim/mobile-ble'
import { LiveNativeAudio } from './live-audio.ts'
import { setNativeModules } from './index.ts'
import { BigButton, Body, Card, Hint } from '../ui/parts.tsx'

let devices: readonly BleDeviceInfo[] | null = null
let finish: ((device: BleDeviceInfo | null) => void) | null = null
const listeners = new Set<() => void>()
const emit = (): void => { for (const listener of listeners) listener() }
const pickDevice: DevicePicker = async (scan) => new Promise((resolve) => {
  finish?.(null)
  devices = []; emit()
  const off = scan.onDevices((next) => { devices = next; emit() })
  finish = (device) => { off(); devices = null; finish = null; emit(); resolve(device) }
})
async function permission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const names = Number(Platform.Version) >= 31 ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
  const results = await PermissionsAndroid.requestMultiple(names)
  return names.every((name) => results[name] === PermissionsAndroid.RESULTS.GRANTED)
}
let installed = false
export function installProductionNative(): void {
  if (installed) return
  installed = true
  let transport: BleTransport
  try { transport = createPlxTransport(new BleManager({ restoreStateIdentifier: BLE_RESTORE_IDENTIFIER, restoreStateFunction: () => undefined })) }
  catch { transport = { state: async () => 'unsupported', onStateChange: () => () => undefined, scan: () => () => undefined, connect: async () => { throw new Error('블루투스가 없는 빌드예요') } } }
  const adapter = createNativeB1Adapter({ transport, pickDevice })
  const connect = adapter.connect.bind(adapter)
  const reconnect = adapter.reconnect.bind(adapter)
  const refused = { ok: false as const, error: { code: 'BLUETOOTH_OFF' as const, message: '블루투스 권한이 없어요. 설정에서 주변 기기 사용을 허용해 주세요.', action: '설정 확인' } }
  adapter.connect = async (method) => await permission() ? connect(method) : refused
  adapter.reconnect = async (method) => await permission() ? reconnect(method) : refused
  setNativeModules({ audio: new LiveNativeAudio(getAudioCapture), ble: adapter })
}
const subscribe = (cb: () => void): (() => void) => { listeners.add(cb); return () => listeners.delete(cb) }
export function PrinterDevicePicker() {
  const found = useSyncExternalStore(subscribe, () => devices)
  return <Modal visible={found !== null} onRequestClose={() => finish?.(null)} animationType="slide">
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64, gap: 12 }}><Card label="라벨 프린터 고르기">
      <Body big bold>라벨 프린터를 골라 주세요</Body>
      {found?.length === 0 ? <Hint>가까운 프린터를 찾고 있어요. 프린터 전원을 켜 주세요.</Hint> : null}
      {found?.map((device) => <BigButton key={device.id} label={device.name ?? '이름 없는 프린터'} onPress={() => finish?.(device)} />)}
      <BigButton label="닫기" onPress={() => finish?.(null)} />
    </Card></ScrollView>
  </Modal>
}
