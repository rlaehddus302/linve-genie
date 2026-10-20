// 라벨 설정 편집·미리 보기 (LBL-03·04·05, L-0 1, L-3·L-4·L-5, L-11 13, D-I1-05, AC-I1-25·26).
// - 상품·포장 두 가지: 라벨 크기·가게 이름·가격 표기(상품)·한 장 번호 수(포장)·항목마다 켜기/끄기(끌 수 없는 항목은 잠김)·글자 크기·위치, 기본으로 되돌리기.
// - 미리 보기는 출력과 같은 렌더러의 1비트 그림(판매자 샘플 또는 가장 긴 값).
// - 저장 전: 템플릿 검사 오류면 저장 단추가 막히고 칸 옆에 문장. 최악값으로 그려 들어가지 않으면 저장하지 않고 그 항목을 알린다. 겹침은 경고만.
// - 다른 기기가 먼저 바꿨으면 서버 문장과 "새로 불러오기".
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  ITEM_NAMES,
  LABEL_SIZES,
  PACKING_ITEMS,
  PACKING_LOCKED,
  PER_PAGE_MAX,
  PER_PAGE_MIN,
  PRODUCT_ITEMS,
  PRODUCT_LOCKED,
  defaultTemplate,
  labelSizeInfo,
  splitGraphemes,
  trimLabelText,
  validateTemplate,
  type LabelSizeId,
  type LabelTemplate,
  type PackingTemplate,
  type PriceStyle,
  type ProductTemplate,
  type TemplateItem,
  type TemplateProblem,
} from '@livejjim/label'
import { useEffect, useId, useMemo, useState } from 'react'
import { isApiError, put, type ApiError } from '../api/client.ts'
import type { StoredTemplate } from '../api/print-types.ts'
import { checkTemplate, labelErrorMessage, renderSample, type PagesOutcome } from '../lib/label-render.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { LabelImage } from './LabelImage.tsx'
import { FONT_ERROR, useLabelEnv, usePrintApi, usePrintState } from './print-context.tsx'

/** 가게 이름 상한 (다듬은 뒤 보이는 글자 수, L-11 13) */
export const SHOP_NAME_MAX = 40
export const SHOP_NAME_TOO_LONG = '가게 이름은 40자 이하로 적어 주세요.'
export const SAVED_MESSAGE = '라벨 설정을 저장했어요.'
/** 위치 한 번 옮기기 (점, 0.5mm) */
const MOVE_STEP = 4
/** 글자 크기 한 번 바꾸기 (점) */
const FONT_STEP = 2

const SIZE_WORD = (size: LabelSizeId): string => `${size.replace('x', '×')}mm`

const PRICE_CHOICES: readonly { readonly value: PriceStyle; readonly word: string }[] = [
  { value: 'THOUSAND', word: '천원 단위 (예: 8 천원)' },
  { value: 'WON', word: '원 단위 (예: 8,000원)' },
]

type Kind = 'product' | 'packing'

export function LabelSettings() {
  const [kind, setKind] = useState<Kind>('product')
  return (
    <div className="stack">
      <div className="row" role="group" aria-label="라벨 종류">
        <button type="button" className="button" aria-pressed={kind === 'product'} onClick={() => setKind('product')}>
          상품 라벨
        </button>
        <button type="button" className="button" aria-pressed={kind === 'packing'} onClick={() => setKind('packing')}>
          포장 라벨
        </button>
      </div>
      <TemplateEditor key={kind} kind={kind} />
    </div>
  )
}

interface Draft {
  readonly template: LabelTemplate
  /** 읽은 판 */
  readonly version: number
  /** 판매자가 고쳤다 (다른 기기의 저장으로 덮지 않는다) */
  readonly dirty: boolean
  /** 한 장 번호 수 칸의 글 (포장) */
  readonly perPageText: string
}

const draftOf = (stored: StoredTemplate): Draft => ({
  template: stored.template,
  version: stored.version,
  dirty: false,
  perPageText: stored.template.kind === 'packing' ? String(stored.template.perPage) : '',
})

function problemsAt(problems: readonly TemplateProblem[], path: string): string[] {
  return problems.filter((problem) => problem.path === path || problem.path.startsWith(`${path}.`)).map((problem) => problem.message)
}

function TemplateEditor({ kind }: { readonly kind: Kind }) {
  const print = usePrintState()
  const api = usePrintApi()
  const env = useLabelEnv()
  const stored = print.templates?.[kind] ?? null
  const [draft, setDraft] = useState<Draft | null>(null)
  const [longest, setLongest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | null>(null)
  const [fitError, setFitError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const ids = { size: useId(), shop: useId(), perPage: useId() }

  // 처음·다른 기기가 저장했을 때: 고치지 않은 동안은 서버 것으로
  useEffect(() => {
    if (stored === null) return
    setDraft((current) => (current === null || (!current.dirty && current.version !== stored.version) ? draftOf(stored) : current))
  }, [stored])

  const template = draft?.template ?? null
  const check = useMemo(() => (template === null ? null : validateTemplate(template)), [template])
  const problems = check !== null && !check.ok ? (check.error.problems ?? []) : []
  const warnings = check?.warnings ?? []
  const shopTooLong = template !== null && splitGraphemes(trimLabelText(template.shopName)).length > SHOP_NAME_MAX
  const perPageProblem =
    template?.kind !== 'packing' || draft === null
      ? null
      : !/^\d{1,2}$/.test(draft.perPageText.trim())
        ? `한 장에 넣을 번호 수는 ${String(PER_PAGE_MIN)}~${String(PER_PAGE_MAX)} 사이로 정해 주세요.`
        : (problemsAt(problems, 'perPage')[0] ?? null)
  const blocked = problems.length > 0 || shopTooLong || perPageProblem !== null

  const preview: PagesOutcome | null = useMemo(() => {
    if (env.state !== 'ready' || template === null || problems.length > 0) return null
    return renderSample(env.env, template, longest)
  }, [env, template, longest, problems.length])

  if (stored === null || draft === null || template === null) {
    return <p role="status">라벨 설정을 불러오는 중…</p>
  }

  const change = (next: LabelTemplate, perPageText?: string) => {
    setDraft({ template: next, version: draft.version, dirty: true, perPageText: perPageText ?? draft.perPageText })
    setSaved(null)
    setFitError(null)
    setSaveError(null)
  }

  const items = template.items as Readonly<Record<string, TemplateItem>>
  const itemIds: readonly string[] = template.kind === 'product' ? PRODUCT_ITEMS : PACKING_ITEMS
  const locked: readonly string[] = template.kind === 'product' ? PRODUCT_LOCKED : PACKING_LOCKED
  const { widthDots, heightDots } = labelSizeInfo(template.size)

  const setItem = (id: string, patch: Partial<TemplateItem>) => {
    const current = items[id]
    if (current === undefined) return
    change({ ...template, items: { ...template.items, [id]: { ...current, ...patch } } } as LabelTemplate)
  }

  const move = (id: string, dx: number, dy: number) => {
    const item = items[id]
    if (item === undefined) return
    const x = Math.max(0, Math.min(widthDots - item.width, item.x + dx))
    const y = Math.max(0, Math.min(heightDots - item.height, item.y + dy))
    if (x !== item.x || y !== item.y) setItem(id, { x, y })
  }

  const resize = (id: string, delta: number) => {
    const item = items[id]
    if (item === undefined) return
    const fontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, item.fontSize + delta))
    if (fontSize === item.fontSize) return
    setItem(id, { fontSize, minFontSize: Math.min(item.minFontSize, fontSize) })
  }

  const changeSize = (size: LabelSizeId) => {
    if (size === template.size) return
    const fresh = defaultTemplate(template.kind, size)
    const visible = (id: string) => items[id]?.visible ?? true
    const freshItems = fresh.items as Readonly<Record<string, TemplateItem>>
    const nextItems: Record<string, TemplateItem> = {}
    for (const id of itemIds) {
      const item = freshItems[id]
      if (item !== undefined) nextItems[id] = { ...item, visible: locked.includes(id) ? true : visible(id) }
    }
    if (template.kind === 'product') change({ ...(fresh as ProductTemplate), shopName: template.shopName, priceStyle: template.priceStyle, items: nextItems as ProductTemplate['items'] })
    else change({ ...(fresh as PackingTemplate), shopName: template.shopName, items: nextItems as PackingTemplate['items'] }, String((fresh as PackingTemplate).perPage))
  }

  const reset = () => {
    const fresh = defaultTemplate(template.kind, template.size)
    change({ ...fresh, shopName: template.shopName } as LabelTemplate, fresh.kind === 'packing' ? String(fresh.perPage) : '')
  }

  const reload = async () => {
    await api?.store.reloadTemplates()
    const latest = api?.store.getSnapshot().templates?.[kind]
    if (latest !== undefined) setDraft(draftOf(latest))
    setSaveError(null)
    setFitError(null)
  }

  const save = async () => {
    if (blocked || busy) return
    setSaved(null)
    setFitError(null)
    setSaveError(null)
    if (env.state !== 'ready') {
      setFitError(FONT_ERROR)
      return
    }
    // 저장 전에 최악값으로 그려 본다 (AC-I1-26)
    const result = checkTemplate(env.env, template)
    if (!result.ok) {
      setFitError('doesNotFit' in result ? result.doesNotFit : (result.problems[0]?.message ?? '라벨 설정에 고칠 곳이 있어요.'))
      return
    }
    setBusy(true)
    try {
      const response = await put<{ template: LabelTemplate; version: number; message: string }>(`/api/print/templates/${kind}`, { template: result.template, version: draft.version })
      api?.store.setTemplate(kind, { template: response.template, version: response.version })
      setDraft({ template: response.template, version: response.version, dirty: false, perPageText: response.template.kind === 'packing' ? String(response.template.perPage) : '' })
      setSaved(response.message)
    } catch (error) {
      if (!isApiError(error)) throw error
      // 라벨 기능이 꺼져 있다는 거절(오래된 화면): 그 문장을 남기고 화면을 꺼진 상태로 다시 불러온다 (AC-N4a-20)
      api?.store.noteRefusal(error)
      setSaveError(error)
    } finally {
      setBusy(false)
    }
  }

  const serverProblem = (path: string): string | null => {
    const problem = saveError?.problems.find((item) => item.field === `template.${path}` || item.field?.startsWith(`template.${path}.`) === true)
    return problem?.message ?? null
  }

  return (
    <div className="label-editor">
      <div className="stack label-editor-fields">
        <fieldset className="fieldset">
          <legend id={ids.size}>라벨 크기</legend>
          <div className="row" role="radiogroup" aria-labelledby={ids.size}>
            {LABEL_SIZES.map((size) => (
              <label key={size} className="choice">
                <input type="radio" name={`${kind}-size`} checked={template.size === size} onChange={() => changeSize(size)} />
                <span>{SIZE_WORD(size)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor={ids.shop}>가게 이름</label>
          <input
            id={ids.shop}
            className="input"
            autoComplete="off"
            value={template.shopName}
            aria-invalid={shopTooLong}
            onChange={(event) => change({ ...template, shopName: event.target.value })}
          />
          {shopTooLong ? (
            <p className="field-error" role="alert">
              {SHOP_NAME_TOO_LONG}
            </p>
          ) : null}
          {serverProblem('shopName') !== null ? <p className="field-error">{serverProblem('shopName')}</p> : null}
        </div>
        {template.kind === 'product' ? (
          <fieldset className="fieldset">
            <legend>가격 표기</legend>
            <div className="choice-list-plain" role="radiogroup" aria-label="가격 표기">
              {PRICE_CHOICES.map((choice) => (
                <label key={choice.value} className="choice">
                  <input type="radio" name="price-style" checked={template.priceStyle === choice.value} onChange={() => change({ ...template, priceStyle: choice.value })} />
                  <span>{choice.word}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="field">
            <label htmlFor={ids.perPage}>한 장 번호 수</label>
            <input
              id={ids.perPage}
              className="input input-short"
              inputMode="numeric"
              autoComplete="off"
              value={draft.perPageText}
              aria-invalid={perPageProblem !== null}
              onChange={(event) => {
                const text = event.target.value
                const value = Number(text.trim())
                change({ ...template, perPage: /^\d{1,2}$/.test(text.trim()) ? value : 0 }, text)
              }}
            />
            <p className="hint">
              {PER_PAGE_MIN}~{PER_PAGE_MAX}개
            </p>
            {perPageProblem !== null ? (
              <p className="field-error" role="alert">
                {perPageProblem}
              </p>
            ) : null}
          </div>
        )}

        <fieldset className="fieldset">
          <legend>항목</legend>
          <ul className="plain-list stack-tight">
            {itemIds.map((id) => {
              const item = items[id]
              if (item === undefined) return null
              const name = ITEM_NAMES[id] ?? id
              const isLocked = locked.includes(id)
              const messages = problemsAt(problems, `items.${id}`)
              return (
                <li key={id} className="item-row">
                  <label className="choice">
                    <input type="checkbox" checked={item.visible} disabled={isLocked} onChange={(event) => setItem(id, { visible: event.target.checked })} aria-describedby={isLocked ? `${kind}-${id}-locked` : undefined} />
                    <span>
                      {name}
                      <span className="sr-only"> 켜기</span>
                    </span>
                  </label>
                  {isLocked ? (
                    <span className="hint" id={`${kind}-${id}-locked`}>
                      끌 수 없어요
                    </span>
                  ) : null}
                  <span className="item-controls" role="group" aria-label={`${name} 글자 크기와 위치`}>
                    <button type="button" className="button button-small" aria-label={`${name} 글자 작게`} disabled={item.fontSize <= FONT_SIZE_MIN} onClick={() => resize(id, -FONT_STEP)}>
                      −
                    </button>
                    <span className="item-size">글자 {item.fontSize}</span>
                    <button type="button" className="button button-small" aria-label={`${name} 글자 크게`} disabled={item.fontSize >= FONT_SIZE_MAX} onClick={() => resize(id, FONT_STEP)}>
                      +
                    </button>
                    <button type="button" className="button button-small" aria-label={`${name} 위로`} disabled={item.y <= 0} onClick={() => move(id, 0, -MOVE_STEP)}>
                      ↑
                    </button>
                    <button type="button" className="button button-small" aria-label={`${name} 아래로`} disabled={item.y + item.height >= heightDots} onClick={() => move(id, 0, MOVE_STEP)}>
                      ↓
                    </button>
                    <button type="button" className="button button-small" aria-label={`${name} 왼쪽으로`} disabled={item.x <= 0} onClick={() => move(id, -MOVE_STEP, 0)}>
                      ←
                    </button>
                    <button type="button" className="button button-small" aria-label={`${name} 오른쪽으로`} disabled={item.x + item.width >= widthDots} onClick={() => move(id, MOVE_STEP, 0)}>
                      →
                    </button>
                  </span>
                  {messages.map((message) => (
                    <p key={message} className="field-error" role="alert">
                      {message}
                    </p>
                  ))}
                </li>
              )
            })}
          </ul>
        </fieldset>
        {problems.filter((problem) => !problem.path.startsWith('items.') && problem.path !== 'perPage').map((problem) => (
          <p key={`${problem.path}:${problem.message}`} className="field-error" role="alert">
            {problem.message}
          </p>
        ))}
        {warnings.length > 0 ? (
          <ul className="plain-list warning" aria-label="겹침 경고">
            {warnings.map((warning) => (
              <li key={warning.message}>{warning.message} 저장할 수는 있어요.</li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          {/* 보통 버튼: 라벨 화면의 주 버튼은 프린터 단계·멈춤 띠의 지금 할 일 하나뿐이다 (AC-N4a-21, D-N4a-06) */}
          <button type="button" className="button" disabled={blocked || busy} onClick={() => void save()}>
            {busy ? '저장하는 중…' : '라벨 설정 저장'}
          </button>
          <button type="button" className="button" onClick={reset}>
            기본으로 되돌리기
          </button>
        </div>
        {fitError !== null ? (
          <p className="field-error" role="alert">
            {fitError}
          </p>
        ) : null}
        {saved !== null ? (
          <p className="notice" role="status">
            {saved}
          </p>
        ) : null}
        {saveError !== null ? (
          <div className="stack-tight">
            <ErrorNote error={saveError} />
            {saveError.code === 'TEMPLATE_CONFLICT' ? (
              <button type="button" className="button" onClick={() => void reload()}>
                새로 불러오기
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <section className="stack-tight label-preview" aria-label="라벨 미리 보기">
        <h3 className="sub-title">미리 보기</h3>
        <label className="choice">
          <input type="checkbox" checked={longest} onChange={(event) => setLongest(event.target.checked)} />
          <span>가장 긴 값으로 보기</span>
        </label>
        <p className="hint">라벨 50mm 중 가운데 48mm에 찍혀요. 미리 보기는 프린터로 보내는 그림과 같아요.</p>
        {env.state === 'error' ? <p className="field-error">{FONT_ERROR}</p> : null}
        {env.state === 'loading' ? <p role="status">미리 보기를 그리는 중…</p> : null}
        {preview !== null && !preview.ok ? (
          <p className="field-error" role="alert">
            {labelErrorMessage(preview.error)}
          </p>
        ) : null}
        {preview !== null && preview.ok
          ? preview.images.map((image, index) => (
              <LabelImage
                key={index}
                image={image}
                framed
                label={template.kind === 'product' ? '상품 라벨 미리 보기' : `포장 라벨 미리 보기 ${String(index + 1)}쪽`}
              />
            ))
          : null}
      </section>
    </div>
  )
}
