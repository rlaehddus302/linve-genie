// 라벨 설정 편집·미리 보기 (LBL-03·04·05, L-0 1, L-3·L-4·L-5, L-11 13, D-I1-05, AC-I1-25·26).
// - 상품·포장 두 가지: 라벨 크기·가게 이름·라벨에 찍는 가격 모양(상품)·한 장 번호 수(포장)·항목마다 켜기/끄기(끌 수 없는 항목은 잠김)·글자 크기·위치, 기본으로 되돌리기.
// - 미리 보기는 출력과 같은 렌더러의 1비트 그림(판매자 샘플 또는 가장 긴 값).
// - 저장 전: 템플릿 검사 오류면 저장 단추가 막히고 칸 옆에 문장. 최악값으로 그려 들어가지 않으면 저장하지 않고 그 항목을 알린다. 겹침은 경고만.
// - 열 때: 이미 저장된 설정이 같은 최악값 검사에 걸리면 같은 문장으로 경고만 한다(L-11 13, D-STB-01 — 저장된 설정은 그대로 쓴다).
// - 다른 기기가 먼저 바꿨으면 서버 문장과 "새로 불러오기".
// - 옵션 방송(상품명·옵션도 받기)이 하나라도 있는 판매자가 품종 칸을 끈 상품 템플릿을 고르거나 저장하면 안내 한 줄 — 막지 않는다 (D-O4-07, AC-O4-26).
//   옵션 방송이 있는지는 참/거짓만 주는 조회(GET /api/option-broadcasts/exists, D-O4-13)로 본다. 품종 칸을 끌 때만 묻고, 조회를 못 하면 안내를 보인다.
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  ITEM_NAMES,
  PACKING_ITEMS,
  PACKING_LOCKED,
  PER_PAGE_MAX,
  PER_PAGE_MIN,
  PRODUCT_ITEMS,
  PRODUCT_LOCKED,
  canMakePackingLabel,
  defaultTemplate,
  productDesign,
  isLabelSize,
  labelSizeInfo,
  labelSizeName,
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
import { CAPTION_POSITIONS, CAPTION_TEXT_MAX, CAPTION_WORDS, type CaptionPosition } from '@livejjim/label/captions'
import { B1_PROFILE, labelSizesForProfileId, printerProfile, sizeNotSupportedMessage } from '@livejjim/printer'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { StoredTemplate } from '../api/print-types.ts'
import { bringIntoView, onPickLabelSize } from '../lib/label-jump.ts'
import { checkTemplate, labelErrorMessage, renderSample, type PagesOutcome } from '../lib/label-render.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { LabelImage } from './LabelImage.tsx'
import { FONT_ERROR, useLabelEnv, usePrintApi, usePrintState } from './print-context.tsx'

/** 가게 이름 상한 (다듬은 뒤 보이는 글자 수, L-11 13) */
export const SHOP_NAME_MAX = 40
export const SHOP_NAME_TOO_LONG = '가게 이름은 40자 이하로 적어 주세요.'
export const SAVED_MESSAGE = '라벨 설정을 저장했어요.'
/** 가게 이름 칸 안내 (FB1 D-FB1-07, AC-FB1-28) */
export const SHOP_NAME_HINT = "라벨 맨 위에 찍히는 이름이에요. 비워 두면 설정 '가게'의 가게 이름이 찍혀요. 찍지 않으려면 아래 '가게 이름' 항목을 꺼 주세요."
export const SHOP_ITEM_OFF = '가게 이름 항목이 꺼져 있어 라벨에 찍히지 않아요.'
/** 가게 이름 칸이 비었을 때의 흐린 예시 글 (FB1 D-FB1-18 (h), AC-FB1-28) */
export const shopNamePlaceholder = (name: string): string => `비워 두면 찍히는 이름: ${name}`
/** 상품 라벨 가격 고르기 이름 (FB1 D-FB1-18 (h), AC-FB1-42 — 옛 "가격 표기") */
export const PRICE_STYLE_LABEL = '라벨에 찍는 가격 모양'

/** 칸에 넣을 템플릿: 가게 이름은 저장된 본문의 이름 그대로(서버가 채운 이름을 칸에 넣으면 저장할 때 템플릿에 굳는다) */
export function editableTemplate(stored: StoredTemplate): LabelTemplate {
  return stored.storedShopName === undefined ? stored.template : ({ ...stored.template, shopName: stored.storedShopName } as LabelTemplate)
}

/** 저장된 템플릿 이름이 빈 쪽의 서버 템플릿 이름 = 설정 "가게"의 가게 이름 (모르면 '') */
export function shopNameFallback(stored: readonly (StoredTemplate | null | undefined)[]): string {
  for (const item of stored) {
    if (item?.storedShopName !== undefined && trimLabelText(item.storedShopName) === '') return item.template.shopName
  }
  return ''
}
/** 위치 한 번 옮기기 (점, 0.5mm) */
const MOVE_STEP = 4
/** 글자 크기 한 번 바꾸기 (점) */
const FONT_STEP = 2

const SIZE_WORD = (size: LabelSizeId): string => `${labelSizeName(size)}mm`

/** 이 프린터로는 포장 라벨 크기가 없다 (테이프·50×15 프린터 — L-4 포장 라벨의 크기) */
export const NO_PACKING_SIZE_NOTE = '이 프린터로는 포장 라벨을 찍을 수 없어요. 포장 라벨은 아래 내보내기에서 그림 파일이나 A4로 내 주세요.'

/** 라벨 설정 안의 크기 경고 뒤 할 일 — 이미 이 칸에 있으니 어디서 무엇을 누르는지 (UX-PRN2-004, L-11 13 문장 뒤에 붙인다) */
export const SIZE_WARNING_HERE = "위에서 크기를 하나 고르고 아래 '라벨 설정 저장'을 눌러 주세요."

/** 크기 목록이 어느 프린터 기준인지 (UX-PRN2-010) — 출력 기기 프린터를 모르면 B1 */
export const sizeListBasis = (printerName: string): string => `크기 목록은 출력 기기에 이은 프린터에 맞춰 바뀌어요. 지금은 ${printerName} 기준이에요.`

/** 품종 칸을 끈 템플릿 안내 (D-O4-07) */
export const NAME_OFF_OPTIONS_NOTE = '품종 칸을 끄면 사이즈·색상 같은 옵션이 라벨에 찍히지 않아요.'

/**
 * 옵션 방송이 하나라도 있는가 (실제·리허설, D-O4-13). ask가 참일 때 한 번만 묻는다 — 참/거짓만 주는 가벼운 조회
 * GET /api/option-broadcasts/exists(확인 필요 목록은 부르지 않는다). 조회가 실패하면 참으로 본다(안내 한 줄이 더 보일 뿐 — 막지 않는다).
 */
function useHasOptionBroadcasts(ask: boolean): boolean {
  const [known, setKnown] = useState<boolean | null>(null)
  const asked = known !== null || !ask
  useEffect(() => {
    if (asked) return
    let alive = true
    void get<{ exists?: unknown }>('/api/option-broadcasts/exists').then(
      (view) => {
        if (alive) setKnown(view.exists !== false)
      },
      () => {
        if (alive) setKnown(true)
      },
    )
    return () => {
      alive = false
    }
  }, [asked])
  return known === true
}

const PRICE_CHOICES: readonly { readonly value: PriceStyle; readonly word: string }[] = [
  { value: 'THOUSAND', word: '천원 단위 (예: 300 천원)' },
  { value: 'WON', word: '원 단위 (예: 300,000원)' },
  // 만원 단위 (D-UX4-07) — 견본 값(300,000원)과 같은 예
  { value: 'TEN_THOUSAND', word: '만원 단위 (예: 30만원)' },
]

type Kind = 'product' | 'packing'

/** shopName: 설정 "가게"의 가게 이름 (로그인 정보 — 서버가 채운 이름을 아직 모를 때 대신 찍힐 이름) */
export function LabelSettings({ shopName = '' }: { readonly shopName?: string } = {}) {
  const [kind, setKind] = useState<Kind>('product')
  /** 멈춤 띠 "라벨 크기 고르기"를 누른 횟수 — 그 종류로 바꾸고 크기 칸으로 (UX-PRN2-003) */
  const [pickSize, setPickSize] = useState(0)
  useEffect(
    () =>
      onPickLabelSize((next) => {
        setKind(next)
        setPickSize((count) => count + 1)
      }),
    [],
  )
  return (
    <div className="stack">
      <div className="row" role="group" aria-label="라벨 종류">
        <button type="button" className="button" aria-pressed={kind === 'product'} onClick={() => { setKind('product'); setPickSize(0) }}>
          상품 라벨
        </button>
        <button type="button" className="button" aria-pressed={kind === 'packing'} onClick={() => { setKind('packing'); setPickSize(0) }}>
          포장 라벨
        </button>
      </div>
      <TemplateEditor key={kind} kind={kind} shopName={shopName} pickSize={pickSize} />
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
  template: editableTemplate(stored),
  version: stored.version,
  dirty: false,
  perPageText: stored.template.kind === 'packing' ? String(stored.template.perPage) : '',
})

function problemsAt(problems: readonly TemplateProblem[], path: string): string[] {
  return problems.filter((problem) => problem.path === path || problem.path.startsWith(`${path}.`)).map((problem) => problem.message)
}

function TemplateEditor({ kind, shopName, pickSize = 0 }: { readonly kind: Kind; readonly shopName: string; readonly pickSize?: number }) {
  const sizeRef = useRef<HTMLFieldSetElement | null>(null)
  // "라벨 크기 고르기": 크기 칸을 보이고 고른 크기(없으면 첫 크기)에 초점 (UX-PRN2-003)
  useEffect(() => {
    if (pickSize === 0) return
    const field = sizeRef.current
    bringIntoView(field, field?.querySelector<HTMLInputElement>('input:checked') ?? field?.querySelector<HTMLInputElement>('input') ?? null)
  }, [pickSize])
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
  // 크기 목록 = 출력 기기에 이은 프린터 프로필의 크기 (모르면 B1 목록 — L-11 13, D-PRN2-07). 포장은 높이 20mm 이상만 (L-4)
  // 서버가 정한 목록(queue.labelSizes)이 있으면 그것, 없으면(옛 서버) 출력 기기 프로필 ID로 같은 표에서
  const queue = print.overview?.queue ?? null
  const profileId = queue?.device?.profileId ?? null
  const listed = queue?.labelSizes
  const sizes = useMemo(() => {
    const fromServer = listed?.filter(isLabelSize)
    const all = fromServer !== undefined && fromServer.length > 0 ? fromServer : labelSizesForProfileId(profileId)
    return all.filter((size) => kind === 'product' || canMakePackingLabel(size))
  }, [listed, profileId, kind])

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
  const nameOff = template?.kind === 'product' && !template.items.name.visible
  const hasOptions = useHasOptionBroadcasts(nameOff)

  // 미리 보기 = 출력과 같은 그림: 가게 이름 칸이 비면 서버처럼 설정 "가게"의 가게 이름으로 (D-FB1-07)
  const fallback = shopNameFallback([stored, print.templates?.[kind === 'product' ? 'packing' : 'product']]) || trimLabelText(shopName)
  const preview: PagesOutcome | null = useMemo(() => {
    if (env.state !== 'ready' || template === null || problems.length > 0) return null
    const shown = trimLabelText(template.shopName) === '' && fallback !== '' ? ({ ...template, shopName: fallback } as LabelTemplate) : template
    return renderSample(env.env, shown, longest)
  }, [env, template, longest, problems.length, fallback])

  // 저장된 설정을 지금 검사(가장 넓은 날짜 포함)로 다시 본다 (L-11 13, D-STB-01). 서버·출력 기기는 저장된 설정을 그대로 쓰고,
  // 여기서는 저장이 막힐 때와 같은 문장으로 경고만 한다(새로 저장하는 것은 지금처럼 막힌다)
  const storedTemplate = stored?.template ?? null
  const storedFit = useMemo(() => {
    if (env.state !== 'ready' || storedTemplate === null) return null
    const result = checkTemplate(env.env, storedTemplate)
    return !result.ok && 'doesNotFit' in result ? result.doesNotFit : null
  }, [env, storedTemplate])

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
    const fresh = template.kind === 'product' ? productDesign(size, template.design ?? 'basic') : defaultTemplate('packing', size)
    const visible = (id: string) => items[id]?.visible ?? true
    const freshItems = fresh.items as Readonly<Record<string, TemplateItem>>
    const nextItems: Record<string, TemplateItem> = {}
    for (const id of itemIds) {
      const item = freshItems[id]
      if (item !== undefined) nextItems[id] = { ...item, visible: locked.includes(id) ? true : visible(id) }
    }
    if (template.kind === 'product') change({ ...(fresh as ProductTemplate), ...(template.captions ? { captions: template.captions } : {}), shopName: template.shopName, priceStyle: template.priceStyle, items: nextItems as ProductTemplate['items'] })
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
      const response = await put<{ template: LabelTemplate; version: number; message: string; storedShopName?: string }>(`/api/print/templates/${kind}`, { template: result.template, version: draft.version })
      const saved: StoredTemplate = { template: response.template, version: response.version, ...(response.storedShopName === undefined ? {} : { storedShopName: response.storedShopName }) }
      api?.store.setTemplate(kind, saved)
      setDraft(draftOf(saved))
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
        {storedFit !== null ? (
          <p className="notice" role="note" data-tone="warning" aria-label="저장된 라벨 설정 경고">
            {storedFit}
          </p>
        ) : null}
        <fieldset className="fieldset" ref={sizeRef}>
          <legend id={ids.size}>라벨 크기</legend>
          <div className="row label-size-choices" role="radiogroup" aria-labelledby={ids.size}>
            {sizes.map((size) => (
              <label key={size} className="choice">
                <input type="radio" name={`${kind}-size`} checked={template.size === size} onChange={() => changeSize(size)} />
                <span>{SIZE_WORD(size)}</span>
              </label>
            ))}
          </div>
          {sizes.length === 0 ? (
            <p className="notice" role="note" data-tone="warning">
              {NO_PACKING_SIZE_NOTE}
            </p>
          ) : null}
          {sizes.length === 0 ? null : <p className="hint">{sizeListBasis((profileId === null ? undefined : printerProfile(profileId))?.displayName ?? B1_PROFILE.displayName)}</p>}
          {sizes.length === 0 ? null : profileId !== null && !(sizes as readonly string[]).includes(template.size) ? (
            // 출력 기기의 프린터가 지금 크기를 찍지 못한다 — 출력 기기는 이 설정의 라벨에서 멈춘다 (L-11 13)
            <p className="notice" role="note" data-tone="warning" aria-label="라벨 크기 경고">
              {sizeNotSupportedMessage(template.size)} {SIZE_WARNING_HERE}
            </p>
          ) : null}
        </fieldset>
        {template.kind === 'product' ? (
          <fieldset className="fieldset">
            <legend>기본 디자인</legend>
            <div className="choice-list-plain">
              {([['basic', '기본형'], ['large', '큰 글씨형'], ['table', '표형']] as const).map(([design, word]) => (
                <button key={design} type="button" className="button button-small" aria-pressed={(template.design ?? 'basic') === design}
                  onClick={() => change({ ...productDesign(template.size, design), ...(template.captions ? { captions: template.captions } : {}), shopName: template.shopName, priceStyle: template.priceStyle })}>{word}</button>
              ))}
            </div>
          </fieldset>
        ) : null}
        {template.kind === 'product' ? (
          <fieldset className="fieldset">
            <legend>직접 넣는 문구</legend>
            {(template.captions ?? []).map((note, i, notes) => (
              <div className="field" key={i}>
                <label>문구 {i + 1}<input className="input" value={note.text} maxLength={CAPTION_TEXT_MAX}
                  placeholder="예: 향남꽃선비 라방" onChange={(e) => change({ ...template, captions: notes.map((n, j) => i === j ? { ...n, text: e.target.value } : n) })} /></label>
                <select aria-label={`문구 ${i + 1} 위치`} value={note.position}
                  onChange={(e) => change({ ...template, captions: notes.map((n, j) => i === j ? { ...n, position: e.target.value as CaptionPosition } : n) })}>
                  {CAPTION_POSITIONS.map((position) => <option key={position} value={position}>{CAPTION_WORDS[position]}</option>)}
                </select>
                <button type="button" className="button button-small" onClick={() => change({ ...template, captions: notes.filter((_, j) => i !== j) })}>문구 {i + 1} 삭제</button>
              </div>
            ))}
            <button type="button" className="button button-small" onClick={() => change({ ...template, captions: [...(template.captions ?? []),
              { text: '', position: CAPTION_POSITIONS[(template.captions?.length ?? 0) % CAPTION_POSITIONS.length] ?? 'topRight' }] })}>문구 추가</button>
            {problemsAt(problems, 'captions').map((message, i) => <p key={i} role="alert" className="field-error">{message}</p>)}
          </fieldset>
        ) : null}
        <div className="field">
          <label htmlFor={ids.shop}>가게 이름</label>
          <input
            id={ids.shop}
            className="input"
            autoComplete="off"
            value={template.shopName}
            // 대신 찍힐 이름이 있으면 흐린 예시 글 (FB1 D-FB1-18 (h)) — 속성 값(글)로만 들어간다
            {...(fallback === '' ? {} : { placeholder: shopNamePlaceholder(fallback) })}
            aria-invalid={shopTooLong}
            onChange={(event) => change({ ...template, shopName: event.target.value })}
          />
          {shopTooLong ? (
            <p className="field-error" role="alert">
              {SHOP_NAME_TOO_LONG}
            </p>
          ) : null}
          {serverProblem('shopName') !== null ? <p className="field-error">{serverProblem('shopName')}</p> : null}
          <p className="hint">{SHOP_NAME_HINT}</p>
          {items['shop']?.visible === false ? (
            <p className="notice" role="note" data-tone="warning">
              {SHOP_ITEM_OFF}
            </p>
          ) : null}
        </div>
        {template.kind === 'product' ? (
          <fieldset className="fieldset">
            <legend>{PRICE_STYLE_LABEL}</legend>
            <div className="choice-list-plain" role="radiogroup" aria-label={PRICE_STYLE_LABEL}>
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
        {nameOff && hasOptions ? (
          <p className="notice" role="note" data-tone="warning">
            {NAME_OFF_OPTIONS_NOTE}
          </p>
        ) : null}
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
