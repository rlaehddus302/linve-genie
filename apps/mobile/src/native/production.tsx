// 앱 시작 때 실제 네이티브 모듈을 잇는다 (APP-03, LABEL_RULES L-7·L-11 8·L-11 15).
// 프린터 = 한 목록 고르기(createPrinterPicker, 계열 표) → 저절로 다시 잇기(createReconnectingAdapter, L-11 8 정책) → 앱 프린터(블루투스·시험용 프린터).
// - 켜는 계열: 켠 프로필 표 전부(defaultPrinterFamilies — NIIMBOT·Marklife·바우아토, PRN2 D-PRN2-01·08). 숨김 스위치는 없다 —
//   실험 기종은 고르기 목록에서 "실험", 연결 뒤 이름 뒤 "(실험)"과 안내 한 줄로 보인다(L-7 지원 단계, 웹과 같은 기준).
// - 기억한 프린터는 앱 저장소(AsyncStorage)에 ID만 둔다 — 서버로 보내지 않는다. 앱을 다시 켜면 "다시 연결"이 고르기 창 없이 잇는다.
// - 시험용 프린터는 L-7 가짜 프린터다. 서버가 시험 모드일 때 화면이 고를 때만 만든다(운영 서버에서는 고를 수 없다).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Modal, PermissionsAndroid, Platform, ScrollView } from 'react-native'
import { BleManager } from 'react-native-ble-plx'
import { getAudioCapture } from '@livejjim/mobile-audio/native'
import { getNoticeIntake } from '@livejjim/mobile-notice/native'
import {
  AUTO_RECONNECT_POLICY,
  BLE_RESTORE_IDENTIFIER,
  createPlxTransport,
  createPrinterPicker,
  createReconnectingAdapter,
  type BleTransport,
} from '@livejjim/mobile-ble'
import { createFakePrinter } from '@livejjim/printer'
import { phoneNoticeBuilt, phoneSmsBuilt } from '../lib/build-flags.ts'
import { wirePrinterMemory } from '../lib/printer-memory.ts'
import { PrinterPickList } from '../screens/PrinterPickList.tsx'
import { cancelPrinterPick, pickDevice, pickPrinter, setPickEntries, usePickWindowShown } from './printer-pick.ts'
import { AppPrinter } from './app-printer.ts'
import { LiveNativeAudio } from './live-audio.ts'
import { setNativeModules } from './index.ts'
import { setNoticeModule } from './notice.ts'
import { setHaptic } from './haptics.ts'
import * as Haptics from 'expo-haptics'
import { ClipboardPasteButton, hasStringAsync, isPasteButtonAvailable } from 'expo-clipboard'
import { setClipboardProbe } from '../lib/clipboard.ts'
import { setPasteControl, type PasteControlProps } from './paste.tsx'
import { useKit } from '../ui/kit/theme.tsx'
import { BlurView } from 'expo-blur'
import { setTabBarBackdrop } from '../ui/kit/app.tsx'

/** 아이폰 기본 붙여넣기 단추 — 누르는 것 자체가 허락이라 "붙여넣기 허용" 창이 뜨지 않는다 (D-UX3-11) */
function NativePasteButton({ onPaste }: PasteControlProps) {
  const { p } = useKit()
  return (
    <ClipboardPasteButton
      onPress={(data) => {
        if (data.type === 'text') onPaste(data.text)
      }}
      acceptedContentTypes={['plain-text', 'url']}
      displayMode="labelOnly"
      cornerStyle="medium"
      backgroundColor={p.soft}
      foregroundColor={p.text}
      style={{ height: 36, width: 92 }}
    />
  )
}

async function permission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const names = Number(Platform.Version) >= 31 ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
  const results = await PermissionsAndroid.requestMultiple(names)
  return names.every((name) => results[name] === PermissionsAndroid.RESULTS.GRANTED)
}

function TabBarBlur() {
  return <BlurView tint="light" intensity={30} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
}

let installed = false
export function installProductionNative(): void {
  if (installed) return
  installed = true
  // 아래 탭 손맛 (D-UX3-07)
  setHaptic(() => void Haptics.selectionAsync())
  // 클립보드는 글이 있는지만 본다(창 없음). 아이폰 16 이상은 기본 붙여넣기 단추
  setClipboardProbe(() => hasStringAsync())
  if (Platform.OS === 'ios' && isPasteButtonAvailable) setPasteControl(NativePasteButton)
  // 아래 탭 뒤 흐림 (D-UX3-13): 아이폰만 — 안드로이드 흐림은 느려 반투명 흰색만 둔다
  if (Platform.OS === 'ios') setTabBarBackdrop(TabBarBlur)
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
  // 계열 표는 기본(켠 프로필 표 전부 — 앱·웹 같은 고르기 목록, L-7)
  const chooser = createPrinterPicker({ transport, pickDevice })
  setPickEntries((devices) => chooser.entries(devices))
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
  // 휴대폰 알림 받기 (SMS3 AC-SMS3-29) — 모듈이 없는 빌드(Expo Go·웹)는 null: 설정 칸이 "쓸 수 없어요"
  // 알림 받기를 뺀 빌드(LIVEGENIE_NOTICE=off)는 매니페스트에 서비스가 없으므로 끼우지 않는다
  // 문자 직접 받기를 뺀 빌드(LIVEGENIE_SMS가 on이 아님, SMS4)는 문자 연동을 떼어 "문자 연동" 칸을 숨긴다
  const intake = phoneNoticeBuilt() ? getNoticeIntake() : null
  setNoticeModule(intake === null ? null : phoneSmsBuilt() ? intake : { ...intake, sms: null })
}

/** 앱 위 고르기 창 — 목록을 직접 그리는 화면(라벨 단계 연결, D-UX4-04)이 떠 있으면 띄우지 않는다 */
export function PrinterDevicePicker() {
  const shown = usePickWindowShown()
  return (
    <Modal visible={shown !== null} onRequestClose={cancelPrinterPick} animationType="slide">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64, gap: 12 }}>
        <PrinterPickList entries={shown ?? []} onPick={(entry) => pickPrinter(entry.device)} onClose={cancelPrinterPick} />
      </ScrollView>
    </Modal>
  )
}
