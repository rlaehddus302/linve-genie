// V2 적대 시험 도우미 (test-domain): 결과(시각) → feed/tick → readChunk → chooseAction → 카드. 100ms마다 tick (화면 컨트롤러의 최소 모양).
import {
  addCard,
  addLogEntry,
  chooseAction,
  closeCard,
  createChunkCard,
  createLogEntry,
  createPhraseState,
  editCard,
  feed,
  fillCard,
  prepareVoiceDictionary,
  readChunk,
  replaceCard,
  tick,
  type PhraseChunk,
  type PhraseOutput,
  type PhraseSms,
  type RecentRegistration,
  type SuggestionCard,
  type VoiceAction,
  type VoiceLogAction,
  type VoiceLogEntry,
  type VoiceSettings,
} from '@livejjim/voice'

export const DICT = prepareVoiceDictionary()

export interface SimResult {
  readonly text: string
  readonly at: number
  readonly final?: boolean
  readonly flushedAtEnd?: boolean
}

export interface SimOutcome {
  readonly cards: SuggestionCard[]
  readonly chunks: PhraseChunk[]
  readonly sms: PhraseSms[]
  readonly actions: { readonly at: number; readonly action: VoiceAction }[]
  readonly log: VoiceLogEntry[]
}

const LOG_ACTION: Readonly<Record<VoiceAction['kind'], VoiceLogAction>> = {
  create: 'create',
  fill: 'fill',
  edit: 'edit',
  close: 'close',
  offer: 'offer',
  offerNumber: 'offer',
  offerUndo: 'offer',
  confirmEdit: 'offer',
  discard: 'discard',
}

export function simulate(results: readonly SimResult[], until: number, init: { cards?: SuggestionCard[]; recent?: RecentRegistration[]; quietMs?: number; settings?: Partial<VoiceSettings> } = {}): SimOutcome {
  let state = createPhraseState({ quietMs: init.quietMs })
  let cards = [...(init.cards ?? [])]
  const chunks: PhraseChunk[] = []
  const sms: PhraseSms[] = []
  const actions: { at: number; action: VoiceAction }[] = []
  let log: VoiceLogEntry[] = []
  let nextId = 1
  const handle = (out: readonly PhraseOutput[]): void => {
    for (const item of out) {
      if (item.kind === 'sms') {
        sms.push(item.sms)
        log = addLogEntry(log, createLogEntry({ at: item.sms.at, pieces: [{ text: item.sms.text }], action: 'sms' }))
        continue
      }
      const { chunk } = item
      chunks.push(chunk)
      const reading = readChunk(chunk.text, { dictionary: DICT })
      const action = chooseAction(reading, { cards, recent: init.recent ?? [], now: chunk.endedAt, chunkStartedAt: chunk.startedAt })
      actions.push({ at: chunk.endedAt, action })
      if (action.kind === 'create') {
        const card = createChunkCard({ id: `c${String(nextId++)}`, action, text: chunk.text, createdAt: chunk.endedAt, settings: init.settings, noAutoConfirm: chunk.noAutoConfirm })
        if (card !== null) cards = addCard(cards, card)
      } else if (action.kind === 'fill') {
        const card = cards.find((c) => c.id === action.cardId) as SuggestionCard
        cards = replaceCard(cards, fillCard(card, action, chunk.endedAt, init.settings))
      } else if (action.kind === 'edit') {
        const card = cards.find((c) => c.id === action.cardId) as SuggestionCard
        const edited = editCard(card, action.changes)
        if (edited.ok) cards = replaceCard(cards, edited.card)
      } else if (action.kind === 'close') {
        const card = cards.find((c) => c.id === action.cardId) as SuggestionCard
        cards = replaceCard(cards, closeCard(card))
      }
      log = addLogEntry(
        log,
        createLogEntry({
          at: chunk.endedAt,
          pieces: chunk.pieces,
          read: { no: reading.no, name: reading.name, price: reading.price, candidates: reading.candidates },
          action: LOG_ACTION[action.kind],
          reason: action.kind === 'discard' ? action.reason : null,
        }),
      )
    }
  }
  const sorted = [...results].sort((a, b) => a.at - b.at)
  let i = 0
  for (let now = 0; now <= until; now += 100) {
    while (i < sorted.length && (sorted[i] as SimResult).at <= now) {
      const r = sorted[i++] as SimResult
      const step = feed(state, { text: r.text, final: r.final !== false, at: r.at, flushedAtEnd: r.flushedAtEnd })
      state = step.state
      handle(step.out)
    }
    const step = tick(state, now)
    state = step.state
    handle(step.out)
  }
  return { cards, chunks, sms, actions, log }
}

export const openCards = (cards: readonly SuggestionCard[]): SuggestionCard[] => cards.filter((card) => card.status === 'OPEN')
export const view = (card: SuggestionCard | undefined): { no: number | null; name: string | null; price: number | null } | undefined =>
  card === undefined ? undefined : { no: card.no, name: card.name, price: card.price }
