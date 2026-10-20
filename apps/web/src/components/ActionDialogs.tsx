// 조치 창: 사유 받기, 확인, 메시지 → 찜, 직접 배정·교체, 상품 고치기 (AC-S05-13·15·22·34, D-083·D-084·D-087).
// 창의 처음 포커스는 아무것도 바꾸지 않는 "닫기"(또는 "아니요")다. 방송자 조치는 5초 뒤에 보낸다(queueHost).
import { parseAmount } from '@livejjim/core'
import { useMemo, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import type { Buyer, ChatMessage, Product } from '../api/types.ts'
import { formatWon, productKey } from '../lib/derive.ts'
import { changedFields, editQuestion } from '../lib/quick.ts'
import { PRODUCT_STATUS_WORD } from '../lib/words.ts'
import { useConsoleApi, type AssignSpec, type ConfirmSpec, type ReasonSpec } from './console-context.ts'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { ReasonField } from './ReasonField.tsx'

// ── 사유 ────────────────────────────────────────────────────────────────

export function ReasonDialog({ spec, onClose }: { readonly spec: ReasonSpec; readonly onClose: () => void }) {
  const [reason, setReason] = useState(spec.initialReason ?? '')
  const [empty, setEmpty] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const submit = () => {
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      field.current?.focus()
      return
    }
    spec.onSubmit(value)
  }
  return (
    <Modal
      title={spec.title}
      onClose={onClose}
      actions={
        <button ref={submitButton} type="button" className="button button-danger" onClick={submit}>
          {spec.submitLabel}
        </button>
      }
    >
      {spec.warning !== undefined ? (
        <p className="warning" data-tone="warning">
          {spec.warning}
        </p>
      ) : null}
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setEmpty(false)
        }}
        onPicked={() => submitButton.current?.focus()}
        empty={empty}
        error={spec.error}
        inputRef={field}
        onEnter={submit}
      />
    </Modal>
  )
}

// ── 확인 ────────────────────────────────────────────────────────────────

export function ConfirmDialog({ spec, onClose }: { readonly spec: ConfirmSpec; readonly onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await spec.onConfirm()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={spec.title}
      onClose={onClose}
      {...(spec.closeLabel === undefined ? {} : { closeLabel: spec.closeLabel })}
      actions={
        <button type="button" className={spec.tone === 'primary' ? 'button button-primary' : 'button button-danger'} disabled={busy} onClick={() => void confirm()}>
          {busy ? '보내는 중…' : spec.confirmLabel}
        </button>
      }
    >
      <p>{spec.message}</p>
      {error !== null ? <ErrorNote error={error} onRetry={error.transient ? () => void confirm() : undefined} /> : null}
    </Modal>
  )
}

// ── 메시지 → 찜 (AC-S05-22) ─────────────────────────────────────────────

export function ConvertDialog({ message, onClose }: { readonly message: ChatMessage | undefined; readonly onClose: () => void }) {
  const api = useConsoleApi()
  const [number, setNumber] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  if (message === undefined) {
    return (
      <Modal title="메시지를 찜으로 바꾸기" onClose={onClose}>
        <p>그 메시지를 찾지 못했어요.</p>
      </Modal>
    )
  }
  const max = api.settingsOf(message.broadcast)?.['claim.maxNumber'] ?? 9999
  const converted = new Set(message.converted)
  const choose = (no: number) => {
    if (!Number.isInteger(no) || no < 1 || no > max) {
      setProblem(`번호는 1부터 ${String(max)}까지예요. 번호를 확인해 주세요.`)
      return
    }
    if (converted.has(no)) {
      setProblem(`${String(no)}번으로는 이미 바꿨어요.`)
      return
    }
    api.queueHost({
      label: `${String(no)}번 ${message.nick} 메시지를 찜으로`,
      event: { type: 'host.convertMessage', b: message.broadcast, msg: message.id, no },
      products: [productKey(message.broadcast, no)],
      message: message.id,
    })
    api.closeAll()
  }
  return (
    <Modal title="메시지를 찜으로 바꾸기" onClose={onClose}>
      <p className="quote">
        <strong>{message.nick}</strong> {message.text}
      </p>
      {message.mentions.length > 0 ? (
        <div className="row" role="group" aria-label="언급 번호">
          {message.mentions.map((no, index) =>
            converted.has(no) ? (
              <button key={no} type="button" className="button" disabled>
                {no}번 바꿈
              </button>
            ) : (
              <button key={no} type="button" className="button button-primary" data-key={index < 9 ? String(index + 1) : undefined} onClick={() => choose(no)}>
                {index < 9 ? `${String(index + 1)} ` : ''}
                {no}번
              </button>
            ),
          )}
        </div>
      ) : (
        <p>메시지에 번호가 없어요. 번호 칸에 적어 주세요.</p>
      )}
      {message.converted.length > 0 ? <p>이미 바꾼 번호: {message.converted.map((no) => `${String(no)}번`).join(', ')} (바꿈)</p> : null}
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault()
          choose(Number(number.trim().replace(/번$/, '')))
        }}
      >
        <label className="field">
          <span>번호</span>
          <input className="input" inputMode="numeric" value={number} onChange={(event) => setNumber(event.target.value)} />
        </label>
        <button type="submit" className="button">
          바꾸기
        </button>
      </form>
      {problem !== null ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      <p className="hint">고른 번호는 {Math.round(api.delayMs / 100) / 10}초 뒤에 보내요. 그 안에 되돌릴 수 있어요.</p>
    </Modal>
  )
}

// ── 직접 배정·교체 (AC-S05-34, R-9) ─────────────────────────────────────

export function AssignDialog({ spec, onClose }: { readonly spec: AssignSpec; readonly onClose: () => void }) {
  const api = useConsoleApi()
  const product = api.data.products.get(spec.product)
  const [search, setSearch] = useState('')
  const [buyer, setBuyer] = useState<string | undefined>(spec.buyer ?? spec.initial?.buyer)
  const [replace, setReplace] = useState<string | undefined>(spec.replace ?? spec.initial?.replace ?? (product?.winners.length === 1 ? product.winners[0] : undefined))
  const [replaceTo, setReplaceTo] = useState<'WAITLIST' | 'CANCEL'>(spec.initial?.replaceTo ?? 'WAITLIST')
  const [reason, setReason] = useState(spec.initial?.reason ?? '')
  const [empty, setEmpty] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)

  const candidates = useMemo(() => {
    const out: Buyer[] = []
    const query = search.trim()
    for (const item of api.data.buyers.values()) {
      if (item.mergedInto !== null || product?.winners.includes(item.id) === true) continue
      if (query !== '' && !item.display.includes(query)) continue
      out.push(item)
      if (out.length >= 30) break
    }
    return out
  }, [api.data.buyers, search, product])

  if (product === undefined) {
    return (
      <Modal title="직접 배정" onClose={onClose}>
        <p>그 상품을 찾지 못했어요.</p>
      </Modal>
    )
  }
  const full = product.winners.length >= product.stock
  const needsReplace = spec.replace !== undefined || full
  const title = spec.replace !== undefined ? `${String(product.no)}번 1등 바꾸기` : spec.buyer !== undefined ? `${String(product.no)}번 1등으로` : `${String(product.no)}번 직접 배정`

  const submit = () => {
    setProblem(null)
    if (buyer === undefined) {
      setProblem('배정할 구매자를 골라 주세요.')
      return
    }
    if (needsReplace && replace === undefined) {
      setProblem('자리를 내줄 1등을 골라 주세요.')
      return
    }
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    const buyerName = api.names.name(buyer)
    const replaceWords = needsReplace && replace !== undefined ? ` (${api.names.name(replace)} ${replaceTo === 'WAITLIST' ? '대기로' : '취소'})` : ''
    const fields = { buyer, replace, replaceTo, reason: value }
    api.queueHost({
      label: `${String(product.no)}번 ${buyerName} 직접 배정${replaceWords}`,
      event: { type: 'host.assign', b: product.broadcast, no: product.no, buyer, reason: value, ...(needsReplace && replace !== undefined ? { replace, replaceTo } : {}) },
      products: [product.key],
      reopen: { label: '배정 고치기', open: (error) => api.openDialog({ kind: 'assign', spec: { ...spec, initial: fields, error } }) },
    })
    api.closeAll()
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      actions={
        product.conflict ? null : (
          <button ref={submitButton} type="button" className="button button-danger" onClick={submit}>
            {needsReplace ? '1등 바꾸기' : '1등으로 정하기'}
          </button>
        )
      }
    >
      {product.conflict ? (
        <p className="warning" role="alert" data-tone="warning">
          충돌부터 정해 주세요.
        </p>
      ) : (
        <>
          {spec.buyer !== undefined ? (
            <p>1등으로 올릴 사람: {api.names.name(spec.buyer)}</p>
          ) : (
            <fieldset className="stack-tight">
              <legend>배정할 구매자</legend>
              <label className="field">
                <span>닉네임으로 찾기</span>
                <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              {candidates.length === 0 ? <p>찾는 구매자가 없어요. 채팅을 쓴 적 있는 시청자만 고를 수 있어요.</p> : null}
              <div className="choice-list">
                {candidates.map((item) => (
                  <label key={item.id} className="choice">
                    <input type="radio" name="assign-buyer" checked={buyer === item.id} onChange={() => setBuyer(item.id)} />
                    <span>{api.names.name(item.id)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {needsReplace ? (
            <fieldset className="stack-tight">
              <legend>자리를 내줄 1등</legend>
              {spec.replace !== undefined ? (
                <p>{api.names.name(spec.replace)}</p>
              ) : (
                <div className="choice-list">
                  {product.winners.map((id) => (
                    <label key={id} className="choice">
                      <input type="radio" name="assign-replace" checked={replace === id} onChange={() => setReplace(id)} />
                      <span>{api.names.name(id)}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="row" role="radiogroup" aria-label="기존 1등은">
                <label className="choice">
                  <input type="radio" name="assign-replace-to" checked={replaceTo === 'WAITLIST'} onChange={() => setReplaceTo('WAITLIST')} />
                  <span>대기로</span>
                </label>
                <label className="choice">
                  <input type="radio" name="assign-replace-to" checked={replaceTo === 'CANCEL'} onChange={() => setReplaceTo('CANCEL')} />
                  <span>취소</span>
                </label>
              </div>
            </fieldset>
          ) : null}
          <ReasonField
            value={reason}
            onChange={(value) => {
              setReason(value)
              setEmpty(false)
            }}
            onPicked={() => submitButton.current?.focus()}
            empty={empty}
            error={spec.error}
            inputRef={reasonField}
          />
          {problem !== null ? (
            <p className="field-error" role="alert">
              {problem}
            </p>
          ) : null}
          {spec.error != null && spec.error.problemFor('reason') === undefined ? <ErrorNote error={spec.error} /> : null}
        </>
      )}
    </Modal>
  )
}

// ── 고치기 (AC-S05-13·15, PRD-01 AC4, PRD-02 AC2, D-013, D-084) ─────────

export interface EditDialogProps {
  readonly productKey: string
  /** 빠른 입력으로 친 값 (form이면 칸에 채울 처음 값) */
  readonly name: string
  readonly price: number
  /** 빠른 입력 줄 (null이면 상품 자세히의 "고치기" — 칸을 보인다) */
  readonly line: string | null
  readonly onClose: () => void
  /** 보낸 뒤: 빠른 입력 줄 비우기·현재 상품 */
  readonly onDone: (product: Product) => void
  /** 바뀐 값이 없다: 그 상품을 보인다 */
  readonly onUnchanged: (product: Product) => void
}

export function EditDialog({ productKey: key, name, price, line, onClose, onDone, onUnchanged }: EditDialogProps) {
  const api = useConsoleApi()
  const product = api.data.products.get(key)
  const [stage, setStage] = useState<'ask' | 'form' | 'applyTo'>(line === null ? 'form' : 'ask')
  const [nameText, setNameText] = useState(name)
  const [priceText, setPriceText] = useState(String(price))
  const [pending, setPending] = useState<{ name?: string; price?: number } | null>(null)
  const [priceProblem, setPriceProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const newOnlyButton = useRef<HTMLButtonElement>(null)

  if (product === undefined) {
    return (
      <Modal title="고치기" onClose={onClose}>
        <p>그 상품을 찾지 못했어요.</p>
      </Modal>
    )
  }
  const closed = product.status === 'CLOSED'
  const question = editQuestion(product.no, closed)

  const send = async (changes: { name?: string; price?: number }, applyTo: 'NEW_ONLY' | 'UNPAID_CLAIMS' | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.command({
        type: 'product.update',
        b: product.broadcast,
        no: product.no,
        ...changes,
        ...(applyTo !== null && changes.price !== undefined ? { applyTo } : {}),
      })
      if (line !== null && closed) await api.command({ type: 'product.open', b: product.broadcast, no: product.no })
      onDone(product)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setStage(line === null ? 'form' : 'ask')
      if (caught.problemFor('name') !== undefined) nameField.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const proceed = (changes: { name?: string; price?: number }) => {
    if (changes.name === undefined && changes.price === undefined) {
      onUnchanged(product)
      return
    }
    if (changes.price !== undefined && product.winners.length > 0) {
      setPending(changes)
      setStage('applyTo')
      return
    }
    void send(changes, null)
  }

  const submitForm = () => {
    const settings = api.settingsOf(product.broadcast)
    const parsed = parseAmount(priceText, settings ?? {})
    if (parsed === null) {
      setPriceProblem('가격을 알아보지 못했어요. 가격 칸에 적어 주세요.')
      return
    }
    if (parsed < 100) {
      setPriceProblem('가격이 100원보다 적어요. 가격을 확인해 주세요.')
      return
    }
    setPriceProblem(null)
    const trimmed = nameText.trim()
    proceed({ ...(trimmed !== product.name ? { name: trimmed } : {}), ...(parsed !== product.price ? { price: parsed } : {}) })
  }

  if (stage === 'applyTo' && pending !== null) {
    return (
      <Modal
        key="applyTo"
        title="확정된 찜에도 새 가격을 적용할까요?"
        onClose={onClose}
        initialFocus={newOnlyButton}
        actions={
          <>
            <button ref={newOnlyButton} type="button" className="button button-primary" data-key="1" disabled={busy} onClick={() => void send(pending, 'NEW_ONLY')}>
              아니요, 새 찜부터
            </button>
            <button type="button" className="button" data-key="2" disabled={busy} onClick={() => void send(pending, 'UNPAID_CLAIMS')}>
              예, 입금 전 찜에도
            </button>
          </>
        }
      >
        <ApplyToBody product={product} price={pending.price} />
        {busy ? <p role="status">보내는 중…</p> : null}
        {error !== null ? <ErrorNote error={error} /> : null}
      </Modal>
    )
  }

  if (stage === 'form') {
    return (
      <Modal
        key="form"
        title={`${String(product.no)}번 고치기`}
        onClose={onClose}
        initialFocus={nameField}
        actions={
          <button type="button" className="button button-primary" disabled={busy} onClick={submitForm}>
            {busy ? '보내는 중…' : '고치기'}
          </button>
        }
      >
        <form
          className="stack-tight"
          onSubmit={(event) => {
            event.preventDefault()
            submitForm()
          }}
        >
          <label className="field">
            <span>품종</span>
            <input ref={nameField} className="input" value={nameText} onChange={(event) => setNameText(event.target.value)} />
          </label>
          <FieldError error={error} field="name" />
          <label className="field">
            <span>가격</span>
            <input className="input" value={priceText} onChange={(event) => setPriceText(event.target.value)} />
          </label>
          {priceProblem !== null ? (
            <p className="field-error" role="alert">
              {priceProblem}
            </p>
          ) : null}
          <FieldError error={error} field="price" />
          <button type="submit" hidden />
        </form>
        {error !== null ? <ErrorNote error={error} omitFields={['name', 'price']} /> : null}
      </Modal>
    )
  }

  const typed = changedFields(product, name, price)
  return (
    <Modal
      key="ask"
      title={question}
      onClose={onClose}
      closeLabel="아니요"
      actions={
        <button type="button" className="button button-primary" disabled={busy} onClick={() => proceed(typed)}>
          {busy ? '보내는 중…' : '예'}
        </button>
      }
    >
      <table className="compare">
        <thead>
          <tr>
            <th scope="col">칸</th>
            <th scope="col">지금 값</th>
            <th scope="col">친 값</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">품종</th>
            <td>{product.name === '' ? '품종 미입력' : product.name}</td>
            <td>{name === '' ? '(그대로)' : name}</td>
          </tr>
          <tr>
            <th scope="row">가격</th>
            <td>{formatWon(product.price)}</td>
            <td>{formatWon(price)}</td>
          </tr>
          <tr>
            <th scope="row">상태</th>
            <td>{PRODUCT_STATUS_WORD[product.status]}</td>
            <td>{closed ? '판매 중(다시 판매)' : PRODUCT_STATUS_WORD[product.status]}</td>
          </tr>
        </tbody>
      </table>
      <FieldError error={error} field="name" />
      {error !== null ? <ErrorNote error={error} omitFields={['name']} /> : null}
    </Modal>
  )
}

function ApplyToBody({ product, price }: { readonly product: Product; readonly price: number | undefined }) {
  return (
    <p>
      {product.no}번 가격을 {formatWon(product.price)}에서 {price === undefined ? '' : formatWon(price)}으로 바꿔요. 이미 1등인 찜 {product.winners.length}개의 가격도
      바꿀지 골라 주세요.
    </p>
  )
}
