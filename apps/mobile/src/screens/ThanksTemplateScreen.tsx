// 찜 감사 채팅 양식 (D-THANKS-FMT-01, 사용자 지시 2026-11-23 "찜 감사 채팅 양식 > 메뉴 만들고 커스텀 할 수 있는 페이지로 넘어가. 한줄에 하나씩 샘플 양식 넣어두고,
// 맨 아래에는 커스텀 선택 할 수 있게 하고 누르면 블록 코딩 느낌으로 커스텀 할 수 있게 해. 번호, 품명, 가격, 닉네임 블록 있고 꾹 눌러서 위치 이동할 수 있게 하고
// 사이사이에 블록 추가해서 글자 넣을 수 있게 하고"):
// - ThanksTemplateScreen: 흰 화면 큰 제목 + 예시 양식 한 줄에 하나(이름 · 예시 글) + 맨 아래 [직접 만들기]. 예시를 누르면 바로 저장.
// - ThanksTemplateEditor: 위에 미리 보기, 아래에 블록을 세로로 쌓는다. 블록을 꾹 누른 채 위아래로 끌면 자리가 바뀐다.
//   블록 사이 [+]를 누르면 글자 블록(또는 뺀 품명·가격 블록)을 그 자리에 넣는다. 번호·닉네임은 뺄 수 없다(손님이 누구 찜인지 알아야 한다).
//   맨 아래 [취소](왼쪽) · [저장](오른쪽) 한 줄 (절대 규칙 8).
import { THANKS_BLOCK_WORD, THANKS_BLOCKS_MAX, THANKS_REQUIRED, THANKS_TEXT_BLOCK_MAX, checkThanksTemplate, type ThanksBlock, type ThanksTemplate, type ThanksValueKind } from '@livejjim/core/format'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, ScrollView, TextInput, View, type TextInputInstance } from 'react-native'
import { useCachedGet } from '../lib/cached-get.ts'
import {
  THANKS_CUSTOM_TITLE,
  THANKS_SAMPLES,
  THANKS_SAMPLE_VALUES,
  THANKS_TEMPLATE_HELP,
  THANKS_TEMPLATE_PATH,
  THANKS_TEMPLATE_TITLE,
  moveBlock,
  readThanksTemplate,
  sampleOf,
  saveThanksTemplate,
  thanksPreview,
} from '../lib/thanks-template.ts'
import { BigButton, BottomSheet, ButtonRow, Icon, SheetChoices, StackPage, Tap, Txt, font, useBottomInset, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE, WEIGHT } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { PlainTitle } from './console/parts.tsx'

const CUSTOM = 'custom'

/** 지금 저장된 양식 (서버) — 화면 자료 기억을 같이 쓴다 */
export function useThanksTemplate(): { readonly blocks: ThanksTemplate | null; readonly error: string | null } {
  const { data, error } = useCachedGet<unknown>(THANKS_TEMPLATE_PATH)
  return { blocks: data === undefined || data === null ? null : readThanksTemplate(data), error: error === null || error === undefined ? null : '양식을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.' }
}

/** 예시 글 한 줄 (말풍선) */
function PreviewBubble({ text, testID }: { readonly text: string; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <View testID={testID} style={{ padding: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
      <Txt step="meta" color="textSub">미리 보기</Txt>
      <Txt step="bodyLarge" weight="medium">{text}</Txt>
    </View>
  )
}

export function ThanksTemplateScreen({ onBack, openCustom }: { readonly onBack: () => void; readonly openCustom: () => void }) {
  const { blocks, error: loadError } = useThanksTemplate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = blocks === null ? null : (sampleOf(blocks)?.id ?? CUSTOM)
  const pick = async (id: string) => {
    if (busy) return
    if (id === CUSTOM) {
      openCustom()
      return
    }
    const sample = THANKS_SAMPLES.find((item) => item.id === id)
    if (sample === undefined || id === current) return
    setBusy(true)
    setError(null)
    try {
      await saveThanksTemplate(sample.blocks)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }
  const custom = blocks !== null && current === CUSTOM ? thanksPreview(blocks) : '블록을 옮기고 글자를 넣어 내 양식을 만들어요'
  const choices = [
    ...THANKS_SAMPLES.map((sample) => ({ value: sample.id, label: sample.name, description: thanksPreview(sample.blocks) })),
    { value: CUSTOM, label: THANKS_CUSTOM_TITLE, description: `${custom} ›` },
  ]
  return (
    <StackPage name={THANKS_TEMPLATE_TITLE} onBack={onBack} testID="thanks-template">
      <View style={{ marginHorizontal: -SPACE.lg }}>
        <PlainTitle title={THANKS_TEMPLATE_TITLE} />
      </View>
      <Txt color="textSub">{THANKS_TEMPLATE_HELP}</Txt>
      {loadError !== null ? <Notice tone="danger" alert>{loadError}</Notice> : null}
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      {blocks === null && loadError === null ? <Loading /> : <SheetChoices label={THANKS_TEMPLATE_TITLE} choices={choices} value={current} onPick={(id) => void pick(id)} testID="thanks-template-choices" />}
    </StackPage>
  )
}

// ── 블록 편집 ─────────────────────────────────────────────────────────

interface Item {
  readonly id: number
  readonly block: ThanksBlock
}

/** 블록 한 줄 높이와 사이 [+] 줄 높이 — 끄는 동안 자리 계산에 쓴다 */
export const BLOCK_ROW = 52
export const BLOCK_GAP = 32
const STEP = BLOCK_ROW + BLOCK_GAP

const VALUE_SAMPLE: Readonly<Record<ThanksValueKind, string>> = {
  no: `${String(THANKS_SAMPLE_VALUES.no)}번`,
  name: THANKS_SAMPLE_VALUES.name,
  price: '10,000원',
  buyer: `${THANKS_SAMPLE_VALUES.buyerName}님`,
}

type Insert = ThanksValueKind | 'text'

/** [+] 판에서 넣을 수 있는 것: 글자 + 빠진 품명·가격 */
export function insertChoices(blocks: readonly ThanksBlock[]): readonly { readonly value: Insert; readonly label: string; readonly description: string }[] {
  const have = new Set(blocks.map((block) => block.k))
  const out: { value: Insert; label: string; description: string }[] = [{ value: 'text', label: '글자', description: '원하는 말을 적어 넣어요' }]
  for (const kind of ['no', 'name', 'price', 'buyer'] as const) if (!have.has(kind)) out.push({ value: kind, label: THANKS_BLOCK_WORD[kind], description: `예: ${VALUE_SAMPLE[kind]}` })
  return out
}

export function ThanksTemplateEditor({ onBack, onSaved }: { readonly onBack: () => void; readonly onSaved: () => void }) {
  const { blocks } = useThanksTemplate()
  if (blocks === null) {
    return (
      <StackPage title={THANKS_CUSTOM_TITLE} name={THANKS_CUSTOM_TITLE} onBack={onBack} testID="thanks-template-editor">
        <Loading />
      </StackPage>
    )
  }
  return <Editor initial={blocks} onBack={onBack} onSaved={onSaved} />
}

function Editor({ initial, onBack, onSaved }: { readonly initial: ThanksTemplate; readonly onBack: () => void; readonly onSaved: () => void }) {
  const { p } = useKit()
  const inset = useBottomInset()
  const next = useRef(0)
  const [items, setItems] = useState<Item[]>(() => initial.map((block) => ({ id: next.current++, block })))
  const [drag, setDrag] = useState<{ readonly id: number; readonly start: number; readonly at: number; readonly dy: number } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const [adding, setAdding] = useState<number | null>(null)
  const [focusId, setFocusId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocks = items.map((item) => item.block)
  const preview = thanksPreview(blocks)

  const itemsRef = useRef(items)
  itemsRef.current = items
  // 꾹 누른 뒤 손가락을 움직여 끌기를 넘겨받았는지 — 넘겨받기 전에 떼면(움직이지 않고) 끌기를 끝낸다
  const granted = useRef(false)
  const finish = () => {
    granted.current = false
    dragRef.current = null
    setDrag(null)
  }
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: () => dragRef.current !== null,
        onPanResponderGrant: () => {
          granted.current = true
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => {
          const now = dragRef.current
          if (now === null) return
          const list = itemsRef.current
          const target = Math.max(0, Math.min(list.length - 1, now.start + Math.round(gesture.dy / STEP)))
          const at = list.findIndex((item) => item.id === now.id)
          if (at >= 0 && at !== target) {
            const moved = moveBlock(list, at, target)
            itemsRef.current = moved
            setItems(moved)
          }
          const updated = { ...now, at: target, dy: gesture.dy }
          dragRef.current = updated
          setDrag(updated)
        },
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      }),
    [],
  )

  const move = (index: number, by: number) => setItems((list) => moveBlock(list, index, index + by))
  const remove = (id: number) => setItems((list) => list.filter((item) => item.id !== id))
  const setText = (id: number, text: string) => setItems((list) => list.map((item) => (item.id === id ? { id, block: { k: 'text', t: text.replace(/[\n\r]/g, ' ') } } : item)))
  const insert = (at: number, what: Insert) => {
    const id = next.current++
    const block: ThanksBlock = what === 'text' ? { k: 'text', t: '' } : { k: what }
    setItems((list) => [...list.slice(0, at), { id, block }, ...list.slice(at)])
    if (what === 'text') setFocusId(id)
    setAdding(null)
  }
  const save = async () => {
    const cleaned = blocks.filter((block) => block.k !== 'text' || block.t.trim() !== '')
    const wrong = checkThanksTemplate(cleaned)
    if (wrong !== null) {
      setError(wrong)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveThanksTemplate(cleaned)
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const full = items.length >= THANKS_BLOCKS_MAX
  const plus = (at: number) => (
    <View style={{ height: BLOCK_GAP, alignItems: 'center', justifyContent: 'center' }}>
      {full ? null : (
        <Tap role="button" aria-label={`${String(at + 1)}번째 자리에 블록 넣기`} testID={`thanks-add-${String(at)}`} disabled={drag !== null} onPress={() => setAdding(at)}
          style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.softPressed : p.soft })}>
          <Icon name="plus" size={16} color={p.textSub} />
        </Tap>
      )}
    </View>
  )

  return (
    <StackPage title={THANKS_CUSTOM_TITLE} name={THANKS_CUSTOM_TITLE} onBack={onBack} scroll={false} testID="thanks-template-editor"
      footer={
        <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: Math.max(inset, SPACE.md) }}>
          <ButtonRow>
            <BigButton kind="secondary" label="취소" onPress={onBack} />
            <BigButton label="저장" busy={busy} disabled={items.length === 0} testID="thanks-template-save" onPress={() => void save()} />
          </ButtonRow>
        </View>
      }>
      <ScrollView style={{ flex: 1 }} scrollEnabled={drag === null} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, paddingBottom: SPACE.xxl, gap: SPACE.md }}>
        <PreviewBubble text={preview === '' ? ' ' : preview} testID="thanks-template-preview" />
        <Txt step="meta" color="textSub">{'블록을 꾹 누른 채 위아래로 끌면 자리가 바뀌어요.\n+를 누르면 그 자리에 글자를 넣을 수 있어요.'}</Txt>
        {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
        <View {...pan.panHandlers} role="list" aria-label="감사 채팅 블록" testID="thanks-blocks">
          {plus(0)}
          {items.map((item, index) => {
            const dragging = drag?.id === item.id
            const offset = dragging && drag !== null ? drag.dy - (drag.at - drag.start) * STEP : 0
            return (
              <View key={item.id} style={{ zIndex: dragging ? 2 : 1 }}>
                <BlockRow
                  item={item}
                  index={index}
                  count={items.length}
                  dragging={dragging}
                  offset={offset}
                  focus={focusId === item.id}
                  onLong={() => {
                    const started = { id: item.id, start: index, at: index, dy: 0 }
                    dragRef.current = started
                    setDrag(started)
                  }}
                  onRelease={() => { if (dragRef.current !== null && !granted.current) finish() }}
                  onMove={(by) => move(index, by)}
                  onRemove={() => remove(item.id)}
                  onText={(text) => setText(item.id, text)}
                />
                {plus(index + 1)}
              </View>
            )
          })}
        </View>
      </ScrollView>
      <BottomSheet visible={adding !== null} onClose={() => setAdding(null)} title="블록 넣기">
        <SheetChoices label="블록 넣기" choices={insertChoices(blocks)} value={null} onPick={(what) => { if (adding !== null) insert(adding, what) }} testID="thanks-insert-choices" />
      </BottomSheet>
    </StackPage>
  )
}

function BlockRow({ item, index, count, dragging, offset, focus, onLong, onRelease, onMove, onRemove, onText }: {
  readonly item: Item
  readonly index: number
  readonly count: number
  readonly dragging: boolean
  readonly offset: number
  readonly focus: boolean
  readonly onLong: () => void
  readonly onRelease: () => void
  readonly onMove: (by: number) => void
  readonly onRemove: () => void
  readonly onText: (text: string) => void
}) {
  const { p } = useKit()
  const input = useRef<TextInputInstance>(null)
  useEffect(() => {
    if (focus) input.current?.focus()
  }, [focus])
  const { block } = item
  const text = block.k === 'text'
  const word = text ? '글자' : THANKS_BLOCK_WORD[block.k]
  const removable = text || !(THANKS_REQUIRED as readonly string[]).includes(block.k)
  const fill = text ? p.surface : p.primary
  const ink = text ? p.text : p.onPrimary
  const actions = [...(index > 0 ? [{ name: 'up', label: '위로 옮기기' }] : []), ...(index < count - 1 ? [{ name: 'down', label: '아래로 옮기기' }] : [])]
  return (
    <View
      role="listitem"
      aria-label={text ? `글자 블록 ${block.t}` : `${word} 블록`}
      accessibilityActions={actions}
      onAccessibilityAction={(event) => onMove(event.nativeEvent.actionName === 'up' ? -1 : 1)}
      testID={`thanks-block-${String(index)}`}
      style={{ transform: [{ translateY: offset }, { scale: dragging ? 1.03 : 1 }], boxShadow: dragging ? '0px 6px 16px rgba(0, 0, 0, 0.18)' : undefined, borderRadius: RADIUS.lg, borderCurve: 'continuous' }}
    >
      <Tap
        onLongPress={onLong}
        delayLongPress={250}
        onPressOut={onRelease}
        haptic
        pressScale={1}
        aria-label={`${word} 블록 꾹 눌러 옮기기`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, height: BLOCK_ROW, paddingHorizontal: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: fill, borderWidth: text ? 1.5 : 0, borderColor: p.borderStrong }}
      >
        <Txt step="caption" weight="bold" ink={text ? p.textSub : ink}>{'⋮⋮'}</Txt>
        <Txt step="body" weight="bold" ink={ink}>{word}</Txt>
        {text ? (
          <TextInput
            ref={input}
            value={block.t}
            onChangeText={onText}
            maxLength={THANKS_TEXT_BLOCK_MAX}
            placeholder="여기에 글자를 적어요"
            placeholderTextColor={p.placeholder}
            aria-label="글자 블록 내용"
            testID={`thanks-text-${String(index)}`}
            style={{ flex: 1, fontSize: 16, color: p.text, paddingVertical: 0, ...font(WEIGHT.regular) }}
          />
        ) : (
          <View style={{ flex: 1 }}>
            <Txt step="body" ink={ink} numberOfLines={1}>{VALUE_SAMPLE[block.k]}</Txt>
          </View>
        )}
        {removable ? (
          <Tap role="button" aria-label={`${word} 블록 빼기`} testID={`thanks-remove-${String(index)}`} onPress={onRemove} hitSlop={8}
            style={{ width: 28, height: 28, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: text ? p.soft : 'rgba(255,255,255,0.18)' }}>
            <Txt step="body" weight="bold" ink={text ? p.textSub : ink}>×</Txt>
          </Tap>
        ) : null}
      </Tap>
    </View>
  )
}
