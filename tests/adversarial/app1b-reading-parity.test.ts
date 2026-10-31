// 독립 APP1b 검증: 보호된 골든은 바꾸지 않는다.
// 순수 함수의 골든 out 검증과, 그 전체 문장들을 실제 서버 세션/기존 controller에 넣은 차등을 구분한다.
// same-number의 구조화 입력은 원래 out을 직접 검사하고 해당 상품/설정/최근 쓰기를 가진 합성 발화로 서버 경계를 검사한다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as voice from '../../packages/voice/src/index.ts'
import { BaseSpeechEngine, type SpeechResult } from '../../packages/voice/src/speech.ts'
import { VoiceController, type VoiceHost } from './support/legacy-voice-controller.ts'
import { createReadingSession, type ReadingHost } from '../../packages/voice-session/src/server.ts'
import { fromWire, toWire, type VoiceServerMessage, type VoiceStateMessage } from '../../packages/voice-session/src/wire.ts'

const GOLDEN = fileURLToPath(new URL('../golden/', import.meta.url))
const T0 = Date.UTC(2026, 9, 29, 3)
const requireVoice = createRequire(new URL('../../packages/voice/package.json', import.meta.url))
const { parseAllDocuments } = requireVoice('yaml') as { parseAllDocuments(text: string): { errors: Error[]; toJS(): unknown }[] }
interface ExtractionCase { in: string; out: Partial<voice.VoiceExtraction>; dictionary: string[]; maxNumber: number }
interface ExtractDocument { settings?: { dictionary?: string[]; maxNumber?: number }; cases: { in: string; out: Partial<voice.VoiceExtraction> }[] }
interface JsonCase { id: string; in: Record<string, unknown> | string; settings?: voice.SmsReadOptions; catalog?: voice.SmsReadOptions['catalog']; focus?: voice.SmsReadOptions['focus']; out: unknown }
interface JsonGolden { kind: string; cases: JsonCase[] }
const extractCases: ExtractionCase[] = parseAllDocuments(readFileSync(join(GOLDEN, 'parser/voice-extract.yaml'), 'utf8')).flatMap((doc) => {
  if (doc.errors.length > 0) throw doc.errors[0]
  const value = doc.toJS() as ExtractDocument
  return value.cases.map((item) => ({ ...item, dictionary: value.settings?.dictionary ?? [], maxNumber: value.settings?.maxNumber ?? 999 }))
})
const registerFiles = readdirSync(join(GOLDEN, 'voice-register')).filter((name) => name.endsWith('.json')).sort()
const registerDocs = registerFiles.map((name) => JSON.parse(readFileSync(join(GOLDEN, 'voice-register', name), 'utf8')) as JsonGolden)
const smsFiles = readdirSync(join(GOLDEN, 'voice')).filter((name) => name.endsWith('.json')).sort()
const smsDocs = smsFiles.map((name) => JSON.parse(readFileSync(join(GOLDEN, 'voice', name), 'utf8')) as JsonGolden)
const smsOptions = (item: JsonCase): voice.SmsReadOptions => ({ ...item.settings, ...(item.catalog === undefined ? {} : { catalog: item.catalog }), ...(item.focus === undefined ? {} : { focus: item.focus }) })

class Speech extends BaseSpeechEngine {
  readonly kind = 'livegenie' as const
  isSupported() { return true }
  start() { this.setState('LISTENING') }
  stop() { this.setState('OFF') }
  result(result: SpeechResult) { this.emitResult(result) }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const settings = { 'voice.autoRegister': false, 'voice.autoConfirm': false }
const context = () => ({ now: Date.now(), dialogOpen: false, smsAutoAllowed: false, consent: true, settings })

interface SentenceCase { id: string; text: string; maxNumber: number; dictionary: readonly string[]; sms?: voice.SmsReadOptions; existing?: voice.SameNumberInput }
const sentences: SentenceCase[] = [
  ...extractCases.map((item, index) => ({ id: `extract-${index + 1}`, text: item.in, maxNumber: item.maxNumber, dictionary: item.dictionary })),
  ...registerDocs.flatMap((doc): SentenceCase[] => {
    if (doc.kind === 'same-number') return doc.cases.map((item) => {
      const input = item.in as unknown as voice.SameNumberInput
      const text = `${input.heard.numberFrom === 'BARE' ? '15' : '15번'} ${input.heard.name ?? ''} ${input.heard.price === null ? '' : `${input.heard.price}${input.heard.priceSure ? '원' : ''}`}`
      return { id: item.id, text, maxNumber: 999, dictionary: input.heard.nameFrom === 'DICTIONARY' && input.heard.name !== null ? [input.heard.name] : [], existing: input }
    })
    if (!['renumber', 'variety-guess'].includes(doc.kind)) throw new Error(`알 수 없는 골든: ${doc.kind}`)
    return doc.cases.map((item) => {
      if (typeof item.in === 'string' || typeof item.in.text !== 'string') throw new Error(`문장이 없는 골든: ${item.id}`)
      return { id: item.id, text: item.in.text, maxNumber: typeof item.in.maxNumber === 'number' ? item.in.maxNumber : 999, dictionary: [] }
    })
  }),
  ...smsDocs.flatMap((doc) => {
    if (doc.kind !== 'voice-sms') throw new Error(`알 수 없는 골든: ${doc.kind}`)
    return doc.cases.map((item) => {
      if (typeof item.in !== 'string') throw new Error(`문장이 없는 골든: ${item.id}`)
      return { id: item.id, text: item.in, maxNumber: item.settings?.maxNumber ?? 999, dictionary: [], sms: smsOptions(item) }
    })
  }),
]

describe('TD-APP1b-01 보호된 골든과 실제 서버 읽기 동등성', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }))
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('골든 전체 파일·사례를 빠짐없이 읽고 원래 out을 지킨다: 추출228+바로등록124+문자찜67', () => {
    expect(extractCases).toHaveLength(228)
    expect(registerFiles).toEqual(['renumber.json', 'same-number.json', 'variety-guess.json'])
    expect(registerDocs.flatMap((doc) => doc.cases)).toHaveLength(124)
    expect(smsFiles).toEqual(['voice-sms.json'])
    expect(smsDocs.flatMap((doc) => doc.cases)).toHaveLength(67)
    expect(sentences).toHaveLength(419)
    for (const item of extractCases) expect(voice.extractVoice(item.in, { dictionary: item.dictionary, maxNumber: item.maxNumber }), item.in).toEqual({ no: null, name: null, price: null, ...item.out })
    for (const doc of registerDocs) for (const item of doc.cases) {
      if (typeof item.in === 'string') throw new Error('구조화 입력이 아니다')
      const options = typeof item.in.maxNumber === 'number' ? { maxNumber: item.in.maxNumber } : {}
      if (doc.kind === 'renumber') expect(voice.readRenumber(item.in.text, options), item.id).toEqual(item.out)
      else if (doc.kind === 'variety-guess') expect({ guess: voice.guessVariety(item.in.text, options) }, item.id).toEqual(item.out)
      else if (doc.kind === 'same-number') expect(voice.decideSameNumber(item.in as unknown as voice.SameNumberInput), item.id).toStrictEqual(item.out)
      else throw new Error(`알 수 없는 골든: ${doc.kind}`)
    }
    for (const doc of smsDocs) for (const item of doc.cases) expect(voice.readSmsSentence(item.in, smsOptions(item)), item.id).toStrictEqual(item.out)
  })

  it.each(sentences)('$id: 같은 최종 문장 → 같은 전체 카드·후보·폼·문자찜·로그·설정·효과', async (item) => {
    // 요청 번호 공급자를 같게 해 내용 차등만 본다. 실제 중복 방지는 별도 서버 API/WS 시험이 담당한다.
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    const messages: VoiceServerMessage[] = []
    const product = item.existing?.product
    const host: ReadingHost = {
      maxNumber: () => item.maxNumber, currentNames: () => item.dictionary, products: () => new Map(),
      fetchHistory: async () => [], priceUnit: () => 'WON', smsReadOptions: () => item.sms ?? {},
      smsProduct: () => ({ state: 'OPEN', waitlistFull: false }),
      ...(product === undefined ? {} : {
        products: () => new Map([[15, product.status === 'CLOSED']]),
        existingProduct: (no: number) => no === 15 ? { key: 'broadcast/15', name: product.name, price: product.price, status: product.status, closed: product.status === 'CLOSED', claimCount: product.liveClaims } : null,
        lastVoiceDevice: () => item.existing?.otherDevice === true ? 'otherdevice' : 'paritydevice',
      }),
    }
    const engine = new Speech()
    const localEffects: unknown[][] = []
    const localFixes: unknown[][] = []
    const fixResult = { kind: 'failed' as const, message: '검증용 쓰기 응답' }
    const chosenSettings = { ...settings, ...(item.existing === undefined ? {} : { 'voice.autoRegister': item.existing.auto }) }
    const oldHost: VoiceHost = {
      ...host, load: async () => voice, createEngine: () => engine, now: Date.now, deviceId: () => 'paritydevice',
      newRequestId: () => globalThis.crypto.randomUUID(),
      readConsent: () => true, writeConsent() {}, readSettings: () => chosenSettings, writeSettings() {},
      dialogOpen: () => false, smsAutoAllowed: () => false,
      writeSms: async () => ({ kind: 'failed', message: '시험에서는 자동 쓰기 금지' }),
      fixRecent: async (...args) => { localFixes.push(args); return fixResult },
      register: (...args) => localEffects.push(args), focusQuick() {},
    }
    const original = new VoiceController(oldHost)
    const session = createReadingSession({ host, device: 'paritydevice', broadcastId: 'broadcast', accountId: 'seller', send: (value) => {
      messages.push(value)
      if (value.type === 'voice.effect' && value.method === 'fixRecent') queueMicrotask(() => session.onMessage({ type: 'voice.session', op: 'effectResult', id: value.id, value: fixResult }))
    } })
    try {
      session.onMessage({ type: 'voice.session', op: 'hello', context: { ...context(), settings: chosenSettings } })
      await original.turnOn(); await settle()
      if (product !== undefined && item.existing?.recent === true) {
        const entry = { id: 'registration-15', no: 15, name: product.name, price: product.price }
        original.noteVoiceRegistered(entry)
        session.onMessage({ type: 'voice.session', op: 'command', method: 'noteVoiceRegistered', args: [entry] })
        await settle()
      }
      session.onMessage({ type: 'voice.session', op: 'capture', at: T0 })
      session.onResult(item.text, 0, 0)
      engine.result({ text: item.text, final: true })
      await vi.advanceTimersByTimeAsync(2000)
      const state = messages.filter((value): value is VoiceStateMessage => value.type === 'voice.state' && value.sessionReady).at(-1)
      expect(state).toBeDefined()
      expect(state!.snapshot).toEqual(toWire(original.getSnapshot()))
      const registrations = messages.filter((value) => value.type === 'voice.effect' && value.method === 'register').map((value) => (fromWire(value.type === 'voice.effect' ? value.args : null) as unknown[]).slice(0, 3))
      expect(registrations).toEqual(localEffects)
      const fixes = messages.filter((value) => value.type === 'voice.effect' && value.method === 'fixRecent').map((value) => fromWire(value.type === 'voice.effect' ? value.args : null))
      expect(fixes).toEqual(localFixes)
    } finally { original.dispose(); session.close() }
  })
})
