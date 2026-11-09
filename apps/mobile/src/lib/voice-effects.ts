// 서버가 결정한 효과만 기존 HTTP 이벤트에 연결한다. 등록·찜·정정의 판정은 서버가 맡는다.
import type { FullView, WriteResult } from '@livejjim/web/src/api/types.ts'
import type { VoiceHost, VoiceWriteOptions, VoiceSmsWrite } from '@livejjim/web/src/voice/model.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { productSlots } from './derive.ts'
import type { VoiceSession } from './voice-session.ts'

type Scope = { date: string; rehearsal: boolean }
class VoiceWriteBlocked extends Error {}
export function createVoiceEffects(scopeOf: (b: string) => Promise<Scope>) {
  const undoable = new Map<string, { b: string; no: number; until: number }>()
  return async (b: string, method: string, args: readonly unknown[], session: VoiceSession, writeCheck?: (firstAttempt: boolean) => string | null): Promise<unknown> => {
    const operation = session.operationKey()
    const scope = await scopeOf(b)
    const write = async (event: Record<string, unknown>, requestId = newRequestId()): Promise<WriteResult> => {
      let firstAttempt = true
      return withRetry(() => {
        if (!session.isOperationCurrent(operation, b)) throw new VoiceWriteBlocked('음성 인식을 꺼서 보내지 않았어요.')
        const blocked = writeCheck?.(firstAttempt)
        if (blocked) throw new VoiceWriteBlocked(blocked)
        firstAttempt = false
        return post<WriteResult>(withQuery('/api/events', typeof event.b === 'string' ? {} : { date: scope.date, rehearsal: scope.rehearsal }), { ...event, requestId })
      })
    }
    const full = (): Promise<FullView> => get<FullView>(withQuery(`/api/days/${scope.date}`, { rehearsal: scope.rehearsal }))
    const failed = (error: unknown) => ({ kind: 'failed', message: isApiError(error) || error instanceof VoiceWriteBlocked ? error.message : '보내지 못했어요. 연결을 확인하고 다시 눌러 주세요.' })
    if (method === 'register') {
      const [card, registration, source, voiceLog] = args as [Parameters<VoiceHost['register']>[0], Parameters<VoiceHost['register']>[1], Parameters<VoiceHost['register']>[2], unknown]
      try {
        const result = await write({ type: 'product.register', b, ...registration, ...(voiceLog ? { voiceLog } : {}) }, typeof args[4] === 'string' ? args[4] : undefined)
        if (!result.changed) {
          if (source === 'instant') session.command('instantExists', [card])
          else session.command('restore', [card, { touched: true, note: '이미 있는 번호예요. 상품 목록에서 확인하고 고쳐 주세요.' }])
          return { kind: 'exists' }
        }
        const data = await full()
        const product = data.products.find((item) => item.broadcast === b && item.no === registration.no)
        if (product && session.isOperationCurrent(operation, b)) {
          session.command('noteVoiceRegistered', [{ id: product.key, ...registration }])
          undoable.set(product.key, { b, no: product.no, until: Date.now() + 5000 })
          session.noteRegistered(product.no)
        }
      } catch (error) {
        if (isApiError(error) && error.code === 'PRODUCT_EXISTS' && source === 'instant') session.command('instantExists', [card])
        else session.command('restore', [card, { touched: true, note: isApiError(error) || error instanceof VoiceWriteBlocked ? error.message : '등록하지 못했어요. 확인하고 다시 눌러 주세요.' }])
        return failed(error)
      }
      return { kind: 'registered' }
    }
    if (method === 'writeSms') {
      const [one, received, requestId] = args as [VoiceSmsWrite, string | null, string]
      const data = await full()
      const option = data.broadcasts.find((item) => item.id === b)?.settings['claim.parseMode'] === 'OPTIONS'
      try {
        const result = await write({ type: 'sms', b, no: one.no, ...(option ? { qty: one.qty, ...(one.options ? { options: one.options } : {}) } : {}), ...(received === null ? {} : { received }), ...(one.memo === null ? {} : { memo: one.memo }), ...(one.buyer === undefined ? (one.last4 === undefined ? {} : { last4: one.last4, ...(one.newBuyer ? { newBuyer: true } : {}) }) : { buyer: one.buyer }), voice: true }, requestId)
        return { kind: 'ok', seq: result.seq, buyer: result.buyer ?? null }
      } catch (error) {
        if (isApiError(error) && error.code === 'VOICE_REPEATED') return { kind: 'repeated', message: error.message }
        if (isApiError(error) && error.code === 'BUYER_AMBIGUOUS' && Array.isArray(error.details.candidates)) return { kind: 'ambiguous', candidates: error.details.candidates, message: error.message }
        return failed(error)
      }
    }
    if (method === 'fixRecent') {
      const [key, changes, input] = args as [string, { name?: string; price?: number }, VoiceWriteOptions | undefined]
      const options = input ?? {}
      const product = (await full()).products.find((item) => item.key === key && item.broadcast === b)
      if (!product) return { kind: 'failed', message: '그 상품을 찾지 못했어요. 상품 목록에서 확인해 주세요.' }
      const slots = productSlots(product)
      const claimed = slots.winners.length + slots.waitlist.length > 0
      let applyTo = options.applyTo ?? (options.newOnly ? 'NEW_ONLY' : undefined)
      if (claimed && changes.price !== undefined && changes.price !== product.price && applyTo === undefined) {
        const choice = await session.choosePriceScope(product.no, changes.price)
        if (choice === null) return { kind: 'failed', message: '가격을 바꾸지 않았어요. 적용할 찜을 골라 주세요.' }
        applyTo = choice
      }
      const before = { ...(changes.name === undefined ? {} : { name: product.name }), ...(changes.price === undefined ? {} : { price: product.price }) }
      try {
        await write({ type: 'product.update', b, no: product.no, ...changes, ...(changes.price === undefined || !claimed || applyTo === undefined ? {} : { applyTo }), ...(options.voiceLog ? { voiceLog: options.voiceLog } : {}) }, options.requestId)
        return { kind: 'fixed', before }
      } catch (error) { return failed(error) }
    }
    if (method === 'renumber') {
      const [from, to, input] = args as [number, number, VoiceWriteOptions | undefined]
      try { return (await write({ type: 'product.renumber', b, from, to, ...(input?.voiceLog ? { voiceLog: input.voiceLog } : {}) }, input?.requestId)).changed }
      catch (error) { return isApiError(error) && error.code === 'VOICE_RENUMBER_CLAIMED' ? 'claimed' : false }
    }
    if (method === 'undoRecent') {
      const key = String(args[0]); const item = undoable.get(key)
      if (!item || item.b !== b || Date.now() > item.until) return false
      undoable.delete(key)
      await write({ type: 'product.close', b, no: item.no })
      session.command('rejectNumber', [item.no])
      return true
    }
    return null
  }
}
