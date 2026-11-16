// 상품 자세히의 [찜 넣기] (D-RETRO-54, 복기 F7 — 사용자 지시 2026-11-12 "상품 목록에서 상품을 눌러 임의로 문자찜을 등록하는 기능").
// 손님 이름이나 전화번호 끝 네 자리(둘 다도 된다)를 적거나 이미 있는 손님을 골라 그 상품에 문자찜을 넣는다 — 음성 문자찜("165번 문자찜 끝자리 1234")과 같은 서버 길(sms 쓰기).
// - 앱은 판정하지 않는다: 먼저 찜한 손님이 있으면 대기로 들어가는 것도, 같은 손님 반복이라 찜이 생기지 않는 것도 서버 결과 그대로 보인다.
// - 전화번호 전체는 받지 않는다(칸이 숫자 네 개만 받는다). 끝 네 자리가 같은 손님이 여럿이면 서버가 후보를 주고, 여기서 고르거나 새 손님으로 넣는다.
// - 닉네임·이름은 글자로만 그리고 이름 표기(닉네임 뒤 영문 숨기기 설정)를 따른다. 적은 값은 넣은 뒤 지우고 로그에 남기지 않는다.
// - 최근 채팅 손님 (D-CLAIMADD-01, 사용자 지시 2026-11-16 "최근 채팅 친 사람 보여줘서 버튼을 눌러서 바로 등록"): 이 방송의 최근 채팅을 친 손님을
//   새 메시지부터 캡슐로 보이고, 누르면 그 손님(지정 구매자)으로 바로 문자찜을 넣는다 — 지금 시각의 문자찜이라 먼저 찜한 손님이 있으면 대기로 간다.
// - 아무것도 적지 않으면 오른쪽 단추가 [문자찜으로 넣기] — 이름·번호 없이 "문자찜" 손님으로 넣는다 (D-CLAIMADD-02, 같은 지시 "문자찜 버튼 눌러서 넣도록").
// - 단추는 한 줄 [닫기 | 찜 넣기] (부정 왼쪽·긍정 오른쪽, D-UX4-01).
import { useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { ChatMessage, Product } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { claimsOfProduct } from '../../lib/derive.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { BigButton, ButtonRow, ErrorLine, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { Field, Notice } from '../../ui/parts.tsx'
import { ACTIVE_CLAIM, addSmsClaim, smsClaimEvent, type SmsCandidate, type SmsClaimInput } from './claim-actions.ts'
import { useMessages } from './ChatPaste.tsx'
import { useConsoleApi, type ConsoleApi } from './context.ts'
import { feedBuyerName, noWord } from './feed-rows.ts'
import { NamePill } from './parts.tsx'

export const CLAIM_ADD = '찜 넣기'
export const CLAIM_ADD_NAME = '손님 이름'
export const CLAIM_ADD_LAST4 = '전화번호 끝 네 자리'
export const CLAIM_ADD_HELP = '아무것도 적지 않으면 "문자찜"으로 들어가요. 먼저 찜한 손님이 있으면 대기로 들어가요.'
export const CLAIM_ADD_PLAIN = '문자찜으로 넣기'
export const CLAIM_ADD_RECENT = '최근 채팅 손님'
export const CLAIM_ADD_RECENT_HINT = '누르면 그 손님으로 바로 넣어요'
/** 최근 채팅 손님 수 */
export const CLAIM_ADD_RECENT_MAX = 8
/** 최근 채팅 손님 캡슐에 붙이는 채팅 앞부분 글자 수 */
const RECENT_SNIPPET = 10
export const CLAIM_ADD_LAST4_SHORT = '끝 네 자리는 숫자 네 개로 적어 주세요.'
export const CLAIM_ADD_PICK_HINT = '이미 있는 손님이면 눌러서 골라 주세요'
export const CLAIM_ADD_NEW_BUYER = '새 손님으로 넣기'
export const CLAIM_ADD_REPICK = '다시 고르기'
export const CLAIM_ADD_NO_CLAIM = '새 찜이 생기지 않았어요. 이미 찜한 손님인지 확인해 주세요.'
export const CLAIM_ADD_FAILED = '찜을 넣지 못했어요. 다시 눌러 주세요.'
/** 이름 칸 길이 (문자 손님 표시 이름 "문자찜(이름)"에 들어간다) */
const NAME_MAX = 20
/** 고를 손님 후보 수 */
export const CLAIM_ADD_SUGGESTIONS = 6

/** 끝 네 자리 칸: 숫자만 네 개까지 (전각 숫자는 반각으로) */
export const last4Digits = (text: string): string => text.normalize('NFKC').replace(/\D/g, '').slice(0, 4)

/** 넣은 뒤 한 줄: "넣었어요 — 문자-0937 · 대기 1" (찜 기록 꼬리표와 같은 낱말) */
export interface ClaimAdded {
  readonly tone: 'success' | 'warning'
  readonly text: string
}

/**
 * 적은 이름·끝 네 자리에 맞는 이미 있는 손님 (그 상품에 살아 있는 찜이 없는 손님만, 합쳐진 손님은 지금의 손님으로).
 * 이름은 화면에 보이는 이름 표기에 그 글이 들어 있는지, 끝 네 자리는 네 개를 다 적었을 때 문자 손님의 끝 네 자리가 같은지 본다
 */
export function addSuggestions(data: ScopeData, names: ConsoleApi['names'], product: Product, name: string, last4: string): string[] {
  const query = name.trim().toLowerCase()
  if (query === '' && last4.length !== 4) return []
  const taken = new Set(claimsOfProduct(data, product).filter((claim) => ACTIVE_CLAIM.has(claim.status)).map((claim) => claim.currentBuyer))
  const out: string[] = []
  for (const buyer of data.buyers.values()) {
    if (buyer.mergedInto !== null || buyer.blocked || taken.has(buyer.id)) continue
    const byName = query !== '' && names.name(buyer.id).toLowerCase().includes(query)
    const byLast4 = last4.length === 4 && buyer.kind === 'sms' && buyer.phoneLast4 === last4
    if (!byName && !byLast4) continue
    out.push(buyer.id)
    if (out.length >= CLAIM_ADD_SUGGESTIONS) break
  }
  return out
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
  const [name, setName] = useState('')
  const [last4, setLast4] = useState('')
  const [buyer, setBuyer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ambiguous, setAmbiguous] = useState<{ readonly message: string; readonly candidates: readonly SmsCandidate[] } | null>(null)
  // 같은 내용을 다시 누르면 같은 요청 번호 — 응답을 못 받고 다시 눌러도 찜이 둘 생기지 않는다
  const request = useRef<{ readonly signature: string; readonly id: string } | null>(null)
  const suggestions = useMemo(() => (buyer === null ? addSuggestions(api.data, api.names, product, name, last4) : []), [api.data, api.names, product, name, last4, buyer])
  const { view: chat } = useMessages()
  const recent = useMemo(() => (chat === null ? [] : recentChatBuyers(api.data, chat.messages, product)), [api.data, chat, product])
  const empty = buyer === null && name.trim() === '' && last4 === ''
  const addLabel = empty ? CLAIM_ADD_PLAIN : CLAIM_ADD

  const send = async (input: SmsClaimInput) => {
    if (busy) return
    if (input.buyer === null && input.last4 !== '' && input.last4.length !== 4) {
      setError(CLAIM_ADD_LAST4_SHORT)
      return
    }
    const signature = JSON.stringify(smsClaimEvent(product, input))
    if (request.current?.signature !== signature) request.current = { signature, id: newRequestId() }
    setBusy(true)
    setError(null)
    try {
      const outcome = await addSmsClaim(api, product, input, request.current.id)
      if (outcome.kind === 'ambiguous') {
        setAmbiguous({ message: outcome.message, candidates: outcome.candidates })
        return
      }
      request.current = null
      const data = api.latest?.() ?? api.data
      // 적은 값은 화면에 남기지 않는다
      setName('')
      setLast4('')
      setBuyer(null)
      setAmbiguous(null)
      onAdded(addedLine(data, api.names, outcome.result.seq))
    } catch (caught) {
      setError(isApiError(caught) ? [caught.message, ...caught.problems.map((problem) => problem.message)].filter((part, index, all) => part !== '' && all.indexOf(part) === index).join(' ') : CLAIM_ADD_FAILED)
    } finally {
      setBusy(false)
    }
  }
  const typed = (): SmsClaimInput => ({ name, last4, buyer })
  const pick = (id: string) => {
    setBuyer(id)
    setAmbiguous(null)
    setError(null)
  }

  return (
    <View role="group" aria-label={CLAIM_ADD} style={{ gap: SPACE.md }}>
      <Txt step="bodyLarge" weight="bold" role="heading" aria-level={2}>{`${String(product.no)}번에 ${CLAIM_ADD}`}</Txt>
      {buyer !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm }}>
          <Txt color="textSub">고른 손님</Txt>
          <NamePill text={feedBuyerName(api.data, api.names, buyer)} tone="wait" ariaLabel={`고른 손님 ${feedBuyerName(api.data, api.names, buyer)}`} />
          <NamePill text={CLAIM_ADD_REPICK} tone="wait" square ariaLabel={CLAIM_ADD_REPICK} onPress={() => setBuyer(null)} />
        </View>
      ) : (
        <>
          {recent.length === 0 ? null : (
            <View role="group" aria-label={CLAIM_ADD_RECENT} style={{ gap: SPACE.xs }}>
              <Txt step="caption" color="textSub">{`${CLAIM_ADD_RECENT} · ${CLAIM_ADD_RECENT_HINT}`}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
                {recent.map((item) => {
                  const label = api.names.name(item.buyer)
                  const text = item.snippet === '' ? label : `${label} · ${item.snippet}`
                  return <NamePill key={item.buyer} text={text} tone="wait" ariaLabel={`${label} 손님으로 ${String(product.no)}번에 ${CLAIM_ADD}`} onPress={() => void send({ name: '', last4: '', buyer: item.buyer })} />
                })}
              </View>
            </View>
          )}
          <Field label={CLAIM_ADD_NAME} value={name} maxLength={NAME_MAX} editable={!busy} returnKeyType="done" autoCorrect={false} onChangeText={(text) => { setName(text); setAmbiguous(null); setError(null) }} />
          <Field label={CLAIM_ADD_LAST4} value={last4} maxLength={4} editable={!busy} keyboardType="number-pad" inputMode="numeric" returnKeyType="done" onChangeText={(text) => { setLast4(last4Digits(text)); setAmbiguous(null); setError(null) }} />
          {suggestions.length === 0 ? null : (
            <View role="group" aria-label="이미 있는 손님" style={{ gap: SPACE.xs }}>
              <Txt step="caption" color="textSub">{CLAIM_ADD_PICK_HINT}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
                {suggestions.map((id) => {
                  const label = api.names.name(id)
                  return <NamePill key={id} text={label} tone="wait" ariaLabel={`${label} 고르기`} onPress={() => pick(id)} />
                })}
              </View>
            </View>
          )}
        </>
      )}
      {ambiguous === null ? null : (
        <View role="group" aria-label="손님 고르기" style={{ gap: SPACE.sm }}>
          <Notice tone="warning">{ambiguous.message}</Notice>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
            {ambiguous.candidates.map((candidate) => {
              const label = api.names.name(candidate.buyer)
              const text = candidate.claims.length === 0 ? label : `${label} · ${candidate.claims.map(String).join(', ')}번`
              return <NamePill key={candidate.buyer} text={text} tone="wait" ariaLabel={`${label} 고르기`} onPress={() => void send({ name: '', last4: '', buyer: candidate.buyer })} />
            })}
            <NamePill text={CLAIM_ADD_NEW_BUYER} tone="pending" square ariaLabel={CLAIM_ADD_NEW_BUYER} onPress={() => void send({ name, last4, buyer: null, newBuyer: true })} />
          </View>
        </View>
      )}
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <Txt step="caption" color="textSub">{CLAIM_ADD_HELP}</Txt>
      <ButtonRow>
        <BigButton kind="outline" label="닫기" disabled={busy} onPress={onClose} />
        <BigButton label={addLabel} ariaLabel={`${String(product.no)}번에 ${addLabel}`} busy={busy} onPress={() => void send(typed())} />
      </ButtonRow>
    </View>
  )
}
