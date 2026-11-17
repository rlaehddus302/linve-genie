// 앱 시작 때 실제 네이티브 모듈을 잇는다 (APP-03, LABEL_RULES L-7·L-11 8·L-11 15).
// 프린터 = 한 목록 고르기(createPrinterPicker, 계열 표) → 저절로 다시 잇기(createReconnectingAdapter, L-11 8 정책) → 앱 프린터(블루투스·시험용 프린터).
// - 켜는 계열: 켠 프로필 표 전부(defaultPrinterFamilies — NIIMBOT·Marklife·바우아토, PRN2 D-PRN2-01·08). 숨김 스위치는 없다 —
//   실험 기종은 고르기 목록에서 "실험", 연결 뒤 이름 뒤 "(실험)"과 안내 한 줄로 보인다(L-7 지원 단계, 웹과 같은 기준).
// - 기억한 프린터는 앱 저장소(AsyncStorage)에 ID만 둔다 — 서버로 보내지 않는다. 앱을 다시 켜면 "다시 연결"이 고르기 창 없이 잇는다.
// - 시험용 프린터는 L-7 가짜 프린터다. 서버가 시험 모드일 때 화면이 고를 때만 만든다(운영 서버에서는 고를 수 없다).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { labelPaper } from '../lib/label-paper.ts'
import { wireDockChoice } from '../lib/dock-choice.ts'
import { wireFeedView } from '../lib/feed-view.ts'
import { wireRecentSearches } from '../lib/recent-searches.ts'
import { getInk } from '@livejjim/mobile-ink/native'
import { wireInkReader } from '../lib/ink-reader.ts'
import { AppState, Modal, PermissionsAndroid, Platform, ScrollView } from 'react-native'
import { BleManager } from 'react-native-ble-plx'
import { getAudioCapture } from '@livejjim/mobile-audio/native'
import { getNoticeIntake, requestNoticeContacts } from '@livejjim/mobile-notice/native'
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
import { diag, diagBegin, diagFlush, diagManager } from './printer-diag.ts'
import { linkFacts, noteAppState } from './link-facts.ts'
import { setNoticeModule } from './notice.ts'
import { setErrorHaptic, setHaptic } from './haptics.ts'
import * as Haptics from 'expo-haptics'
import { hasStringAsync } from 'expo-clipboard'
import { setClipboardProbe } from '../lib/clipboard.ts'
import { BlurView } from 'expo-blur'
import { setTabBarBackdrop } from '../ui/kit/app.tsx'

async function permission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const names = Number(Platform.Version) >= 31 ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
  const results = await PermissionsAndroid.requestMultiple(names)
  // 프린터 연결 단계 기록 (D-PRN-DIAG): 권한마다 결과 (granted · denied · never_ask_again)
  for (const name of names) diag(`perm_${name.split('.').pop() ?? 'x'}_${String(results[name])}`)
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
  // 잘못 넣었을 때 오류 진동 (D-UX3-51)
  setErrorHaptic(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error))
  // 클립보드는 글이 있는지만 본다(창 없음). [붙여넣기]는 모든 기기에서 [링크를 모르겠어요]와 같은 회색 칩 —
  // 아이폰 기본 붙여넣기 단추는 글자 크기·글꼴을 바꿀 수 없어 칩과 똑같이 만들 수 없다 (D-UX4-115)
  setClipboardProbe(() => hasStringAsync())
  // 아래 탭 뒤 흐림 (D-UX3-13): 아이폰만 — 안드로이드 흐림은 느려 반투명 흰색만 둔다
  if (Platform.OS === 'ios') setTabBarBackdrop(TabBarBlur)
  let transport: BleTransport
  let managerFailed = false
  try {
    // 프린터 연결 단계 기록 (D-PRN-DIAG): 관리자를 감싸 찾기·연결 결과와 오류 번호를 모은다
    transport = createPlxTransport(diagManager(new BleManager({ restoreStateIdentifier: BLE_RESTORE_IDENTIFIER, restoreStateFunction: () => undefined })))
  } catch {
    managerFailed = true
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
  // 연결 시도마다 기기 정보·권한·단계를 모아 끝나면 서버로 보낸다 (D-PRN-DIAG)
  const traced =
    (name: string, run: typeof connect) =>
    async (method: Parameters<typeof connect>[0]) => {
      diagBegin(`try_${name}`)
      diag(`os_${Platform.OS}`, Number(Platform.Version))
      const model = (Platform.constants as { Model?: unknown }).Model
      if (typeof model === 'string') diag(`model_${model}`)
      if (managerFailed) diag('ble_manager_failed')
      try {
        const result = (await permission()) ? await run(method) : refused
        diagFlush(result.ok ? 'result_ok' : `result_${result.error.code}`)
        return result
      } catch (error) {
        diagFlush(`result_throw_${error instanceof Error ? error.name : typeof error}`)
        throw error
      }
    }
  chooser.connect = traced('connect', connect)
  chooser.reconnect = traced('reconnect', reconnect)
  const device = createReconnectingAdapter(chooser, AUTO_RECONNECT_POLICY)
  // 출력이 실패한 까닭 기록 (F2-2, D-RETRO-43): 앱이 앞에서 벗어난 때를 적어 두고, 실패하면 그때의 블루투스 상태와 함께 읽는다
  noteAppState(AppState.currentState)
  AppState.addEventListener('change', (state) => noteAppState(state))
  const printer = new AppPrinter({
    device,
    createTest: () => createReconnectingAdapter(createFakePrinter({ methods: ['bluetooth'] }), AUTO_RECONNECT_POLICY),
    facts: async () => linkFacts(await transport.state()),
  })
  labelPaper.storage = AsyncStorage
  void wirePrinterMemory(device, (value) => printer.restoreDeviceMemory(value), AsyncStorage)
  // 방송 화면 아래 창 고르기 (D-UX4-71) — 이 휴대폰에만
  void wireDockChoice(AsyncStorage)
  // 찜 기록 정렬·글자 크기 (D-RETRO-51·52, 번호별 보기는 D-UX4-151로 걷음) — 이 휴대폰에만
  void wireFeedView(AsyncStorage)
  // 라이브 찾기 최근 검색어 (D-SEARCH-RECENT-01) — 이 휴대폰에만
  void wireRecentSearches(AsyncStorage)
  // 품종 손글씨 읽기 (D-HANDWRITE-02) — 휴대폰 안에서만 읽는다. 모듈이 없는 옛 빌드는 null: [손글씨] 단추를 숨긴다
  wireInkReader(getInk())
  setNativeModules({ audio: new LiveNativeAudio(getAudioCapture), ble: printer })
  // 휴대폰 알림 받기 (SMS3 AC-SMS3-29) — 모듈이 없는 빌드(Expo Go·웹)는 null: 설정 칸이 "쓸 수 없어요"
  // 알림 받기를 뺀 빌드(LIVEGENIE_NOTICE=off)는 매니페스트에 서비스가 없으므로 끼우지 않는다
  // 문자 직접 받기를 뺀 빌드(LIVEGENIE_SMS가 on이 아님, SMS4)는 문자 연동을 떼어 "문자 연동" 칸을 숨긴다
  const intake = phoneNoticeBuilt() ? getNoticeIntake() : null
  if (intake === null) {
    setNoticeModule(null)
    return
  }
  // 연락처에 저장한 손님은 문자 알림·단축어에 번호 대신 이름만 온다 → 서버가 찜으로 넣지 못한다(R-26 번호 없음).
  // 문자 받기를 켤 때, 그리고 이미 켜 둔 휴대폰은 앱을 열 때 연락처 접근을 한 번 묻는다 — 이름을 그 손님 휴대폰 번호로 바꾸는 데만 쓴다 (D-SMS-CONTACT)
  const askContacts = async (): Promise<void> => {
    try {
      if (Platform.OS === 'android') await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS)
      else await requestNoticeContacts()
    } catch {
      // 묻지 못해도 문자 받기는 그대로 (이름만 온 문자는 확인 필요 카드)
    }
  }
  const start = intake.start.bind(intake)
  const port = { ...intake, start: async () => { await askContacts(); return start() } }
  void intake.getState().then((state) => (state.enabled ? askContacts() : undefined), () => undefined)
  setNoticeModule(phoneSmsBuilt() ? port : { ...port, sms: null })
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
