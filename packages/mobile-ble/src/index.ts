// @livejjim/mobile-ble — 앱 블루투스 라벨 프린터 (APP-03). react-native-ble-plx 묶기는 './plx'로 따로 들여온다(여기서는 타입만).
export {
  BLE_ATT_HEADER,
  BLE_DEFAULT_MTU,
  BLE_REQUEST_MTU,
  type BleCharacteristicInfo,
  type BleConnectOptions,
  type BleDeviceInfo,
  type BleLink,
  type BleRadioState,
  type BleScanFilter,
  type BleTransport,
} from './transport.ts'
export { chunkPayloadFor, splitForMtu } from './chunk.ts'
export { decodeBase64, encodeBase64 } from './base64.ts'
export { ANDROID_BLE_RUNTIME_PERMISSIONS, BLE_PLX_PLUGIN_CONFIG, BLE_RADIO_MESSAGES, BLUETOOTH_PERMISSION_MESSAGE } from './messages.ts'
export { NiimbotBleClient, NoDeviceError, pickChannel, type NiimbotBleClientOptions } from './client.ts'
export { createNativeB1Adapter, looksLikeMarklifeName, matchesNiimbotName, type NativeB1AdapterOptions } from './adapter.ts'
export { PickCancelledError, RadioOffError, pickFromScan, type DevicePicker } from './pick.ts'
export { bleBluetoothEnvironment, createBleBluetooth, fullUuid, type BleBluetoothDevice, type BleBluetoothOptions, type ChosenDevice } from './bluetooth.ts'
export { createNativeMarklifeAdapter, matchesMarklifeName, type NativeMarklifeAdapter, type NativeMarklifeAdapterOptions } from './marklife.ts'
export { IDENTIFY_SCAN_MS, createPrinterPicker, printerKindOf, type PrinterKind, type PrinterPicker, type PrinterPickerOptions } from './picker.ts'
export { RECONNECT_DELAYS_MS, createReconnectingAdapter, type ReconnectingAdapter, type ReconnectingAdapterOptions } from './reconnect.ts'
export {
  B1_MODEL_ID,
  FAKE_B1_CHARACTERISTIC,
  FAKE_B1_SERVICE,
  createFakeB1,
  createFakeBleTransport,
  type FakeB1,
  type FakeB1Options,
  type FakeBleTransport,
  type FakeBleTransportOptions,
  type FakePrintedPage,
} from './fake.ts'
export { BLE_RESTORE_IDENTIFIER, createPlxTransport, deviceInfoOf, radioStateOf, type BleManagerLike } from './plx.ts'
