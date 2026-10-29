// 빠른 입력 한 줄 + 보내기 (AC-S05-10~13, PRD-01, D-084, 웹 QuickInput과 같은 규칙·문구).
// 한 줄 "15 핑크프릴 10000" → 그 번호가 없으면 등록, 있으면 "고칠까요?", 번호만이면 상품 자세히, 오류면 문장. 등록은 바로 기록하고 5초 동안 "되돌리기"(판매 종료).
// 문자찜 한 줄: 번호 + 전화번호(선택) → sms 이벤트(손 입력, D-V1-10 인식 문장은 없다).
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { productKey } from '../../lib/derive.ts'
import { decideQuickInput, editQuestion, quickSettings, registerPreview, unitLine, type QuickDecision } from '../../lib/quick.ts'
import { QUICK_PLACEHOLDER, QUICK_SEND, UNDO, UNDONE_REGISTER, formatWon } from '../../lib/words.ts'
import { BigButton, Body, Card, Field, Hint, Notice, Row } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

export const REGISTER_UNDO_MS = 5000

interface Ask {
  readonly product: Product
  readonly name: string
  readonly price: number
  readonly line: string
}

export function QuickInput() {
  const api = useConsoleApi()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<{ readonly no: number; readonly until: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settings = quickSettings(api.data.broadcasts.get(api.b)?.settings)
  const findProduct = (no: number) => api.data.products.get(productKey(api.b, no))

  useEffect(() => () => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
  }, [])

  const closed = api.ended || api.sealed
  const preview = closed ? null : registerPreview(text, settings, findProduct)

  const register = async (decision: Extract<QuickDecision, { kind: 'register' }>, line: string) => {
    setBusy(true)
    try {
      const result = await api.command({ type: 'product.register', b: api.b, no: decision.no, name: decision.name, price: decision.price }, newRequestId())
      if (!result.changed) {
        const existing = findProduct(decision.no)
        if (existing !== undefined) setAsk({ product: existing, name: decision.name, price: decision.price, line })
        return
      }
      setText((current) => (current === line ? '' : current))
      setNote(null)
      api.select(productKey(api.b, decision.no))
      if (undoTimer.current !== null) clearTimeout(undoTimer.current)
      setUndo({ no: decision.no, until: Date.now() + REGISTER_UNDO_MS })
      undoTimer.current = setTimeout(() => setUndo(null), REGISTER_UNDO_MS)
    } catch (caught) {
      setProblem(isApiError(caught) ? caught.message : '등록하지 못했어요. 다시 보내기를 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const send = () => {
    if (closed || busy) return
    const line = text
    setProblem(null)
    const decision = decideQuickInput(line, settings, findProduct)
    if (decision.kind === 'none') return
    if (decision.kind === 'fix') {
      setProblem(decision.message)
      return
    }
    if (decision.kind === 'open') {
      api.select(decision.product.key)
      setText('')
      return
    }
    if (decision.kind === 'edit') {
      setAsk({ product: decision.product, name: decision.name, price: decision.price, line })
      return
    }
    void register(decision, line)
  }

  const applyEdit = async () => {
    if (ask === null) return
    setBusy(true)
    try {
      const changes = { ...(ask.name !== '' && ask.name !== ask.product.name ? { name: ask.name } : {}), ...(ask.price !== ask.product.price ? { price: ask.price } : {}) }
      if (Object.keys(changes).length > 0) await api.command({ type: 'product.update', b: api.b, no: ask.product.no, ...changes })
      setText((current) => (current === ask.line ? '' : current))
      setAsk(null)
      api.select(ask.product.key)
    } catch (caught) {
      setProblem(isApiError(caught) ? caught.message : '고치지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const undoRegister = async () => {
    if (undo === null) return
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
    setUndo(null)
    try {
      await api.command({ type: 'product.close', b: api.b, no: undo.no })
      setNote(UNDONE_REGISTER)
    } catch (caught) {
      setProblem(isApiError(caught) ? caught.message : '되돌리지 못했어요.')
    }
  }

  if (closed) return null
  return (
    <Card label="빠른 입력">
      <Field label="빠른 입력" value={text} onChangeText={setText} placeholder={QUICK_PLACEHOLDER} autoCorrect={false} autoCapitalize="none" onSubmitEditing={send} returnKeyType="send" blurOnSubmit={false} problem={problem} hint={preview ?? unitLine(settings['price.unit'])} />
      <Row>
        <BigButton label={QUICK_SEND} primary disabled={busy} onPress={send} />
        {undo !== null ? <BigButton label={`${String(undo.no)}번 등록 ${UNDO}`} onPress={() => void undoRegister()} /> : null}
      </Row>
      {note !== null ? <Notice tone="info">{note}</Notice> : null}
      {ask !== null ? (
        <View role="dialog" aria-label="고칠까요?" style={{ gap: 8 }}>
          <Body bold>{editQuestion(ask.product.no, ask.product.status === 'CLOSED')}</Body>
          <Hint>{`지금: ${ask.product.name === '' ? '품종 없음' : ask.product.name} ${formatWon(ask.product.price)} → 새 값: ${ask.name === '' ? '(품종 그대로)' : ask.name} ${formatWon(ask.price)}`}</Hint>
          <Row>
            <BigButton label="고치기" primary disabled={busy} onPress={() => void applyEdit()} />
            <BigButton label="그대로 두기" onPress={() => setAsk(null)} />
          </Row>
        </View>
      ) : null}
    </Card>
  )
}

/** 문자찜 한 줄 (AC-S06-13·21): 번호·전화번호(선택). 서버가 뒤 4자리로 구매자를 잇는다 — 전화번호는 보내고 지운다(화면에 남기지 않는다) */
export function SmsInput() {
  const api = useConsoleApi()
  const [no, setNo] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  if (api.ended || api.sealed) return null
  const send = async () => {
    const number = Number(no.trim())
    if (!Number.isInteger(number) || number < 1) {
      setResult({ tone: 'danger', text: '상품 번호를 숫자로 적어 주세요.' })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const written = await api.command({ type: 'sms', b: api.b, no: number, ...(phone.trim() === '' ? {} : { phone: phone.trim() }) }, newRequestId())
      const last4 = written.phoneLast4 ?? null
      setResult({ tone: 'success', text: `${String(number)}번 문자찜을 넣었어요${last4 === null ? '' : ` · 뒤 4자리 ${last4}`}.` })
      setNo('')
      setPhone('')
    } catch (caught) {
      setResult({ tone: 'danger', text: isApiError(caught) ? caught.message : '넣지 못했어요. 다시 눌러 주세요.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card label="문자찜">
      <Body bold>문자찜</Body>
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="번호" value={no} onChangeText={setNo} inputMode="numeric" keyboardType="number-pad" placeholder="15" />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="전화번호 (선택)" value={phone} onChangeText={setPhone} inputMode="tel" keyboardType="phone-pad" placeholder="010-1234-5678" />
        </View>
      </Row>
      <BigButton label="문자찜 넣기" disabled={busy} onPress={() => void send()} />
      {result !== null ? (
        <Notice tone={result.tone} alert={result.tone === 'danger'}>
          {result.text}
        </Notice>
      ) : null}
    </Card>
  )
}
