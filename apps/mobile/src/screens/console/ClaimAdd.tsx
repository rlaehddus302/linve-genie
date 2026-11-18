// 상품 자세히의 [찜 넣기] (D-RETRO-54, 복기 F7 — 사용자 지시 2026-11-12 "상품 목록에서 상품을 눌러 임의로 문자찜을 등록하는 기능").
// 음성 문자찜("165번 문자찜")과 같은 서버 길(sms 쓰기). 앱은 판정하지 않는다: 먼저 찜한 손님이 있으면 대기로 들어가는 것도, 같은 손님 반복이라
// 찜이 생기지 않는 것도 서버 결과 그대로 보인다.
// 고르는 것은 둘 중 하나 (D-CLAIMADD-05, 사용자 지시 2026-11-18 "그냥 문자찜으로 넣거나 아니면 최근 채팅친 사람 닉네임으로 넣거나 … 그외는 다 지워"):
// - 맨 위 [✉️ 문자찜]: 이름·번호 없이 "문자찜" 손님으로 넣는다 (D-CLAIMADD-02).
// - 그 아래 최근 채팅 손님 (D-CLAIMADD-01): 이 방송에서 채팅을 친 손님을 새 메시지부터 한 줄씩 — 누르면 그 손님(지정 구매자)으로 넣고,
//   감사 채팅·라벨 모두 그 손님 닉네임이다(sms named — 옛 [닉네임으로 보이기] 스위치를 켠 것과 같다).
// - 옛 [닉네임으로 보이기] 스위치(D-CLAIMADD-03)·손님 이름·전화번호 끝 네 자리 칸·이미 있는 손님 후보·끝 네 자리 겹침 고르기·도움말은 없다.
// - 맨 아래 [닫기]는 메뉴 줄로 돌아간다. 닉네임은 글자로만 그리고 이름 표기(닉네임 뒤 영문 숨기기 설정)를 따른다.
import { useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { ChatMessage, Product } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { claimsOfProduct } from '../../lib/derive.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { BigButton, ErrorLine, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { ACTIVE_CLAIM, addSmsClaim, smsClaimEvent, type SmsClaimInput } from './claim-actions.ts'
import { useMessages } from './ChatPaste.tsx'
import { useConsoleApi, type ConsoleApi } from './context.ts'
import { feedBuyerName, noWord } from './feed-rows.ts'
import { IconMenuRow } from './parts.tsx'

export const CLAIM_ADD = '찜 넣기'
export const CLAIM_ADD_PLAIN = '문자찜'
export const CLAIM_ADD_RECENT = '최근 채팅 손님'
/** 최근 채팅 손님 수 */
export const CLAIM_ADD_RECENT_MAX = 8
/** 최근 채팅 손님 줄에 붙이는 채팅 앞부분 글자 수 */
const RECENT_SNIPPET = 10
export const CLAIM_ADD_NO_CLAIM = '새 찜이 생기지 않았어요. 이미 찜한 손님인지 확인해 주세요.'
export const CLAIM_ADD_FAILED = '찜을 넣지 못했어요. 다시 눌러 주세요.'
const CLAIM_ADD_BUSY = '넣는 중…'

/** 넣은 뒤 한 줄: "넣었어요 — 문자-0937 · 대기 1" (찜 기록 꼬리표와 같은 낱말) */
export interface ClaimAdded {
  readonly tone: 'success' | 'warning'
  readonly text: string
}

/** 채팅 손님인가 (문자 손님이 아니다) — 닉네임으로 넣기(sms named)는 채팅 손님에게만 뜻이 있다 (D-CLAIMADD-05) */
export function isChatBuyer(data: ScopeData, id: string): boolean {
  const buyer = data.buyers.get(id)
  return buyer !== undefined && buyer.kind !== 'sms'
}

/** 최근 채팅 손님 한 명: 지금의 손님 ID와 그 손님의 가장 최근 채팅 앞부분 */
export interface RecentChatBuyer {
  readonly buyer: string
  readonly snippet: string
}

const snippetOf = (text: string): string => {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length <= RECENT_SNIPPET ? chars.join('') : `${chars.slice(0, RECENT_SNIPPET).join('')}…`
}

/**
 * 최근 채팅 손님 (D-CLAIMADD-01): 그 상품 방송의 채팅을 새것부터 보며 손님(합쳐졌으면 지금의 손님)마다 하나.
 * 방송자 메시지·무시한 메시지, 모르는 손님·차단한 손님, 그 상품에 살아 있는 찜이 이미 있는 손님은 뺀다
 */
export function recentChatBuyers(data: ScopeData, messages: readonly ChatMessage[], product: Product): RecentChatBuyer[] {
  const taken = new Set(claimsOfProduct(data, product).filter((claim) => ACTIVE_CLAIM.has(claim.status)).map((claim) => claim.currentBuyer))
  const seen = new Set<string>()
  const out: RecentChatBuyer[] = []
  for (const message of [...messages].sort((a, b) => b.seq - a.seq)) {
    if (message.broadcast !== product.broadcast || message.owner || message.ignored) continue
    const current = data.buyers.get(message.channel)?.current
    const buyer = current === undefined ? undefined : data.buyers.get(current)
    if (buyer === undefined || seen.has(buyer.id)) continue
    seen.add(buyer.id)
    if (buyer.blocked || taken.has(buyer.id)) continue
    out.push({ buyer: buyer.id, snippet: snippetOf(message.text) })
    if (out.length >= CLAIM_ADD_RECENT_MAX) break
  }
  return out
}

/** 넣은 결과 한 줄 — 그 쓰기(seq)로 생긴 문자찜의 지금 상태를 낱말로. 찜이 생기지 않았으면 주의 */
export function addedLine(data: ScopeData, names: ConsoleApi['names'], seq: number): ClaimAdded {
  for (const claim of data.claims.values()) {
    if (claim.seq === seq && claim.origin === 'sms') return { tone: 'success', text: `넣었어요 — ${feedBuyerName(data, names, claim.currentBuyer)} · ${noWord(data, claim)}` }
  }
  return { tone: 'warning', text: CLAIM_ADD_NO_CLAIM }
}

/** onClose: 넣지 않고 닫기. onAdded: 넣은 뒤(결과 한 줄과 함께 닫는다) */
export function ClaimAddForm({ product, onClose, onAdded }: { readonly product: Product; readonly onClose: () => void; readonly onAdded: (added: ClaimAdded) => void }) {
  const api = useConsoleApi()
  // 넣는 중인 줄 (문자찜은 '', 채팅 손님은 그 손님 ID)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 같은 줄을 다시 누르면 같은 요청 번호 — 응답을 못 받고 다시 눌러도 찜이 둘 생기지 않는다
  const request = useRef<{ readonly signature: string; readonly id: string } | null>(null)
  const { view: chat } = useMessages()
  const recent = useMemo(() => (chat === null ? [] : recentChatBuyers(api.data, chat.messages, product)), [api.data, chat, product])

  const send = async (buyer: string | null) => {
    if (busy !== null) return
    const input: SmsClaimInput = { name: '', last4: '', buyer, named: buyer !== null && isChatBuyer(api.data, buyer) }
    const signature = JSON.stringify(smsClaimEvent(product, input))
    if (request.current?.signature !== signature) request.current = { signature, id: newRequestId() }
    setBusy(buyer ?? '')
    setError(null)
    try {
      const outcome = await addSmsClaim(api, product, input, request.current.id)
      if (outcome.kind === 'ambiguous') {
        setError(outcome.message)
        return
      }
      request.current = null
      onAdded(addedLine(api.latest?.() ?? api.data, api.names, outcome.result.seq))
    } catch (caught) {
      setError(isApiError(caught) ? [caught.message, ...caught.problems.map((problem) => problem.message)].filter((part, index, all) => part !== '' && all.indexOf(part) === index).join(' ') : CLAIM_ADD_FAILED)
    } finally {
      setBusy(null)
    }
  }
  const no = `${String(product.no)}번`

  return (
    <View role="group" aria-label={CLAIM_ADD} style={{ gap: SPACE.xs }}>
      <IconMenuRow emoji="✉️" tint="#EAF1F7" title={busy === '' ? CLAIM_ADD_BUSY : CLAIM_ADD_PLAIN} ariaLabel={`${no}에 ${CLAIM_ADD_PLAIN}으로 넣기`} testID="claim-add-plain" onPress={() => void send(null)} />
      {recent.length === 0 ? null : (
        <View role="group" aria-label={CLAIM_ADD_RECENT} style={{ gap: SPACE.xs }}>
          <View style={{ paddingHorizontal: SPACE.sm, paddingTop: SPACE.sm }}><Txt step="caption" color="textSub">{CLAIM_ADD_RECENT}</Txt></View>
          {recent.map((item) => {
            const label = api.names.name(item.buyer)
            return (
              <IconMenuRow key={item.buyer} emoji="💬" tint="#EEF0EC" title={busy === item.buyer ? CLAIM_ADD_BUSY : label} subtitle={item.snippet}
                ariaLabel={`${label} 손님으로 ${no}에 ${CLAIM_ADD}`} onPress={() => void send(item.buyer)} />
            )
          })}
        </View>
      )}
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <View style={{ paddingTop: SPACE.sm }}>
        <BigButton kind="outline" label="닫기" disabled={busy !== null} onPress={onClose} />
      </View>
    </View>
  )
}
