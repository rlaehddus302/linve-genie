// 방송 시작 라벨 단계 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고 한다 하면 프린터 연결 도와주고
// 연결 확인하고 라벨 디자인 커스텀 한 다음에 테스트 출력한다음에 본방송으로"): 링크를 이은 뒤 방송 화면 전에 한 장씩.
// 1) "라벨을 뽑을까요?" — [안 뽑아요]는 라벨 기능을 끄고(L-13, 찜이 확정돼도 라벨이 쌓이지 않는다) 방송으로. [네]는 꺼져 있으면 켠다.
// 2) 프린터 연결 — 기억한 프린터면 [다시 연결], 아니면 [프린터 찾기](고르기 창). 이어지면 "연결됐어요 · 이름"으로 확인.
// 3) 라벨 꾸미기 — 크기·가게 이름·가격 표기·항목 켜고 끄기. 앱에는 라벨 그리기 코드가 없어(APP-01 AC3) 서버가 초안을 견본 값으로 그려 준다.
// 4) 테스트 인쇄 → "또렷하게 보이나요?" [예]면 이 기기를 출력 기기로 하고 방송으로. [아니요]면 도움말과 다시 인쇄.
// 프린터를 '기본·실험'으로 나눠 보이지 않는다 — 어느 프린터든 이 흐름에서 테스트 "예"를 거친다.
import { printerProfile, labelSizesForProfileId } from '@livejjim/printer'
import type { ProductTemplate } from '@livejjim/label'
import type { QueueSummary, StoredTemplate, Templates } from '@livejjim/web/src/api/print-types.ts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Image, Pressable, View } from 'react-native'
import { get, isApiError, post, put } from '../api/client.ts'
import { sizeWordMm, testHelp } from '../lib/test-help.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { BigButton, FormPage, Icon, RowGroup, TextField, ToggleRow, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { DEVICE_NAME_MAX, TEST_QUESTION, replaceQuestion } from './LabelsScreen.tsx'

export const LABEL_ASK_TITLE = '라벨을 뽑을까요?'
export const LABEL_ASK_BODY = '찜이 확정되면 상품 라벨을 프린터로 바로 뽑아요. 번호·구매자 이름이 찍혀 포장할 때 헷갈리지 않아요.'
export const CONNECT_TITLE = '프린터를 연결해 주세요'
export const DESIGN_TITLE = '라벨을 꾸며 주세요'
export const TEST_TITLE = '테스트 라벨을 뽑아 볼게요'
/** 출력 기기 이름 (라벨 화면 기본과 같다) */
const DEVICE_NAME = '내 휴대폰'
/** 끌 수 있는 항목 (번호·구매자는 늘 찍힌다 — L-3 PRODUCT_LOCKED) */
export const OPTIONAL_ITEMS: readonly { readonly id: 'shop' | 'price' | 'date' | 'name'; readonly word: string }[] = [
  { id: 'shop', word: '가게 이름' },
  { id: 'name', word: '품종' },
  { id: 'price', word: '가격' },
  { id: 'date', word: '날짜' },
]
/** 가격 표기 (견본 8,000원) */
export const PRICE_CHOICES: readonly { readonly style: ProductTemplate['priceStyle']; readonly word: string }[] = [
  { style: 'THOUSAND', word: '8 천원' },
  { style: 'WON', word: '8,000원' },
]

type Step = 'ask' | 'connect' | 'design' | 'test'

interface DraftPreview {
  readonly template: ProductTemplate
  readonly width: number
  readonly height: number
  readonly png: string
  readonly longest: string | null
}

const errorText = (caught: unknown): string => (isApiError(caught) ? caught.message : '하지 못했어요. 다시 눌러 주세요.')

export function LabelSetupScreen({ onBack, onDone }: { readonly onBack: () => void; readonly onDone: () => void }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [step, setStep] = useState<Step>('ask')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }
  const setLabels = async (enabled: boolean) => {
    if (snapshot.queue?.labelsEnabled === enabled) return
    await put('/api/settings/labels', { enabled })
    await labels.reload()
  }
  const go = (next: Step) => {
    setError(null)
    setStep(next)
  }
  const errorLine =
    error === null ? null : (
      <Notice tone="danger" alert>
        {error}
      </Notice>
    )

  if (step === 'ask') {
    return (
      <FormPage
        title={LABEL_ASK_TITLE}
        name="라벨"
        onBack={onBack}
        testID="label-setup-ask"
        actions={
          <>
            <BigButton label="네, 뽑을게요" busy={busy} onPress={() => void run(async () => {
              await setLabels(true)
              go('connect')
            })} />
            <BigButton kind="outline" label="안 뽑아요" disabled={busy} onPress={() => void run(async () => {
              await setLabels(false)
              onDone()
            })} />
          </>
        }
      >
        <Txt color="textSub">{LABEL_ASK_BODY}</Txt>
        {errorLine}
      </FormPage>
    )
  }
  if (step === 'connect') return <ConnectStep busy={busy} run={run} onBack={() => go('ask')} onNext={() => go('design')} error={errorLine} />
  if (step === 'design') return <DesignStep queue={snapshot.queue} profileId={snapshot.profileId} onBack={() => go('connect')} onSaved={() => go('test')} />
  return <TestStep busy={busy} run={run} onBack={() => go('design')} onDone={onDone} error={errorLine} />
}

/** 2) 프린터 연결과 확인 */
function ConnectStep({ busy, run, onBack, onNext, error }: { readonly busy: boolean; readonly run: (work: () => Promise<void>) => Promise<void>; readonly onBack: () => void; readonly onNext: () => void; readonly error: React.ReactNode }) {
  const { labels } = useServices()
  const { p } = useKit()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const name = linked ? ((snapshot.profileId === null ? undefined : printerProfile(snapshot.profileId))?.displayName ?? (snapshot.target === 'test' ? '시험용 프린터' : '라벨 프린터')) : null
  const disconnected = snapshot.printer === 'DISCONNECTED'
  return (
    <FormPage
      title={CONNECT_TITLE}
      name="프린터 연결"
      onBack={onBack}
      testID="label-setup-connect"
      actions={
        linked ? (
          <BigButton label="다음" onPress={onNext} />
        ) : (
          <>
            {snapshot.hasRemembered ? <BigButton label="다시 연결" busy={busy || snapshot.printer === 'CONNECTING'} disabled={!disconnected} onPress={() => void run(() => labels.reconnect())} /> : null}
            <BigButton kind={snapshot.hasRemembered ? 'outline' : 'primary'} label={snapshot.hasRemembered ? '다른 프린터 찾기' : '프린터 찾기'} busy={!snapshot.hasRemembered && (busy || snapshot.printer === 'CONNECTING')} disabled={!disconnected || busy} onPress={() => void run(() => labels.connect('bluetooth'))} />
            {snapshot.testPrinter ? <BigButton kind="outline" label="시험용 프린터" ariaLabel="시험용 프린터 (실제로 출력되지 않아요)" disabled={!disconnected || busy} onPress={() => void run(() => labels.connect('test'))} /> : null}
          </>
        )
      }
    >
      {linked ? (
        <View role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.soft }}>
          <Icon name="check" color={p.primary} size={24} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt step="bodyLarge" weight="bold">
              연결됐어요
            </Txt>
            <Txt color="textSub">{name}</Txt>
          </View>
        </View>
      ) : (
        <>
          <Txt color="textSub">프린터 전원을 켜고 휴대폰 가까이 두세요. 블루투스가 켜져 있어야 해요.</Txt>
          {snapshot.printer === 'CONNECTING' ? <Notice tone="info">프린터에 연결하는 중이에요…</Notice> : null}
        </>
      )}
      {snapshot.printerError !== null && !linked ? (
        <Notice tone="danger" alert>
          {snapshot.printerError.message}
        </Notice>
      ) : null}
      {error}
    </FormPage>
  )
}

/** 3) 라벨 꾸미기 — 서버가 그린 초안 미리 보기 */
function DesignStep({ queue, profileId, onBack, onSaved }: { readonly queue: QueueSummary | null; readonly profileId: string | null; readonly onBack: () => void; readonly onSaved: () => void }) {
  const { p } = useKit()
  const [stored, setStored] = useState<StoredTemplate<ProductTemplate> | null>(null)
  const [draft, setDraft] = useState<ProductTemplate | null>(null)
  const [preview, setPreview] = useState<DraftPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const asked = useRef(0)

  const load = () => {
    setError(null)
    get<Templates>('/api/print/templates').then(
      (view) => {
        setStored(view.product)
        // 가게 이름 칸은 저장된 본문 그대로 (비어 있으면 가게 설정의 이름을 따른다 — D-FB1-07)
        setDraft({ ...view.product.template, shopName: view.product.storedShopName ?? '' })
      },
      (caught: unknown) => setError(errorText(caught)),
    )
  }
  useEffect(load, [])

  /** 초안을 서버에 보내 그림을 받는다 (크기를 바꾸면 서버가 그 크기의 칸 배치로 고친 초안도 준다) */
  const draw = (template: ProductTemplate, resize?: string) => {
    const ticket = ++asked.current
    post<DraftPreview>('/api/print/templates/product/preview', resize === undefined ? { template } : { template, resize }).then(
      (view) => {
        if (ticket !== asked.current) return
        setPreview(view)
        setError(null)
        if (resize !== undefined) setDraft(view.template)
      },
      (caught: unknown) => {
        if (ticket === asked.current) setError(errorText(caught))
      },
    )
  }
  // 가게 이름은 칠 때마다가 아니라 잠깐 멈춘 뒤에 그린다
  useEffect(() => {
    if (draft === null) return
    const timer = setTimeout(() => draw(draft), 250)
    return () => clearTimeout(timer)
  }, [draft])

  const listed = queue?.labelSizes
  const sizes = listed !== undefined && listed.length > 0 ? listed : labelSizesForProfileId(profileId)
  const save = async () => {
    if (draft === null || stored === null || saving) return
    setSaving(true)
    setError(null)
    try {
      await put('/api/print/templates/product', { template: draft, version: stored.version })
      onSaved()
    } catch (caught) {
      // 다른 기기에서 먼저 바꿨으면(판 충돌) 새로 읽어 다시 고르게 한다
      if (isApiError(caught) && caught.status === 409) load()
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormPage
      title={DESIGN_TITLE}
      name="라벨 꾸미기"
      onBack={onBack}
      cards
      testID="label-setup-design"
      actions={<BigButton label="저장하고 다음" busy={saving} disabled={draft === null} onPress={() => void save()} />}
    >
      {preview !== null ? (
        <View aria-label="라벨 미리 보기" style={{ alignItems: 'center', padding: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surface }}>
          <Image accessibilityIgnoresInvertColors source={{ uri: `data:image/png;base64,${preview.png}` }} resizeMode="contain" style={{ width: '100%', aspectRatio: preview.width / preview.height, borderWidth: 1, borderColor: p.border, borderRadius: RADIUS.sm, borderCurve: 'continuous' }} />
          <View style={{ marginTop: SPACE.sm }}>
            <Txt step="caption" color="textSub">
              견본: 194번 · 왕비뇌신금 · 8,000원 · 우주천사
            </Txt>
          </View>
        </View>
      ) : null}
      {preview?.longest != null ? <Notice tone="warning">{`이름이 아주 길면 잘릴 수 있어요. ${preview.longest}`}</Notice> : null}
      {error !== null ? (
        <View style={{ gap: SPACE.sm }}>
          <Notice tone="danger" alert>
            {error}
          </Notice>
          {draft === null ? <BigButton kind="outline" label={RETRY_NOW} onPress={load} /> : null}
        </View>
      ) : null}
      {draft === null ? null : (
        <>
          <RowGroup title="라벨 크기">
            <View role="radiogroup" aria-label="라벨 크기" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, paddingHorizontal: SPACE.xl, paddingVertical: SPACE.sm }}>
              {sizes.map((size) => (
                <Choice key={size} word={sizeWordMm(size)} on={draft.size === size} onPress={() => draw(draft, size)} />
              ))}
            </View>
          </RowGroup>
          <RowGroup>
            <View style={{ paddingHorizontal: SPACE.xl, paddingBottom: SPACE.sm }}>
              <TextField label="가게 이름" value={draft.shopName} maxLength={40} help={draft.shopName.trim() === '' ? '비우면 가게 설정의 이름을 찍어요.' : undefined} onChangeText={(text) => setDraft({ ...draft, shopName: text })} />
            </View>
          </RowGroup>
          <RowGroup title="가격 표기">
            <View role="radiogroup" aria-label="가격 표기" style={{ flexDirection: 'row', gap: SPACE.sm, paddingHorizontal: SPACE.xl, paddingVertical: SPACE.sm }}>
              {PRICE_CHOICES.map((choice) => (
                <Choice key={choice.style} word={choice.word} on={draft.priceStyle === choice.style} onPress={() => setDraft({ ...draft, priceStyle: choice.style })} />
              ))}
            </View>
          </RowGroup>
          <RowGroup title="찍을 항목">
            <View style={{ paddingHorizontal: SPACE.xl }}>
              <Txt step="caption" color="textSub">
                번호와 구매자 이름은 늘 찍혀요.
              </Txt>
              {OPTIONAL_ITEMS.map((item) => (
                <ToggleRow key={item.id} title={item.word} on={draft.items[item.id].visible} onChange={(on) => setDraft({ ...draft, items: { ...draft.items, [item.id]: { ...draft.items[item.id], visible: on } } })} />
              ))}
            </View>
          </RowGroup>
        </>
      )}
    </FormPage>
  )
}

function Choice({ word, on, onPress }: { readonly word: string; readonly on: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="radio" aria-checked={on} aria-label={word} onPress={onPress} style={({ pressed }) => ({ minHeight: TOUCH.min, paddingHorizontal: SPACE.lg, justifyContent: 'center', borderRadius: RADIUS.lg, borderCurve: 'continuous', borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: pressed ? p.pressed : on ? p.freshBg : p.surface })}>
      <Txt weight={on ? 'bold' : 'medium'} color={on ? 'primaryText' : 'text'}>
        {word}
      </Txt>
    </Pressable>
  )
}

/** 4) 테스트 인쇄 → "예"면 이 기기를 출력 기기로 하고 방송으로 */
function TestStep({ busy, run, onBack, onDone, error }: { readonly busy: boolean; readonly run: (work: () => Promise<void>) => Promise<void>; readonly onBack: () => void; readonly onDone: () => void; readonly error: React.ReactNode }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [answeredNo, setAnsweredNo] = useState(false)
  const [taken, setTaken] = useState<string | null>(null)
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const help = testHelp(snapshot.profileId, snapshot.testSize ?? '50x30')

  /** 이 기기를 출력 기기로 (이미 그렇다면 그대로) 하고 방송으로 */
  const finish = (replace: boolean) =>
    void run(async () => {
      if (!snapshot.mine) {
        const outcome = await labels.become(DEVICE_NAME.slice(0, DEVICE_NAME_MAX), replace)
        if (outcome.kind === 'taken') {
          setTaken(outcome.name)
          return
        }
        if (outcome.kind === 'error') throw outcome.error
      }
      onDone()
    })
  const yes = () => {
    labels.answerTest(true)
    finish(false)
  }
  // 테스트 인쇄 중 표시는 snapshot.testing이 맡는다 — 결과를 묻는 동안 [예]가 막히지 않게 run(바쁨)으로 감싸지 않는다
  const printTest = () => {
    setAnsweredNo(false)
    void labels.printTest()
  }

  return (
    <FormPage
      title={TEST_TITLE}
      name="테스트 인쇄"
      onBack={onBack}
      testID="label-setup-test"
      actions={
        taken !== null ? (
          <>
            <BigButton label="이 기기로 바꾸기" busy={busy} onPress={() => finish(true)} />
            <BigButton kind="outline" label="그대로 두고 방송 시작" disabled={busy} onPress={onDone} />
          </>
        ) : snapshot.testPrinted && !answeredNo ? (
          <>
            <BigButton label="예" busy={busy} onPress={yes} />
            <BigButton kind="outline" label="아니요" disabled={busy} onPress={() => {
              setAnsweredNo(true)
              labels.answerTest(false)
            }} />
          </>
        ) : (
          <>
            <BigButton label={answeredNo ? '다시 테스트 인쇄' : '테스트 인쇄'} busy={busy || snapshot.testing} disabled={!linked || snapshot.job !== null} onPress={printTest} />
            {answeredNo ? <BigButton kind="outline" label="라벨은 나중에 하고 방송 시작" disabled={busy} onPress={onDone} /> : null}
          </>
        )
      }
    >
      {taken !== null ? (
        <Txt>{replaceQuestion(taken)}</Txt>
      ) : snapshot.testPrinted && !answeredNo ? (
        <Txt step="bodyLarge" weight="bold">
          {TEST_QUESTION}
        </Txt>
      ) : (
        <Txt color="textSub">프린터에서 테두리와 한글이 있는 테스트 라벨이 한 장 나와요.</Txt>
      )}
      {!linked ? <Notice tone="warning">프린터 연결이 끊겼어요. 뒤로 가서 다시 연결해 주세요.</Notice> : null}
      {answeredNo ? (
        <View role="list" aria-label="테스트 인쇄 도움말" style={{ gap: SPACE.xs }}>
          {help.lines.map((line) => (
            <View key={line} role="listitem">
              <Txt>{`· ${line}`}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {snapshot.printerError !== null ? (
        <Notice tone="danger" alert>
          {snapshot.printerError.message}
        </Notice>
      ) : null}
      {error}
    </FormPage>
  )
}
