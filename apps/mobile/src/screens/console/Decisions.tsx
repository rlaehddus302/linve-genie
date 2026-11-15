// 방송 중 정하기 (D-APPX-03 — 웹 AlertDialogs와 같은 규칙·문구, AC-S05-31~33, ORD-07, ORD-10, R-7, R-8, D-087, D-O1-01·02, D-O2-09).
// 충돌: "그대로 유지"(앞선 찜은 대기로) · "바꾸기"(앞선 찜이 1등, 지금 1등은 대기 1순위). 취소 요청: "취소 승인" · "요청 무시"
// (옵션을 적지 않은 요청은 취소할 찜을 먼저 고른다). 승계: 대기자 중 1등으로 올리기(사유) 또는 다시 판매(대기자 정리, 사유).
// 고른 조치는 5초 뒤에 보낸다(되돌리기 — 방송 화면 띠). 정할 것이 여러 개면 첫 번째부터. product를 주면 그 상품 것만.
// 손님이 번호 없이 "패스"라고 썼는데 찜이 둘 이상이면(D-RETRO-103·113) 엔진이 그 찜마다 같은 seq의 취소 요청을 건다 — 한 장으로 묶어
// "○○님이 패스라고 썼어요"와 그 손님의 찜을 보이고, 고른 찜만 취소(나머지 요청은 무시)하거나 모두 그대로 둔다. 단추는 [취소하지 않기 | 고른 찜 취소].
import { useState } from 'react'
import { View } from 'react-native'
import type { CancelRequest, Claim, Product } from '@livejjim/web/src/api/types.ts'
import type { UndoQueue } from '@livejjim/web/src/lib/undo-queue.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import { ORIGIN_WORD, QUICK_REASONS } from '@livejjim/web/src/lib/words.ts'
import { claimOptionsField, claimWord, conflictUnits, nameOf, productSlots, successionUnits, variantOf, variantOptionsField, type DecisionUnit } from '../../lib/derive.ts'
import { Pill } from '../../ui/day-pills.tsx'
import { EmptyFill } from '../../ui/kit/index.ts'
import { BigButton, Body, Field, Hint, Notice, Row } from '../../ui/parts.tsx'
import { useConsoleApi, type ConsoleApi } from './context.ts'

export const NOTHING_TO_DECIDE = '지금 정할 것이 없어요.'

const labelOf = (api: ConsoleApi, b: string, no: number): string => {
  const many = api.data.broadcasts.size > 1
  const title = api.data.broadcasts.get(b)?.title
  return many && title !== undefined && b !== api.b ? `${title} ${String(no)}번` : `${String(no)}번`
}

/** 1등의 취소를 승인하면 어떻게 되는지 (그 방송의 승계 설정, R-8) — 웹 successionNote와 같은 문장 */
export function successionNote(api: ConsoleApi, product: Product | undefined, claim: Claim | undefined): string | null {
  if (product === undefined || claim === undefined || claim.status !== 'CONFIRMED') return null
  const settings = api.data.broadcasts.get(product.broadcast)?.settings
  const mode = settings?.['cancel.succession'] ?? 'AUTO'
  const waitlist = claim.variant === null ? product.waitlist.length : (variantOf(product, claim)?.waitlist.length ?? 0)
  if (waitlist === 0) return '승인하면 1등 자리가 비고 다시 판매 중이 돼요.'
  if (mode === 'REOPEN') return `승인하면 대기자 ${String(waitlist)}명이 모두 정리되고 다시 판매 중이 돼요.`
  if (mode === 'ASK' && settings?.['waitlist.max'] !== 0) return '승인하면 대기자 중 누구를 1등으로 올릴지 정해야 해요(승계 결정 필요).'
  return '승인하면 대기 1순위가 1등이 돼요'
}

/** 정할 것이 있는가 (그 상품만 보려면 product) */
export function hasDecisions(api: ConsoleApi, product?: Product): boolean {
  const products = product === undefined ? [...api.data.products.values()] : [product]
  return products.some((item) => conflictUnits(item).length > 0 || successionUnits(item).length > 0) || [...api.data.cancelRequests.values()].some((request) => product === undefined || request.product === product.key)
}

export function DecisionsView({ queue, product, onQueued }: { readonly queue: UndoQueue; readonly product?: Product; readonly onQueued: () => void }) {
  const api = useConsoleApi()
  const products = product === undefined ? [...api.data.products.values()] : [product]
  const conflict = products.flatMap((item) => conflictUnits(item)).find((unit) => unit.variant === undefined)
  const variantConflicts = products.flatMap((item) => conflictUnits(item)).filter((unit) => unit.variant !== undefined)
  const requests = [...api.data.cancelRequests.values()].filter((request) => product === undefined || request.product === product.key).sort((a, b) => a.seq - b.seq)
  const succession = products.flatMap((item) => successionUnits(item))[0]
  const queueHost = (label: string, event: Readonly<Record<string, unknown>>) => {
    queue.add({ label, send: (requestId) => api.command(event, requestId) })
    onQueued()
  }
  if (conflict === undefined && variantConflicts.length === 0 && requests.length === 0 && succession === undefined) return <EmptyFill title={NOTHING_TO_DECIDE} />
  const request = requests[0]
  // 패스 묶음은 그 상품만 볼 때도 묶음 전체(다른 번호의 찜 포함)로 보인다 — 고를 찜이 모두 보여야 한다
  const pass = request === undefined ? null : passGroup([...api.data.cancelRequests.values()], request)
  return (
    <View style={{ gap: 16 }}>
      {conflict !== undefined ? <ConflictBody unit={conflict} queueHost={queueHost} /> : null}
      {variantConflicts.map((unit) => (
        <Notice key={unit.variant?.key ?? unit.product.key} tone="warning">{`${labelOf(api, unit.product.broadcast, unit.product.no)} ${unit.variant?.text ?? ''} 충돌 — 상품 자세히에서 그 변형의 찜을 취소하거나 거절해 정리해 주세요.`}</Notice>
      ))}
      {request !== undefined && pass !== null ? <PassBody key={`pass:${String(request.seq)}:${request.currentBuyer}`} group={pass} queueHost={queueHost} /> : null}
      {request !== undefined && pass === null ? <CancelBody key={request.claim} request={request} count={requests.length} queueHost={queueHost} /> : null}
      {succession !== undefined ? <SuccessionBody key={`${succession.product.key}|${succession.variant?.text ?? ''}`} unit={succession} queueHost={queueHost} /> : null}
    </View>
  )
}

type QueueHost = (label: string, event: Readonly<Record<string, unknown>>) => void

function ConflictBody({ unit, queueHost }: { readonly unit: DecisionUnit; readonly queueHost: QueueHost }) {
  const api = useConsoleApi()
  const { product } = unit
  const challenger = product.conflictClaim === null ? undefined : api.data.claims.get(product.conflictClaim)
  const winners = product.winnerClaims.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  const label = labelOf(api, product.broadcast, product.no)
  const decide = (decision: 'KEEP' | 'SWITCH') => queueHost(`${label} 충돌 ${decision === 'KEEP' ? '그대로 유지' : '바꾸기'}`, { type: 'host.resolveConflict', b: product.broadcast, no: product.no, decision })
  return (
    <View style={{ gap: 8 }} role="group" aria-label={`충돌 — ${label}`}>
      <Body bold>{`충돌 — ${label} ${nameOf(product)}`}</Body>
      <Body>늦게 확인된 앞선 찜이 있어요. 1등을 그대로 둘지 바꿀지 골라 주세요.</Body>
      <Body>{`지금 1등: ${winners.length === 0 ? '아직 없음' : winners.map((claim) => `${api.names.name(claim.currentBuyer)} · ${ORIGIN_WORD[claim.origin]}`).join(', ')}`}</Body>
      <Body>{`앞선 찜: ${challenger === undefined ? '알 수 없음' : `${api.names.name(challenger.currentBuyer)} · ${ORIGIN_WORD[challenger.origin]} · ${kstTime(challenger.rankTime)}${challenger.rankMinute ? ' 무렵' : ''}`}`}</Body>
      <Row>
        <BigButton primary label="그대로 유지" onPress={() => decide('KEEP')} />
        <BigButton danger label="바꾸기" onPress={() => decide('SWITCH')} />
      </Row>
      <Hint>그대로 유지: 앞선 찜은 대기로 가요. 바꾸기: 앞선 찜이 1등이 되고 지금 1등은 대기 1순위로 가요.</Hint>
    </View>
  )
}

/**
 * 번호 없는 "패스"로 생긴 요청 묶음 (D-RETRO-113): request와 같은 손님·같은 seq의 찜 요청(변형을 정하지 않은 요청 제외)이 둘 이상이면 그 요청들(seq·찜 순), 아니면 null.
 * 한 메시지가 둘 이상의 찜에 같은 seq의 요청을 거는 것은 엔진에서 번호 없는 패스뿐이다(번호 취소는 번호 하나).
 */
export function passGroup(all: readonly CancelRequest[], request: CancelRequest): CancelRequest[] | null {
  if (request.chooseVariant) return null
  const group = all.filter((item) => !item.chooseVariant && item.seq === request.seq && item.currentBuyer === request.currentBuyer)
  return group.length >= 2 ? group.sort((a, b) => (a.claim < b.claim ? -1 : a.claim > b.claim ? 1 : 0)) : null
}

export const PASS_KEEP = '취소하지 않기'
export const PASS_CANCEL = '고른 찜 취소'
export const passWords = (name: string): string => `${name}님이 채팅에 "패스"라고 썼어요. 찜이 여러 개라 어느 찜인지 몰라 아직 취소하지 않았어요.`

function PassBody({ group, queueHost }: { readonly group: readonly CancelRequest[]; readonly queueHost: QueueHost }) {
  const api = useConsoleApi()
  const [chosen, setChosen] = useState<string | null>(null)
  const first = group[0] as CancelRequest
  const name = api.names.name(first.currentBuyer)
  const claims = group.map((request) => api.data.claims.get(request.claim)).filter((claim): claim is Claim => claim !== undefined)
  const picked = claims.find((claim) => claim.id === chosen)
  const pickedProduct = picked === undefined ? undefined : api.data.products.get(picked.product)
  const note = successionNote(api, pickedProduct, picked)
  const event = (type: 'host.approveCancel' | 'host.dismissCancel', claim: Claim) => ({ type, b: claim.broadcast, no: claim.no, buyer: first.currentBuyer, ...claimOptionsField(claim) })
  const what = (claim: Claim): string => {
    const product = api.data.products.get(claim.product)
    return [labelOf(api, claim.broadcast, claim.no), product === undefined ? '' : nameOf(product)].filter((part) => part !== '').join(' ')
  }
  const keepAll = () => {
    for (const claim of claims) queueHost(`${what(claim)} ${name} 취소하지 않기`, event('host.dismissCancel', claim))
  }
  const cancelPicked = () => {
    if (picked === undefined) return
    queueHost(`${what(picked)} ${name} 취소 승인`, event('host.approveCancel', picked))
    for (const claim of claims) if (claim.id !== picked.id) queueHost(`${what(claim)} ${name} 취소하지 않기`, event('host.dismissCancel', claim))
  }
  return (
    <View style={{ gap: 8 }} role="group" aria-label={`패스 — ${name}`}>
      <Body bold>{`패스 — ${name}`}</Body>
      <Body>{passWords(name)}</Body>
      <Hint>취소할 찜을 고르면 그 찜만 취소하고 나머지는 그대로 둬요.</Hint>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {claims.map((claim) => {
          const words = `${what(claim)} · ${claimWord(api.data, claim)}`
          return <Pill key={claim.id} on={chosen === claim.id} label={words} ariaLabel={`취소할 찜 ${words}`} onPress={() => setChosen(claim.id)} />
        })}
      </View>
      {note !== null ? <Notice tone="warning">{note}</Notice> : null}
      {/* 부정은 왼쪽 · 긍정은 오른쪽 (D-UX4-01) */}
      <Row>
        <BigButton label={PASS_KEEP} onPress={keepAll} />
        <BigButton danger label={PASS_CANCEL} disabled={picked === undefined} onPress={cancelPicked} />
      </Row>
    </View>
  )
}

function CancelBody({ request, count, queueHost }: { readonly request: CancelRequest; readonly count: number; readonly queueHost: QueueHost }) {
  const api = useConsoleApi()
  const [chosen, setChosen] = useState<string | null>(null)
  const name = api.names.name(request.currentBuyer)
  if (request.chooseVariant) {
    const choices = request.choices.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
    const first = choices[0]
    const product = api.data.products.get(request.product) ?? (first === undefined ? undefined : api.data.products.get(first.product))
    const b = first?.broadcast ?? product?.broadcast ?? api.b
    const no = first?.no ?? product?.no ?? 0
    const label = labelOf(api, b, no)
    const picked = choices.find((claim) => claim.id === chosen)
    const note = successionNote(api, product, picked)
    return (
      <View style={{ gap: 8 }} role="group" aria-label={`취소 요청 — ${label}`}>
        <Body bold>{`취소 요청 — ${label} ${product === undefined ? '' : nameOf(product)}`}</Body>
        {count > 1 ? <Hint>{`취소 요청 ${String(count)}개 중 첫 번째예요.`}</Hint> : null}
        <Body>{`${name}님이 어느 옵션을 취소할지 적지 않았어요. 취소할 찜을 골라 주세요.`}</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {choices.map((claim) => {
            const words = `${claim.variant ?? '옵션 없음'}${claim.qty > 1 ? ` ${String(claim.qty)}개` : ''} · ${claimWord(api.data, claim)}`
            return <Pill key={claim.id} on={chosen === claim.id} label={words} ariaLabel={`취소할 찜 ${words}`} onPress={() => setChosen(claim.id)} />
          })}
        </View>
        {picked === undefined ? <Hint>찜을 고르면 "고른 찜 취소"를 누를 수 있어요.</Hint> : null}
        {note !== null ? <Notice tone="warning">{note}</Notice> : null}
        <Row>
          <BigButton danger label="고른 찜 취소" disabled={picked === undefined} onPress={() => (picked === undefined ? undefined : queueHost(`${label} ${picked.variant ?? ''} ${name} 취소 승인`.replace(/\s+/g, ' '), { type: 'host.approveCancel', b, no, buyer: request.currentBuyer, ...claimOptionsField(picked) }))} />
          <BigButton label="취소하지 않기" onPress={() => queueHost(`${label} ${name} 취소하지 않기`, { type: 'host.dismissCancel', b, no, buyer: request.currentBuyer, ...(first === undefined ? {} : claimOptionsField(first)) })} />
        </Row>
      </View>
    )
  }
  const claim = api.data.claims.get(request.claim)
  const product = api.data.products.get(request.product) ?? (claim === undefined ? undefined : api.data.products.get(claim.product))
  const no = claim?.no ?? product?.no ?? 0
  const b = claim?.broadcast ?? product?.broadcast ?? api.b
  const label = labelOf(api, b, no)
  const note = successionNote(api, product, claim)
  const decide = (type: 'host.approveCancel' | 'host.dismissCancel') => queueHost(`${label} ${name} ${type === 'host.approveCancel' ? '취소 승인' : '취소 요청 무시'}`, { type, b, no, buyer: request.currentBuyer, ...(claim === undefined ? {} : claimOptionsField(claim)) })
  return (
    <View style={{ gap: 8 }} role="group" aria-label={`취소 요청 — ${label}`}>
      <Body bold>{`취소 요청 — ${label} ${product === undefined ? '' : nameOf(product)}`}</Body>
      {count > 1 ? <Hint>{`취소 요청 ${String(count)}개 중 첫 번째예요.`}</Hint> : null}
      <Body>{`요청한 사람: ${name}`}</Body>
      <Body>{`지금 상태: ${claim === undefined ? '알 수 없음' : claimWord(api.data, claim)}`}</Body>
      {note !== null ? <Notice tone="warning">{note}</Notice> : null}
      <Row>
        <BigButton danger label="취소 승인" onPress={() => decide('host.approveCancel')} />
        <BigButton label="요청 무시" onPress={() => decide('host.dismissCancel')} />
      </Row>
    </View>
  )
}

function SuccessionBody({ unit, queueHost }: { readonly unit: DecisionUnit; readonly queueHost: QueueHost }) {
  const api = useConsoleApi()
  const { product, variant } = unit
  const [asking, setAsking] = useState<{ readonly kind: 'promote'; readonly claim: Claim } | { readonly kind: 'reopen' } | null>(null)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const label = `${labelOf(api, product.broadcast, product.no)}${variant === undefined ? '' : ` ${variant.text}`}`
  const options = variantOptionsField(variant)
  const waiters = unit.waitlistClaims.map((id) => api.data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
  const waitlist = variant === undefined ? productSlots(product).waitlist.length : variant.waitlist.length
  const submit = () => {
    const value = reason.trim()
    if (value === '' || asking === null) return setProblem('사유를 적어 주세요.')
    if (asking.kind === 'promote') {
      const name = api.names.name(asking.claim.currentBuyer)
      queueHost(`${label} ${name} 1등으로`, { type: 'host.promote', b: product.broadcast, no: product.no, buyer: asking.claim.currentBuyer, reason: value, ...options })
    } else {
      queueHost(`${label} 다시 판매(대기자 정리)`, { type: 'host.reopen', b: product.broadcast, no: product.no, reason: value, ...options })
    }
    setAsking(null)
    setReason('')
    setProblem(null)
  }
  return (
    <View style={{ gap: 8 }} role="group" aria-label={`승계 결정 — ${label}`}>
      <Body bold>{`승계 결정 — ${label} ${nameOf(product)}`}</Body>
      <Body>1등 자리가 비었어요. 대기자 중 1등으로 올릴 사람을 고르거나, 대기자를 정리하고 다시 판매해 주세요.</Body>
      {asking === null ? (
        <>
          {waiters.map((claim, index) => {
            const name = api.names.name(claim.currentBuyer)
            return (
              <Row key={claim.id}>
                <View style={{ flex: 1 }}>
                  <Body>{`대기 ${String(index + 1)}번 ${name}`}</Body>
                </View>
                <BigButton small label={`${name} 1등으로`} onPress={() => setAsking({ kind: 'promote', claim })} />
              </Row>
            )
          })}
          <BigButton danger label="다시 판매(대기자 정리)" onPress={() => setAsking({ kind: 'reopen' })} />
        </>
      ) : (
        <View style={{ gap: 8 }}>
          <Body bold>{asking.kind === 'promote' ? `${label} ${api.names.name(asking.claim.currentBuyer)} 1등으로` : `${label} 다시 판매(대기자 정리)`}</Body>
          {asking.kind === 'reopen' ? <Notice tone="warning">{`대기자 ${String(waitlist)}명이 모두 정리돼요`}</Notice> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {QUICK_REASONS.map((word) => (
              <Pill key={word} on={reason === word} label={word} ariaLabel={`사유 ${word}`} onPress={() => setReason(word)} />
            ))}
          </View>
          <Field label="사유" value={reason} onChangeText={setReason} problem={problem} />
          <Row>
            <BigButton primary={asking.kind === 'promote'} danger={asking.kind === 'reopen'} label={asking.kind === 'promote' ? '1등으로 올리기' : '다시 판매하기'} onPress={submit} />
            <BigButton label="안 바꾸기" onPress={() => setAsking(null)} />
          </Row>
        </View>
      )}
    </View>
  )
}
