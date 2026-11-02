// 빠른 입력 한 줄 + 보내기 (AC-S05-10~13, PRD-01, D-084, 웹 QuickInput과 같은 규칙·문구).
// 한 줄 "15 핑크프릴 10000" → 그 번호가 없으면 등록, 있으면 "고칠까요?", 번호만이면 상품 자세히, 오류면 문장. 등록은 바로 기록하고 5초 동안 "되돌리기"(판매 종료).
// 문자찜 한 줄: 번호 + 전화번호(선택) → sms 이벤트(손 입력, D-V1-10 인식 문장은 없다).
// SRV1 (D-APP-24, AC-SRV1-05): 줄은 서버 읽기 입구가 읽는다 — 미리 보기는 서버 답(150ms 뒤, 없으면 비움), 등록 요청 본문은 친 줄 원문(`text`).
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { productKey } from '../../lib/derive.ts'
import { decideQuick, editQuestion, priceUnitOf, quickPlaceholder, registerPreview, unitLine } from '../../lib/quick.ts'
import { readQuickLine, useQuickReading, type QuickReading } from '../../lib/read.ts'
import { QUICK_SEND, UNDO, UNDONE_REGISTER, formatWon } from '../../lib/words.ts'
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
  const unit = priceUnitOf(api.data.broadcasts.get(api.b)?.settings)
  const findProduct = (no: number) => api.data.products.get(productKey(api.b, no))

  useEffect(() => () => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current)
  }, [])

  const closed = api.ended || api.sealed
  const reading = useQuickReading(api.b, text, !closed)
  const preview = closed ? null : registerPreview(reading)

  /** 등록: 본문은 친 줄 원문 — 서버가 같은 읽기로 기록한다. 응답이 없을 때 같은 요청 번호로 다시 보내도 한 번만 기록 */
  const register = async (decision: { readonly no: number; readonly name: string; readonly price: number }, line: string) => {
    setBusy(true)
    try {
      const result = await api.command({ type: 'product.register', b: api.b, text: line }, newRequestId())
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

  const send = async () => {
    if (closed || busy) return
    const line = text
    setProblem(null)
    if (line.trim() === '') return
    // 미리 보기 답을 기다리지 않는다 — 보낼 때 그 줄을 서버에 읽힌다
    let read: QuickReading
    setBusy(true)
    try {
      read = await readQuickLine(api.b, line)
    } catch (caught) {
      setProblem(isApiError(caught) ? caught.message : '읽지 못했어요. 다시 보내기를 눌러 주세요.')
      return
    } finally {
      setBusy(false)
    }
    const decision = decideQuick(read, findProduct)
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
      const changed = (ask.name !== '' && ask.name !== ask.product.name) || ask.price !== ask.product.price
      // 친 줄 원문을 보낸다 — 서버가 다시 읽어 고친다(SRV1 약속 2). 품종이 없는 줄이면 품종은 그대로
      if (changed) await api.command({ type: 'product.update', b: api.b, text: ask.line }, newRequestId())
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
      <Field label="빠른 입력" value={text} onChangeText={setText} placeholder={`예: ${quickPlaceholder(unit)}`} autoCorrect={false} autoCapitalize="none" onSubmitEditing={() => void send()} returnKeyType="send" blurOnSubmit={false} problem={problem} hint={preview ?? unitLine(unit)} />
      <Row>
        <BigButton label={QUICK_SEND} primary disabled={busy} onPress={() => void send()} />
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
