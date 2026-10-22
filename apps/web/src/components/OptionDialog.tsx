// "옵션 추가" 창 (OPT-01·05, D-O2-04·05·06·11, AC-O2-11~17). 옵션 방송에서만 연다.
// - 항목(0~3)·선택지(1~20)·선택지 별칭·가격 차이·상품 별칭, 업종 템플릿(항목 하나씩), 변형 재고 표(처음 값 1, "모두 같은 수로").
// - 치는 동안 문제 칸 옆에 쉬운 한국어 알림이 뜨고 문제가 있으면 넣기 버튼이 막힌다. 최종 판단은 서버다(서버 문장은 부르는 쪽이 보인다).
// - 찜이 있는 상품의 "옵션 고치기"(locked): 선택지 더하기·가격 차이·재고·별칭만 칸이 열린다 — 선택지 빼기·이름 바꾸기·항목 더하기·빼기 칸은 없다.
// - 판매자가 적은 글(이름·별칭·선택지)은 React 기본 이스케이프로만 보인다.
import { OPTION_LIMITS, type OptionItem } from '@livejjim/core'
import { useMemo, useState, type ReactNode } from 'react'
import type { ApiError } from '../api/client.ts'
import { OPTION_TEMPLATES } from '../lib/option-templates.ts'
import {
  OPTION_WORDS,
  checkDraft,
  emptyChoice,
  emptyItem,
  hasNumericAlias,
  itemDraftOf,
  optionSummary,
  splitList,
  unitPriceWords,
  type ChoiceDraft,
  type ItemDraft,
  type OptionDraft,
  type OptionPayload,
} from '../lib/options.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export interface OptionDialogProps {
  readonly title: string
  readonly initial: OptionDraft
  /** 상품 가격 (단가를 보인다 — 모르면 null) */
  readonly price: number | null
  /** 찜이 있는 상품: 선택지 더하기·가격·재고·별칭만 (D-O2-11) */
  readonly locked?: boolean
  readonly submitLabel: string
  readonly busy?: boolean
  readonly error?: ApiError | null
  /** 서버가 아무 일도 하지 않았다 (changed=false) */
  readonly unchanged?: boolean
  readonly onSubmit: (payload: OptionPayload, draft: OptionDraft) => void
  readonly onClose: () => void
}

/** 숫자만 쓴 별칭 안내 (D-O4-11 — 막지 않는다) */
function NumericAliasNote() {
  return (
    <p className="hint" role="note">
      {OPTION_WORDS.numericAlias}
    </p>
  )
}

function Problem({ text }: { readonly text: string | undefined }) {
  if (text === undefined) return null
  return (
    <p className="field-error" role="alert">
      {text}
    </p>
  )
}

export function OptionDialog({ title, initial, price, locked = false, submitLabel, busy = false, error = null, unchanged = false, onSubmit, onClose }: OptionDialogProps) {
  const [draft, setDraft] = useState<OptionDraft>(initial)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [bulk, setBulk] = useState<Readonly<Record<number, string>>>({})
  const [allStock, setAllStock] = useState('')
  /** 고치기 전에 있던 선택지 수 (locked면 그 줄은 이름·빼기 칸이 없다) */
  const baseCounts = useMemo(() => initial.items.map((item) => item.choices.length), [initial])
  const check = useMemo(() => checkDraft(draft, price), [draft, price])
  const problem = (field: string): string | undefined => check.problems.get(field)
  const full = draft.items.length >= OPTION_LIMITS.items

  const setItem = (i: number, next: ItemDraft) => setDraft((current) => ({ ...current, items: current.items.map((item, n) => (n === i ? next : item)) }))
  const setChoice = (i: number, j: number, patch: Partial<ChoiceDraft>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, n) => (n === i ? { ...item, choices: item.choices.map((choice, m) => (m === j ? { ...choice, ...patch } : choice)) } : item)),
    }))
  const addItem = (item: ItemDraft) => setDraft((current) => (current.items.length >= OPTION_LIMITS.items ? current : { ...current, items: [...current.items, item] }))
  const addChoices = (i: number, labels: readonly string[]) => {
    const item = draft.items[i]
    if (item === undefined || labels.length === 0) return
    // 빈 첫 줄은 채운다
    const kept = item.choices.filter((choice, j) => !(j >= (locked ? (baseCounts[i] ?? 0) : 0) && choice.label.trim() === '' && choice.aliases.trim() === '' && choice.price.trim() === ''))
    setItem(i, { ...item, choices: [...kept, ...labels.map((label) => ({ ...emptyChoice(), label }))] })
  }

  const fillAll = () => {
    const text = allStock.trim()
    if (text === '') return
    setDraft((current) => {
      const stocks: Record<string, string> = { ...current.stocks }
      for (const row of check.rows) stocks[row.text] = text
      return { ...current, stocks }
    })
  }

  const options: OptionItem[] = check.payload?.options ?? []
  const serverProblems = error?.problems ?? []

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      actions={
        <button type="button" className="button button-primary" disabled={busy || check.payload === null} onClick={() => check.payload !== null && onSubmit(check.payload, draft)}>
          {busy ? '보내는 중…' : submitLabel}
        </button>
      }
    >
      {locked ? (
        <p className="warning" role="note" data-tone="warning">
          {OPTION_WORDS.locked}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="option-product-aliases">상품 별칭 (쉼표로 나눠 적기, 10개까지)</label>
        <input
          id="option-product-aliases"
          className="input"
          autoComplete="off"
          placeholder="초코과자, 초코"
          value={draft.aliases}
          onChange={(event) => setDraft((current) => ({ ...current, aliases: event.target.value }))}
        />
        <p className="hint">댓글에 상품 이름 대신 쓸 말이에요.</p>
        <Problem text={problem('aliases')} />
        {hasNumericAlias(draft.aliases) ? <NumericAliasNote /> : null}
      </div>

      {draft.items.map((item, i) => (
        <ItemFields
          key={i}
          index={i}
          item={item}
          locked={locked}
          baseCount={locked ? (baseCounts[i] ?? 0) : 0}
          problem={problem}
          bulk={bulk[i] ?? ''}
          onBulk={(text) => setBulk((current) => ({ ...current, [i]: text }))}
          onAddBulk={() => {
            addChoices(i, splitList(bulk[i] ?? ''))
            setBulk((current) => ({ ...current, [i]: '' }))
          }}
          onName={(name) => setItem(i, { ...item, name })}
          onChoice={(j, patch) => setChoice(i, j, patch)}
          onAddChoice={() => setItem(i, { ...item, choices: [...item.choices, emptyChoice()] })}
          onRemoveChoice={(j) => setItem(i, { ...item, choices: item.choices.filter((_, m) => m !== j) })}
          onRemove={() => setDraft((current) => ({ ...current, items: current.items.filter((_, n) => n !== i) }))}
        />
      ))}
      {draft.items.length === 0 ? <p>아직 옵션 항목이 없어요. "항목 더하기"나 "템플릿에서 고르기"로 넣어 주세요.</p> : null}
      <Problem text={problem('items')} />

      {locked ? null : (
        <div className="stack-tight">
          <div className="row">
            <button type="button" className="button" disabled={full} onClick={() => addItem(emptyItem())}>
              항목 더하기
            </button>
            <button type="button" className="button" aria-expanded={templatesOpen} onClick={() => setTemplatesOpen((open) => !open)}>
              템플릿에서 고르기
            </button>
          </div>
          {full ? (
            <p className="hint" role="note">
              {OPTION_WORDS.itemsFull}
            </p>
          ) : null}
          {templatesOpen ? (
            <div className="stack-tight" role="group" aria-label="템플릿">
              {OPTION_TEMPLATES.map((group) => (
                <div key={group.group} className="stack-tight">
                  <p>
                    <strong>{group.group}</strong>
                  </p>
                  <div className="row">
                    {group.templates.map((template) => (
                      <button
                        key={template.title}
                        type="button"
                        className="button button-small"
                        disabled={full}
                        aria-label={`${group.group} — ${template.title}`}
                        onClick={() => addItem(itemDraftOf(template.item))}
                      >
                        {template.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {check.rows.length > 0 ? (
        <section className="stack-tight" aria-label="옵션별 재고">
          <h3 className="sub-title">옵션별 재고</h3>
          <div className="row">
            <label className="field">
              <span>모두 같은 수로</span>
              <input className="input input-number" inputMode="numeric" autoComplete="off" value={allStock} onChange={(event) => setAllStock(event.target.value.replace(/\D/g, '').slice(0, 6))} />
            </label>
            <button type="button" className="button" disabled={allStock.trim() === ''} onClick={fillAll}>
              모두 바꾸기
            </button>
          </div>
          <table className="variant-table">
            <thead>
              <tr>
                <th scope="col">옵션</th>
                <th scope="col">값</th>
                <th scope="col">재고</th>
              </tr>
            </thead>
            <tbody>
              {check.rows.map((row) => (
                <tr key={row.text}>
                  <th scope="row">{row.text}</th>
                  <td>
                    {unitPriceWords(row.unitPrice)}
                    <Problem text={problem(`unit.${row.text}`)} />
                  </td>
                  <td>
                    <input
                      className="input input-number"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`${row.text} 재고`}
                      value={row.stock}
                      onChange={(event) => setDraft((current) => ({ ...current, stocks: { ...current.stocks, [row.text]: event.target.value.replace(/\D/g, '').slice(0, 6) } }))}
                    />
                    {row.soldOut ? <span className="tag">{OPTION_WORDS.soldOutAtStart}</span> : null}
                    <Problem text={problem(`stocks.${row.text}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {options.length > 0 ? (
        <p className="hint" role="status">
          {optionSummary(options)}
        </p>
      ) : null}
      {unchanged ? (
        <p className="warning" role="status" data-tone="warning">
          {OPTION_WORDS.unchanged}
        </p>
      ) : null}
      {error !== null ? (
        serverProblems.length > 0 ? (
          <div className="error-note" role="alert" data-tone="danger">
            {serverProblems.map((item, n) => (
              <p key={n}>{item.message}</p>
            ))}
          </div>
        ) : (
          <ErrorNote error={error} />
        )
      ) : null}
    </Modal>
  )
}

interface ItemFieldsProps {
  readonly index: number
  readonly item: ItemDraft
  readonly locked: boolean
  /** locked면 이 수까지의 선택지는 고치기 전에 있던 것 (이름·빼기 칸 없음) */
  readonly baseCount: number
  readonly problem: (field: string) => string | undefined
  readonly bulk: string
  readonly onBulk: (text: string) => void
  readonly onAddBulk: () => void
  readonly onName: (name: string) => void
  readonly onChoice: (j: number, patch: Partial<ChoiceDraft>) => void
  readonly onAddChoice: () => void
  readonly onRemoveChoice: (j: number) => void
  readonly onRemove: () => void
}

function ItemFields({ index, item, locked, baseCount, problem, bulk, onBulk, onAddBulk, onName, onChoice, onAddChoice, onRemoveChoice, onRemove }: ItemFieldsProps) {
  const n = index + 1
  const base = `items.${String(index)}`
  const label = (text: string): ReactNode => <span>{text}</span>
  return (
    <fieldset className="option-item stack-tight">
      <legend>항목 {n}</legend>
      {locked ? (
        <p>
          항목 이름: <strong>{item.name}</strong>
        </p>
      ) : (
        <label className="field">
          {label('항목 이름')}
          <input className="input" autoComplete="off" aria-label={`항목 ${String(n)} 이름`} placeholder="사이즈" value={item.name} onChange={(event) => onName(event.target.value)} />
        </label>
      )}
      <Problem text={problem(`${base}.name`)} />
      <ol className="plain-list stack-tight">
        {item.choices.map((choice, j) => {
          const cp = `${base}.choices.${String(j)}`
          const fixed = locked && j < baseCount
          const name = `항목 ${String(n)} 선택지 ${String(j + 1)}`
          return (
            <li key={j} className="option-choice">
              {fixed ? (
                <p className="option-choice-label">
                  <strong>{choice.label}</strong>
                </p>
              ) : (
                <label className="field">
                  {label('선택지')}
                  <input className="input" autoComplete="off" aria-label={`${name} 이름`} value={choice.label} onChange={(event) => onChoice(j, { label: event.target.value })} />
                </label>
              )}
              <label className="field">
                {label('별칭 (쉼표로)')}
                <input className="input" autoComplete="off" aria-label={`${name} 별칭`} value={choice.aliases} onChange={(event) => onChoice(j, { aliases: event.target.value })} />
              </label>
              <label className="field">
                {label('가격 차이 (원)')}
                <input className="input input-number" autoComplete="off" aria-label={`${name} 가격 차이`} placeholder="0" value={choice.price} onChange={(event) => onChoice(j, { price: event.target.value })} />
              </label>
              {fixed ? null : (
                <button type="button" className="button button-small" aria-label={`${name} 빼기`} onClick={() => onRemoveChoice(j)}>
                  빼기
                </button>
              )}
              <Problem text={problem(`${cp}.label`)} />
              <Problem text={problem(`${cp}.aliases`)} />
              {hasNumericAlias(choice.aliases) ? <NumericAliasNote /> : null}
              <Problem text={problem(`${cp}.price`)} />
            </li>
          )
        })}
      </ol>
      <Problem text={problem(`${base}.choices`)} />
      <div className="row">
        <button type="button" className="button button-small" onClick={onAddChoice}>
          선택지 더하기
        </button>
        {locked ? null : (
          <button type="button" className="button button-small" aria-label={`항목 ${String(n)} 빼기`} onClick={onRemove}>
            항목 빼기
          </button>
        )}
      </div>
      <div className="row">
        <label className="field">
          {label('선택지 여러 개 한 번에 (쉼표로)')}
          <input
            className="input"
            autoComplete="off"
            aria-label={`항목 ${String(n)} 선택지 여러 개`}
            placeholder="S, M, L"
            value={bulk}
            onChange={(event) => onBulk(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onAddBulk()
              }
            }}
          />
        </label>
        <button type="button" className="button button-small" disabled={bulk.trim() === ''} aria-label={`항목 ${String(n)} 선택지 한 번에 더하기`} onClick={onAddBulk}>
          한 번에 더하기
        </button>
      </div>
    </fieldset>
  )
}
