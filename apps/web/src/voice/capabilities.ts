/** 동의창보다 먼저 지원 여부만 본다. 인식 객체나 마이크는 만들지 않는다. */
export function supportsVoiceCapture(engine: 'chrome' | 'livegenie', scope: object = globalThis): boolean {
  const value = scope as {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
    navigator?: { mediaDevices?: { getUserMedia?: unknown } }
    AudioContext?: unknown
    webkitAudioContext?: unknown
    AudioWorkletNode?: unknown
  }
  if (engine === 'chrome') return typeof value.SpeechRecognition === 'function' || typeof value.webkitSpeechRecognition === 'function'
  return typeof value.navigator?.mediaDevices?.getUserMedia === 'function' && typeof value.AudioWorkletNode === 'function' && (typeof value.AudioContext === 'function' || typeof value.webkitAudioContext === 'function')
}
