// 앱 시작 때 실제 네이티브 모듈을 잇는다 (APP-03, LABEL_RULES L-7·L-11 8·L-11 15).
// 프린터 = 한 목록 고르기(createPrinterPicker, 계열 표) → 저절로 다시 잇기(createReconnectingAdapter, L-11 8 정책) → 앱 프린터(블루투스·시험용 프린터).
// - 켜는 계열: 기본은 실험이 아닌 계열(B1)만. 실험 계열(Marklife)은 빌드 때 EXPO_PUBLIC_PRINTER_EXPERIMENTAL=1일 때만(숨김 스위치 — 스펙 결정 전까지,
//   L-7 "L-12의 다른 프린터를 검증 없이 지원 표시하지 않는다").
// - 기억한 프린터는 앱 저장소(AsyncStorage)에 ID만 둔다 — 서버로 보내지 않는다. 앱을 다시 켜면 "다시 연결"이 고르기 창 없이 잇는다.
// - 시험용 프린터는 L-7 가짜 프린터다. 서버가 시험 모드일 때 화면이 고를 때만 만든다(운영 서버에서는 고를 수 없다).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSyncExternalStore } from 'react'
import { Modal, PermissionsAndroid, Platform, ScrollView } from 'react-native'
import { BleManager } from 'react-native-ble-plx'
import { getAudioCapture } from '@livejjim/mobile-audio/native'
import {
  AUTO_RECONNECT_POLICY,
  BLE_RESTORE_IDENTIFIER,
  createPlxTransport,
  createPrinterPicker,
  createReconnectingAdapter,
  enabledFamilies,
  marklifeFamily,
  niimbotFamily,
  type BleDeviceInfo,
  type BleTransport,
  type DevicePicker,
  type PickEntry,
  type PrinterPicker,
} from '@livejjim/mobile-ble'
import { createFakePrinter } from '@livejjim/printer'
import { wirePrinterMemory } from '../lib/printer-memory.ts'
import { PrinterPickList } from '../screens/PrinterPickList.tsx'
import { AppPrinter } from './app-printer.ts'
import { LiveNativeAudio } from './live-audio.ts'
import { setNativeModules } from './index.ts'

/** 실험 계열 숨김 스위치 (빌드 때 정한다 — 화면에는 켜는 곳이 없다) */
const SHOW_EXPERIMENTAL_PRINTERS = process.env.EXPO_PUBLIC_PRINTER_EXPERIMENTAL === '1'

let picker: PrinterPicker | null = null
let entries: readonly PickEntry[] | null = null
let finish: ((device: BleDeviceInfo | null) => void) | null = null
const listeners = new Set<() => void>()
const emit = (): void => {
  for (const listener of listeners) listener()
}
const pickDevice: DevicePicker = async (scan) =>
  new Promise((resolve) => {
    finish?.(null)
    entries = []
    emit()
    const off = scan.onDevices((next) => {
      entries = picker === null ? [] : picker.entries(next)
      emit()
    })
    finish = (device) => {
      off()
      entries = null
      finish = null
      emit()
      resolve(device)
    }
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
  try {
    transport = createPlxTransport(new BleManager({ restoreStateIdentifier: BLE_RESTORE_IDENTIFIER, restoreStateFunction: () => undefined }))
  } catch {
    transport = {
      state: async () => 'unsupported',
      onStateChange: () => () => undefined,
      scan: () => () => undefined,
      connect: async () => {
        throw new Error('블루투스가 없는 빌드예요')
      },
    }
  }
  const families = enabledFamilies([marklifeFamily(), niimbotFamily()], SHOW_EXPERIMENTAL_PRINTERS)
  const chooser = createPrinterPicker({ transport, pickDevice, families })
  picker = chooser
  const connect = chooser.connect.bind(chooser)
  const reconnect = chooser.reconnect.bind(chooser)
  const refused = { ok: false as const, error: { code: 'BLUETOOTH_OFF' as const, message: '블루투스 권한이 없어요. 설정에서 주변 기기 사용을 허용해 주세요.', action: '설정 확인' } }
  chooser.connect = async (method) => ((await permission()) ? connect(method) : refused)
  chooser.reconnect = async (method) => ((await permission()) ? reconnect(method) : refused)
  const device = createReconnectingAdapter(chooser, AUTO_RECONNECT_POLICY)
  const printer = new AppPrinter({
    device,
    createTest: () => createReconnectingAdapter(createFakePrinter({ methods: ['bluetooth'] }), AUTO_RECONNECT_POLICY),
  })
  void wirePrinterMemory(device, (value) => printer.restoreDeviceMemory(value), AsyncStorage)
  setNativeModules({ audio: new LiveNativeAudio(getAudioCapture), ble: printer })
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function PrinterDevicePicker() {
  const shown = useSyncExternalStore(subscribe, () => entries)
  return (
    <Modal visible={shown !== null} onRequestClose={() => finish?.(null)} animationType="slide">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64, gap: 12 }}>
        <PrinterPickList entries={shown ?? []} onPick={(entry) => finish?.(entry.device)} onClose={() => finish?.(null)} />
      </ScrollView>
    </Modal>
  )
}
