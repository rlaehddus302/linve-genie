// 문자찜 넣기 (D-APPX-03 — 웹 SmsPage와 같은 칸·규칙, ORD-08, R-5·R-6, D-099, D-SMS-01, AC-S06-10~15). 방송 화면 아래 칸이다.
// 칸: 번호 · 받은 시각(선택, 비우면 서버가 도착 시각) · 전화번호(선택, 구매자를 골랐으면 보내지 않는다) · 메모(선택) · 구매자 고르기(선택)
// · 옵션 상품이면 옵션·수량. 번호·받은 시각·전화번호는 친 글 원문 그대로 보낸다 — 서버가 읽고, 못 읽으면 그 문장으로 거절한다(SRV1 D-APP-24).
// 보내는 동안 칸을 잠그고, 같은 칸이면 같은 요청 번호로 다시 보낸다(두 번 기록되지 않는다). 되면 칸을 비운다(전화번호를 화면에 남기지 않는다).
// 결과 카드는 찜의 지금 상태(VoiceSmsResult — 찜 취소 5초 대기·되돌리기)와 "같은 사람 하나 더"(응답의 구매자 — 뒤 4자리로 짐작하지 않는다).
import { useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { SmsResultLine } from '@livejjim/web/src/voice/model.ts'
import { pickFor, qtyProblemWords, readQty, variantTextOf } from '@livejjim/web/src/lib/review-pick.ts'
import { isApiError, newRequestId, withRetry, type ApiError } from '../../api/client.ts'
import { boardProducts } from '../../lib/derive.ts'
import { Pill } from '../../ui/day-pills.tsx'
import { BigButton, Body, Card, Field, Hint, Notice, Row } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'
import { VoiceSmsResult } from './VoiceSmsResult.tsx'

export const SMS_LOCKED = '보내는 중이라 잠시 고칠 수 없어요.'
export const RECEIVED_HELP_APP = '비우면 지금 받은 것으로 해요. 예: 20:01 또는 20:01:05'
export const NO_REQUIRED = '상품 번호를 적어 주세요.'
const MAX_SEARCH = 8
const DEFAULT_MAX_QTY = 10

interface Fields {
  readonly no: string
  readonly received: string
  readonly phone: string
  readonly memo: string
  readonly buyer: string | null
  readonly options: Readonly<Record<string, string>>
  readonly qty: string
}

const EMPTY: Fields = { no: '', received: '', phone: '', memo: '', buyer: null, options: {}, qty: '' }

export function SmsForm() {
  const api = useConsoleApi()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [localProblem, setLocalProblem] = useState<string | null>(null)
  const [results, setResults] = useState<readonly SmsResultLine[]>([])
  const pending = useRef<{ key: string; requestId: string } | null>(null)

  const products = useMemo(() => boardProducts(api.data, api.b), [api.data, api.b])
  const typedNo = Number(fields.no.trim())
  const product = Number.isSafeInteger(typedNo) ? products.find((item) => item.no === typedNo) : undefined
  const hasOptions = product !== undefined && product.options.length > 0
  const maxQty = api.data.broadcasts.get(api.b)?.settings['claim.maxQuantity'] ?? DEFAULT_MAX_QTY
  const qtyBad = fields.qty.trim() !== '' && readQty(fields.qty, maxQty) === null
  const buyers = useMemo(() => {
    const term = search.trim()
    if (term === '') return []
    const out: { id: string; name: string }[] = []
    for (const buyer of api.data.buyers.values()) {
      if (buyer.current !== buyer.id) continue
      const name = api.names.name(buyer.id)
      if (name.includes(term) || buyer.phoneLast4 === term) out.push({ id: buyer.id, name })
      if (out.length >= MAX_SEARCH) break
    }
    return out
  }, [search, api.data.buyers, api.names])

  if (api.ended || api.sealed) return null

  const set = (patch: Partial<Fields>) => {
    if (busy) return
    setError(null)
    setLocalProblem(null)
    setFields((current) => ({ ...current, ...patch }))
  }

  const send = async () => {
    const no = fields.no.trim()
    if (busy) return
    if (no === '') {
      setError(null)
      setLocalProblem(NO_REQUIRED)
      return
    }
    setLocalProblem(null)
    const qty = hasOptions ? readQty(fields.qty.trim() === '' ? '1' : fields.qty, maxQty) : null
    if (hasOptions && (qty === null || variantTextOf(product, fields.options) === null)) {
      setLocalProblem(qty === null ? qtyProblemWords(maxQty) : '옵션을 모두 골라 주세요.')
      return
    }
    const event = {
      type: 'sms',
      b: api.b,
      noText: no,
      ...(fields.received.trim() === '' ? {} : { receivedText: fields.received.trim() }),
      ...(fields.buyer === null && fields.phone.trim() !== '' ? { phone: fields.phone.trim() } : {}),
      ...(fields.memo.trim() === '' ? {} : { memo: fields.memo.trim() }),
      ...(fields.buyer === null ? {} : { buyer: fields.buyer }),
      ...(hasOptions ? { qty, options: { ...fields.options } } : {}),
    }
    const key = JSON.stringify(event)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setError(null)
    try {
      const written = await withRetry(() => api.command(event, requestId))
      pending.current = null
      setResults((list) => [{ no: typedNo, seq: written.seq, buyer: written.buyer ?? null }, ...list].slice(0, 3))
      setFields(EMPTY)
      setSearch('')
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card label="문자찜">
      <Body bold>문자찜</Body>
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="번호" value={fields.no} editable={!busy} onChangeText={(no) => set({ no, options: pickFor(products.find((item) => item.no === Number(no.trim())), []), qty: '' })} inputMode="numeric" keyboardType="number-pad" placeholder="15" problem={error?.problemFor('noText')?.message ?? error?.problemFor('no')?.message ?? localProblem} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="받은 시각 (선택)" value={fields.received} editable={!busy} onChangeText={(received) => set({ received })} keyboardType="numbers-and-punctuation" placeholder="20:01" problem={error?.problemFor('receivedText')?.message ?? null} />
        </View>
      </Row>
      <Hint>{RECEIVED_HELP_APP}</Hint>
      {hasOptions ? (
        <View style={{ gap: 6 }}>
          {product.options.map((item) => (
            <View key={item.name} style={{ gap: 4 }}>
              <Hint>{item.name}</Hint>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {item.choices.map((choice) => (
                  <Pill key={choice.label} on={fields.options[item.name] === choice.label} label={choice.label} ariaLabel={`문자찜 ${item.name} ${choice.label}`} onPress={() => set({ options: { ...fields.options, [item.name]: choice.label } })} />
                ))}
              </ScrollView>
            </View>
          ))}
          <Field label="수량" value={fields.qty} editable={!busy} onChangeText={(qty) => set({ qty: qty.replace(/[^\d]/g, '').slice(0, 3) })} keyboardType="number-pad" placeholder="1" problem={qtyBad ? qtyProblemWords(maxQty) : null} />
        </View>
      ) : null}
      {fields.buyer === null ? (
        <Field label="전화번호 (선택)" value={fields.phone} editable={!busy} onChangeText={(phone) => set({ phone })} inputMode="tel" keyboardType="phone-pad" placeholder="010-1234-5678" problem={error?.problemFor('phone')?.message ?? null} />
      ) : (
        <Row>
          <View style={{ flex: 1 }}>
            <Body>{`구매자: ${api.names.name(fields.buyer)}`}</Body>
          </View>
          <BigButton label="구매자 고르기 풀기" small onPress={() => set({ buyer: null })} />
        </Row>
      )}
      <Field label="메모 (선택)" value={fields.memo} editable={!busy} onChangeText={(memo) => set({ memo })} problem={error?.problemFor('memo')?.message ?? null} />
      {fields.buyer === null ? (
        <View style={{ gap: 6 }}>
          <Field label="구매자 찾기 (선택)" value={search} editable={!busy} onChangeText={setSearch} placeholder="이름 또는 뒤 4자리" />
          {buyers.map((buyer) => (
            <BigButton key={buyer.id} label={buyer.name} ariaLabel={`구매자 ${buyer.name} 고르기`} small onPress={() => {
              set({ buyer: buyer.id, phone: '' })
              setSearch('')
            }} />
          ))}
        </View>
      ) : null}
      {busy ? <Hint>{SMS_LOCKED}</Hint> : null}
      <BigButton primary label={fields.no.trim() === '' ? '문자찜 넣기' : `${fields.no.trim()}번에 문자찜 넣기`} disabled={busy} onPress={() => void send()} />
      {error !== null && error.problems.length === 0 ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {results.map((line) => (
        <View key={`${String(line.no)}-${String(line.seq)}`} style={{ gap: 6 }}>
          <VoiceSmsResult line={line} />
          {line.buyer !== null ? <BigButton label="같은 사람 하나 더" small disabled={busy} onPress={() => set({ buyer: line.buyer, no: '', phone: '' })} /> : null}
        </View>
      ))}
    </Card>
  )
}
