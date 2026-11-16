// APP1b: 인증된 서버 범위의 자료만 기존 읽기 컨트롤러에 공급한다. 기기가 보낸 상품·사전은 쓰지 않는다.
import { createReadingSession } from '@livejjim/voice-session/server'
import type { LearnedAlias } from '@livejjim/voice'
import { fromFull, type ScopeData } from '../../../web/src/lib/scope-data.ts'
import { productKey, productSlots } from '../../../web/src/lib/derive.ts'
import { readReceived } from '@livejjim/voice-session/read'
import { pickHistoryDays } from '@livejjim/voice-session/rules'
import type { FullView } from '../../../web/src/api/types.ts'
import type { Db } from '../db/database.ts'
import type { Service } from '../service.ts'
import type { ScopeWriter } from '../writer.ts'
import { fullView } from '../views.ts'
import { findBroadcast } from '../store.ts'
import type { Clock } from '../time.ts'
import type { VoiceAliases } from './aliases.ts'
import type { VoiceVarieties } from './varieties.ts'
import type { VoiceRelayOptions, VoiceReadingSession } from './relay.ts'

export type VoiceHistoryObserver = (sellerId: string, date: string | null, phase: 'start' | 'complete') => void | Promise<void>
export function readingFactory(deps: { screenProducts: boolean; db: Db; service: Service; writer: ScopeWriter; clock: Clock; aliases: VoiceAliases; varieties?: VoiceVarieties; historyObserver?: VoiceHistoryObserver }): NonNullable<VoiceRelayOptions['reading']> {
  return async ({ session, broadcastId, device, send, mode }): Promise<VoiceReadingSession> => {
    const sellerId = session.sellerId
    const broadcast = await findBroadcast(deps.db, sellerId, broadcastId)
    if (broadcast === null || broadcast.endedAt !== null) throw new Error('방송이 끝났어요.')
    let learned: readonly LearnedAlias[] = await deps.aliases.read(sellerId)
    let data: ScopeData
    let names: readonly string[] = []
    let numbers: ReadonlyMap<number, boolean> = new Map()
    let seq = -1
    let closed = false
    let writes = Promise.resolve()
    const lastDevices = new Map<number, string>()
    async function refresh(): Promise<void> {
      if (closed) return
      const runtime = await deps.writer.read(sellerId, broadcast!.date, broadcast!.rehearsal)
      if (closed || seq === runtime.seq) return
      seq = runtime.seq
      data = fromFull(fullView(runtime) as unknown as FullView)
      names = [...data.products.values()].map((product) => product.name)
      numbers = new Map([...data.products.values()].filter((product) => product.broadcast === broadcastId).map((product) => [product.no, product.status === 'CLOSED']))
      const logs = await deps.service.voiceLog(sellerId, { b: broadcastId })
      lastDevices.clear()
      for (const entry of logs) if (!entry.failed && entry.device !== null) lastDevices.set(entry.toNo ?? entry.no, entry.device)
    }
    await refresh()
    const getProduct = (no: number) => data.products.get(productKey(broadcastId, no))
    const settings = () => data.broadcasts.get(broadcastId)!.settings
    async function historyRead<T>(date: string | null, read: () => Promise<T>): Promise<T> {
      try {
        await deps.historyObserver?.(sellerId, date, 'start')
        return await read()
      } finally { await deps.historyObserver?.(sellerId, date, 'complete') }
    }
    const mergeLearned = async (value: unknown): Promise<void> => {
      if (value === undefined || value === null) return
      const merged = await deps.aliases.merge(sellerId, value, true)
      if (merged !== null && !closed) learned = merged
    }
    const reader = createReadingSession({
      device, broadcastId, accountId: sellerId, send, mode, now: () => deps.clock.now(), mergeLearned,
      host: {
        screenProducts: deps.screenProducts,
        ready: () => !closed && data.broadcasts.has(broadcastId),
        maxNumber: () => settings()['claim.maxNumber'],
        priceUnit: () => settings()['price.unit'],
        currentNames: () => names,
        products: () => numbers,
        existingProduct: (no) => {
          const product = getProduct(no)
          if (product === undefined) return null
          // 가격이 빈 확인 중 상품(D-RECOG-22)은 음성 같은 번호 규칙이 견줄 가격이 없다 — 음성 길에서는 없는 번호로 보고, 그 번호의 등록은 emptyPrice로 가격 채우기가 된다(D-RECOG-28)
          if (product.price === null) return null
          const slots = productSlots(product)
          return { key: product.key, name: product.name, price: product.price, claimCount: slots.winners.length + slots.waitlist.length, closed: product.status === 'CLOSED', status: product.status }
        },
        // 가격이 빈 확인 중 상품(D-RECOG-22): 음성으로 "N번 3만 원"이 들리면 새로 등록하지 않고 가격만 채운다 (D-RECOG-28). 거둔 상품은 아니다
        emptyPrice: (no) => {
          const product = getProduct(no)
          return product !== undefined && product.price === null && product.status !== 'CLOSED' ? product.key : null
        },
        fetchHistory: async () => {
          const days = pickHistoryDays(await historyRead(null, () => deps.service.days(sellerId, false)), broadcast)
          // D-V3-127 내 품종 장부는 판매 이력 맨 앞 — 날짜 자리의 '내 품종'은 숫자 날짜보다 커서 최근 것 먼저 정렬에서 맨 앞에 선다
          const mine = deps.varieties === undefined ? [] : await deps.varieties.read(sellerId)
          const own = mine.length === 0 ? [] : [{ date: '내 품종', names: mine }]
          return [...own, ...await Promise.all(days.map(async (date) => {
            const view = await historyRead(date, () => deps.service.scopeView(sellerId, date))
            const products = view?.products
            return { date, names: Array.isArray(products) ? products.flatMap((item: unknown) => typeof item === 'object' && item !== null && 'name' in item && typeof item.name === 'string' ? [item.name] : []) : [] }
          }))]
        },
        smsReadOptions: () => {
          const own = settings()
          const base = { parseMode: own['claim.parseMode'], maxNumber: own['claim.maxNumber'], maxQuantity: own['claim.maxQuantity'] }
          if (base.parseMode !== 'OPTIONS') return base
          const catalog = [...data.products.values()].filter((product) => product.broadcast === broadcastId && product.status !== 'CLOSED').sort((a, b) => a.no - b.no)
            .map((product) => ({ no: product.no, name: product.name, aliases: product.aliases, options: product.options }))
          const marked = data.broadcasts.get(broadcastId)?.focus ?? null
          const focused = marked === null ? undefined : data.products.get(marked.product)
          const at = marked === null ? Number.NaN : Date.parse(marked.at)
          const focus = focused === undefined || focused.status === 'HOLD' || focused.status === 'CLOSED' || !Number.isFinite(at) ? null : { no: focused.no, ageSec: Math.max(0, (deps.clock.now() - at) / 1000) }
          return { ...base, catalog, focus }
        },
        smsProduct: (no) => {
          const product = getProduct(no)
          if (product === undefined) return null
          return { state: product.status, waitlistFull: product.status === 'SOLD' && !product.hasOptions && product.waitlist.length >= settings()['waitlist.max'] }
        },
        smsProductName: (no) => getProduct(no)?.name.trim() || null,
        readSmsTime: (value, now) => { const parsed = readReceived(value, now); return parsed.kind === 'ok' ? { value: parsed.value, late: parsed.late } : null },
        readLearned: () => learned,
        writeLearned: (list) => {
          learned = list
          writes = writes.then(async () => {
            if (list.length === 0) { await deps.aliases.clear(sellerId); return }
            const saved = await deps.aliases.merge(sellerId, list, false)
            if (!closed && saved !== null) learned = saved
          })
            .catch(() => { send({ type: 'voice.error', message: '배운 품종 이름을 저장하지 못했어요. 다시 골라 주세요.' }) })
        },
        lastVoiceDevice: (no) => lastDevices.get(no) ?? null,
      },
    })
    return {
      async onResult(result) { await refresh(); if (!closed) reader.onResult(result.text, result.startMs, result.endMs, result.conf) },
      async onMessage(value) { await refresh(); if (!closed) reader.onMessage(value) },
      async onServerCapture(at) { await refresh(); if (!closed) reader.onServerCapture(at) },
      refresh,
      close() { closed = true; reader.close(); learned = []; names = []; numbers = new Map(); lastDevices.clear() },
    }
  }
}
