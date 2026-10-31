/**
 * 동의창보다 먼저 지원 여부만 본다. 마이크나 소리 처리 객체는 만들지 않는다.
 * SRV1 (D-APP-22): 받아쓰기는 언제나 서버다 — 마이크 소리를 보낼 수 있는지(마이크·AudioWorklet)만 본다. 브라우저 음성 인식은 보지 않는다.
 */
export function supportsVoiceCapture(scope: object = globalThis): boolean {
  const value = scope as {
    navigator?: { mediaDevices?: { getUserMedia?: unknown } }
    AudioContext?: unknown
    webkitAudioContext?: unknown
    AudioWorkletNode?: unknown
  }
  return typeof value.navigator?.mediaDevices?.getUserMedia === 'function' && typeof value.AudioWorkletNode === 'function' && (typeof value.AudioContext === 'function' || typeof value.webkitAudioContext === 'function')
}
