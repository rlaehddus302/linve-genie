// 브라우저 안에서 도는 init 스크립트 둘 (addInitScript로 넣는다). 브라우저 전역은 globalThis로만 쓴다(Node 린트 범위).

/**
 * 녹음: 진짜 SpeechRecognition을 감싸 모든 이벤트·호출을 시각과 함께 __replayRecord 바인딩으로 보낸다.
 * 화면은 그대로 진짜 인식 객체를 쓴다(감싼 하위 클래스). 처음 켤 때 안내 창은 미리 확인해 둔다.
 */
export function captureSpeech() {
  const g = globalThis
  try {
    g.localStorage.setItem('livejjim.voiceConsent', 'yes')
    // PC 화면 기본 엔진은 서버 받아쓰기(APP1) — 재생·녹음은 크롬 인식 객체를 쓰므로 크롬을 고른다(apps/web/src/voice/remote.ts VOICE_ENGINE_KEY)
    g.localStorage.setItem('livejjim.voiceEngine', 'chrome')
  } catch {
    // about:blank
  }
  const Native = g.SpeechRecognition ?? g.webkitSpeechRecognition
  if (typeof Native !== 'function' || g.__replayWrapped === true) return
  g.__replayWrapped = true
  let count = 0
  const send = (line) => {
    try {
      const p = g.__replayRecord?.(line)
      if (p !== undefined && typeof p.catch === 'function') p.catch(() => {})
    } catch {
      // 바인딩이 없으면 버린다
    }
  }
  const results = (list) => Array.from(list ?? [], (r) => ({ f: r.isFinal === true, alts: Array.from(r, (a) => [a.transcript, a.confidence]) }))
  class Wrapped extends Native {
    constructor() {
      super()
      const rec = ++count
      this.__rec = rec
      send({ type: 'create', rec, t: Date.now() })
      for (const ev of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'end', 'nomatch']) {
        this.addEventListener(ev, () => send({ type: 'event', ev, rec, t: Date.now() }))
      }
      this.addEventListener('result', (e) => send({ type: 'event', ev: 'result', rec, t: Date.now(), resultIndex: e.resultIndex, results: results(e.results) }))
      this.addEventListener('error', (e) => send({ type: 'event', ev: 'error', rec, t: Date.now(), error: e.error, message: e.message ?? '' }))
    }
    start() {
      send({ type: 'call', fn: 'start', rec: this.__rec, t: Date.now(), lang: this.lang, continuous: this.continuous, interimResults: this.interimResults })
      return super.start()
    }
    stop() {
      send({ type: 'call', fn: 'stop', rec: this.__rec, t: Date.now() })
      return super.stop()
    }
    abort() {
      send({ type: 'call', fn: 'abort', rec: this.__rec, t: Date.now() })
      return super.abort()
    }
  }
  g.SpeechRecognition = Wrapped
  g.webkitSpeechRecognition = Wrapped
}

/**
 * 재생: 가짜 SpeechRecognition. Node가 __replay.dispatch(k, 이벤트)로 k번째(만든 차례, 0부터) 인식 객체에 녹음된 이벤트를 그대로 낸다.
 * 결과 목록 모양은 크롬과 같다(results[i].isFinal, results[i][0].transcript, length, item()).
 */
export function fakeSpeech() {
  const g = globalThis
  try {
    g.localStorage.setItem('livejjim.voiceConsent', 'yes')
    // PC 화면 기본 엔진은 서버 받아쓰기(APP1) — 재생·녹음은 크롬 인식 객체를 쓰므로 크롬을 고른다(apps/web/src/voice/remote.ts VOICE_ENGINE_KEY)
    g.localStorage.setItem('livejjim.voiceEngine', 'chrome')
  } catch {
    // about:blank
  }
  const state = { instances: [], calls: [] }
  g.__replay = state
  const list = (items) => {
    const out = items.map((x) => x)
    out.item = (i) => out[i] ?? null
    return out
  }
  class FakeRecognition extends EventTarget {
    constructor() {
      super()
      this.lang = ''
      this.continuous = false
      this.interimResults = false
      this.maxAlternatives = 1
      for (const ev of ['result', 'error', 'end', 'start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']) this[`on${ev}`] = null
      this.index = state.instances.length
      state.instances.push(this)
    }
    start() {
      state.calls.push([this.index, 'start'])
    }
    stop() {
      state.calls.push([this.index, 'stop'])
    }
    abort() {
      state.calls.push([this.index, 'abort'])
    }
  }
  state.dispatch = (k, line) => {
    const rec = state.instances[k]
    if (rec === undefined) return 'missing'
    let event
    if (line.ev === 'result') {
      const results = list(
        line.results.map((r) => {
          const alts = list(r.alts.map(([transcript, confidence]) => ({ transcript, confidence })))
          alts.isFinal = r.f
          return alts
        }),
      )
      event = { type: 'result', resultIndex: line.resultIndex, results }
    } else if (line.ev === 'error') event = { type: 'error', error: line.error, message: line.message ?? '' }
    else event = { type: line.ev }
    const handler = rec[`on${line.ev}`]
    if (typeof handler === 'function') handler.call(rec, event)
    return 'ok'
  }
  state.count = () => state.instances.length
  g.SpeechRecognition = FakeRecognition
  g.webkitSpeechRecognition = FakeRecognition
}
