// 거의 동시에 넣은 손 등록 알림 (11월 12일 라이브 복기 6.3 "313번", 개선 계획표 G5, D-RETRO-13):
// 내 손 등록이 "이미 있는 번호"로 아무 일도 없었는데, 그 번호가 방금(2초 안) 다른 계정에서 들어온 것이고 값이 다르면 서버가 두 값을 돌려준다(syncClash).
// 버려진 줄 모르고 지나가지 않게 둘을 보여 고르게 한다 — 왼쪽 [그 값 두기] · 오른쪽 [내 값으로 바꾸기].
// - 내 값으로 바꾸면 품종·가격을 고친다(product.update). 그 상품에 확정된 찜이 있으면 가격 적용 범위 물음(D-RETRO-20)을 그대로 탄다.
// - 그 번호가 확인 중(기다리는 찜이 있어 임시로 들어온 것)이면 고른 값으로 확정까지 한다 — 단추가 [그 값으로 확정] · [내 값으로 확정].
// 다른 계정의 가게 이름은 글자로만 그린다(줄바꿈·제어 문자를 지우고 길이를 자른다). 닉네임·채팅 글은 없다.
import { useState } from 'react'
import { isApiError } from '../../api/client.ts'
import { productKey } from '../../lib/derive.ts'
import { confirmEvent, isTentative } from '../../lib/tentative.ts'
import { formatWon } from '../../lib/words.ts'
import { PopupDialog } from '../../ui/kit/index.ts'
import { useConsoleApi } from './context.ts'
import { PRICE_SCOPE_ALL, PRICE_SCOPE_NEW, claimedBuyers, priceScopeAsk } from './price-scope.ts'

interface ClashValue {
  readonly name: string
  readonly price: number
}

export interface SyncClash {
  readonly no: number
  /** 내가 넣으려던 값 */
  readonly tried: ClashValue
  /** 지금 그 번호에 있는 값과 넣은 계정의 가게 이름(모르면 null) */
  readonly current: ClashValue & { readonly from: string | null }
}

export const SYNC_KEEP = '그 값 두기'
export const SYNC_MINE = '내 값으로 바꾸기'
export const SYNC_KEEP_CONFIRM = '그 값으로 확정'
export const SYNC_MINE_CONFIRM = '내 값으로 확정'
export const SYNC_GONE = '그 상품이 없어졌어요. 다시 추가해 주세요.'
export const SYNC_FAILED = '바꾸지 못했어요. 다시 해 주세요.'
/** 가게 이름을 보이는 가장 긴 길이 */
const FROM_MAX = 30

const record = (value: unknown): Readonly<Record<string, unknown>> | null => (typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : null)

function readValue(value: unknown): ClashValue | null {
  const item = record(value)
  if (item === null || typeof item.name !== 'string' || typeof item.price !== 'number' || !Number.isSafeInteger(item.price) || item.price < 0) return null
  return { name: item.name, price: item.price }
}

/** 화면에 그릴 가게 이름: 제어 문자·줄바꿈을 빈칸으로, 앞뒤 빈칸을 떼고 길이를 자른다. 비면 null */
export function shownFrom(from: unknown): string | null {
  if (typeof from !== 'string') return null
  const clean = from.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  if (clean === '') return null
  return clean.length > FROM_MAX ? `${clean.slice(0, FROM_MAX)}…` : clean
}

/** 쓰기 응답에서 두 값을 읽는다 — 서버 응답을 믿지 않고 읽는다(모양이 다르면 null) */
export function readSyncClash(result: unknown): SyncClash | null {
  const clash = record(record(result)?.syncClash)
  if (clash === null || typeof clash.no !== 'number' || !Number.isSafeInteger(clash.no) || clash.no < 1) return null
  const tried = readValue(clash.tried)
  const current = readValue(clash.current)
  if (tried === null || current === null) return null
  return { no: clash.no, tried, current: { ...current, from: shownFrom(record(clash.current)?.from) } }
}

const valueWords = (value: ClashValue): string => {
  const name = value.name.trim()
  return name === '' ? formatWon(value.price) : `${name} ${formatWon(value.price)}`
}

/** "방금 다른 계정(비트다육)이 313번을 빅뱅 10,000원으로 넣었어요." */
export function clashTitle(clash: SyncClash): string {
  const who = clash.current.from === null ? '다른 계정' : `다른 계정(${clash.current.from})`
  return `방금 ${who}이 ${String(clash.no)}번을 ${valueWords(clash.current)}으로 넣었어요.`
}

/** "내가 넣으려던 값은 빅뱅 30,000원이에요." */
export const clashMine = (clash: SyncClash): string => `내가 넣으려던 값은 ${valueWords(clash.tried)}이에요.`

/**
 * clash가 있으면 뜬다. onClose: 아무것도 하지 않고 닫는다(바깥 누름). onDone: 값을 골랐다 — 그 상품 열쇠(상품 추가 화면을 닫고 그 상품을 보인다).
 * onFailed: 못 바꿨을 때의 문장
 */
export function SyncClashDialog({ clash, onClose, onDone, onFailed }: { readonly clash: SyncClash | null; readonly onClose: () => void; readonly onDone: (key: string) => void; readonly onFailed: (message: string) => void }) {
  const api = useConsoleApi()
  const [busy, setBusy] = useState(false)
  // 가격 적용 범위를 묻는 중 (D-RETRO-20) — 물을 손님 수
  const [scope, setScope] = useState<number | null>(null)
  const now = clash === null ? undefined : (api.latest?.() ?? api.data).products.get(productKey(api.b, clash.no))
  const held = isTentative(now)
  const close = () => {
    setScope(null)
    onClose()
  }
  const run = async (work: (key: string) => Promise<void>) => {
    if (clash === null || busy) return
    setBusy(true)
    try {
      await work(productKey(api.b, clash.no))
      setScope(null)
      onDone(productKey(api.b, clash.no))
    } catch (caught) {
      setScope(null)
      onFailed(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : SYNC_FAILED)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  /** 그 값 두기: 확인 중이면 그 값 그대로 확정하고, 아니면 아무것도 보내지 않는다 */
  const keep = () =>
    void run(async () => {
      if (now !== undefined && isTentative(now)) await api.command(confirmEvent(now))
    })
  /** 내 값으로: 품종·가격을 고치고(가격은 원문 칸 — 원으로 읽힌다), 확인 중이면 확정까지 */
  const mine = (applyTo?: 'NEW_ONLY' | 'UNPAID_CLAIMS') =>
    void run(async () => {
      if (clash === null) return
      if (now === undefined || now.status === 'CLOSED') throw new Error(SYNC_GONE)
      const name = clash.tried.name.trim()
      await api.command({ type: 'product.update', b: api.b, noText: String(clash.no), priceText: `${String(clash.tried.price)}원`, ...(name === '' ? {} : { name }), ...(applyTo === undefined ? {} : { applyTo }) })
      if (held) await api.command({ type: 'product.confirm', b: api.b, no: clash.no })
    })
  const pickMine = () => {
    if (clash === null) return
    // 확정된 찜이 있고 가격이 다르면 그 손님에게도 적용할지 먼저 묻는다 (D-RETRO-20)
    const buyers = now === undefined || held || clash.tried.price === now.price ? 0 : claimedBuyers(now)
    if (buyers > 0) setScope(buyers)
    else mine()
  }
  if (scope !== null && clash !== null) {
    const what = [`${String(clash.no)}번`, (now?.name ?? clash.current.name).trim()].filter((part) => part !== '').join(' ')
    return (
      <PopupDialog
        visible
        message={priceScopeAsk(scope)}
        description={`${what} · ${formatWon(now?.price ?? clash.current.price)} → ${formatWon(clash.tried.price)}`}
        cancelLabel={PRICE_SCOPE_NEW}
        confirmLabel={PRICE_SCOPE_ALL}
        busy={busy}
        onCancel={() => mine('NEW_ONLY')}
        onConfirm={() => mine('UNPAID_CLAIMS')}
        // 왼쪽 단추도 저장이라 바깥 누름은 따로 — 두 값 고르기로 돌아간다
        onDismiss={() => setScope(null)}
      />
    )
  }
  return (
    <PopupDialog
      visible={clash !== null}
      message={clash === null ? '' : clashTitle(clash)}
      description={clash === null ? null : clashMine(clash)}
      cancelLabel={held ? SYNC_KEEP_CONFIRM : SYNC_KEEP}
      confirmLabel={held ? SYNC_MINE_CONFIRM : SYNC_MINE}
      busy={busy}
      onCancel={keep}
      onConfirm={pickMine}
      // 바깥 누름은 아무것도 보내지 않는다(확인 중이면 왼쪽 단추도 확정을 보내므로 따로 받는다)
      onDismiss={close}
    />
  )
}
