// @livejjim/mobile-audio — 앱 마이크 모듈의 JS 쪽 (APP-02). 네이티브 묶기(expo-modules-core)는 './native'로 따로 들여온다.
export {
  AUDIO_CAPTURE_STATES,
  AUDIO_CAPTURE_STATE_NAMES,
  AUDIO_CHANNELS,
  AUDIO_FRAME_BYTES,
  AUDIO_FRAME_MS,
  AUDIO_HALT_MESSAGES,
  AUDIO_HALT_REASONS,
  AUDIO_SAMPLE_RATE,
  PCM_BYTES_PER_MS,
  PCM_BYTES_PER_SAMPLE,
  type AudioCapture,
  type AudioCaptureState,
  type AudioHaltReason,
  type AudioPermission,
  type FrameListener,
  type NativeAudioModuleLike,
  type NativeEventSubscription,
  type NativeFrameEvent,
  type NativeStartOptions,
  type NativeStateEvent,
  type StartOptions,
  type StateListener,
} from './types.ts'
export { createAudioCapture, frameBytesOf, haltReasonOf } from './capture.ts'
export { decodeBase64, encodeBase64 } from './base64.ts'
export {
  ANDROID_PERMISSIONS,
  IOS_INFO_PLIST,
  LISTENING_CHANNEL_NAME,
  LISTENING_NOTIFICATION_LINE,
  LISTENING_NOTIFICATION_TEXT,
  LISTENING_NOTIFICATION_TITLE,
  MIC_PERMISSION_MESSAGE,
  NOTIFICATION_PERMISSION_MESSAGE,
} from './messages.ts'
export {
  WS_OPEN,
  createRelayConnect,
  defaultWebSocketFactory,
  tightBuffer,
  type RelayConnect,
  type RelayConnection,
  type RelayHandlers,
  type RelayOptions,
  type WebSocketFactory,
  type WebSocketLike,
} from './transport/relay.ts'
export { createAudioUplink, type AudioSink, type AudioUplink, type UplinkCounters, type UplinkOptions } from './transport/uplink.ts'
