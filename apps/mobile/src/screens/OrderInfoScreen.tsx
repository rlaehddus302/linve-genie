// 손님 정보 입력 (D-UX4-126, 사용자 지시 2026-11-11 "주문 상세 화면에서 … 성함, 휴대폰 번호, 주소를 … 모름 > … 그 영역을 누르면 다음 페이지로 넘어가서
// 우리가 예전에 상품 추가 페이지 만들었던거처럼 똑같이 해당 정보를 입력 받을 수 있게 해줘"):
// 상품 추가(ProductAdd.tsx)와 같은 모양 — 한 번에 하나씩 큰 칸으로 묻고, 답한 것은 위로 올라가 눌러서 다시 고친다. 뒤로(머리 ‹·밀기·안드로이드 뒤로)는 앞 단계로.
//   성함 → 휴대폰 번호 → 주소 → 상세 주소 → 확인 "이 정보로 저장할까요?" + [저장하기]
// 누른 칸부터 묻고, 그 뒤로는 아직 비어 있는(서버가 꼭 받아야 하는) 칸만 묻는다. 상세 주소는 주소를 물었을 때만 바로 뒤에 묻는다(없이 넘어가기 칩).
// 휴대폰 번호는 앱 숫자판으로 010-1234-5678처럼 줄표를 넣어 보인다. 성함·주소는 휴대폰 키보드.
// 저장은 배송지 쓰기(PUT /api/parcels/days/:date/address, 요청 번호로 한 번만)라 택배 배송지와 같은 곳에 남는다. 연락처는 본문으로만 보내고 로그에 넣지 않는다.
// 택배를 접수한 묶음·보관 기간이 지난 날짜는 고칠 수 없어 안내만 보인다.
import { useEffect, useRef, useState } from 'react'
import { Animated, View } from 'react-native'
import type { OrderDetailView, OrderInfoField } from '@livejjim/web/src/api/order-types.ts'
import type { AddressFields, BundleView } from '@livejjim/web/src/api/parcel-types.ts'
import { ADDRESS_EXPIRED, LOCKED_ADDRESS } from '@livejjim/web/src/lib/parcel-words.ts'
import { withQuery } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { ORDERS_TOPIC, orderPath, phoneDashes } from '../lib/orders.ts'
import { signalScreens } from '../lib/screen-signals.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { FocusInput, BigButton, ErrorLine, SoftChip, StackPage, Txt, font, useKit, useWrongShake } from '../ui/kit/index.ts'
import { SPACE, WEIGHT } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { BIG, BigNumber, CONFIRM_ABOVE, CONFIRM_BELOW, CONFIRM_GAP, DoneLine, NextButton, NumberKeys, useStepBack, type StepBack } from './console/ProductAdd.tsx'
import { useFooterInset } from './console/parts.tsx'
import { useAddressCommand } from './ParcelAddress.tsx'

export type { OrderInfoField } from '@livejjim/web/src/api/order-types.ts'

export const INFO_TITLE = '손님 정보'
export const ASK_INFO = { name: '성함이 무엇인가요?', phone: '휴대폰 번호가 무엇인가요?', address: '주소가 어디인가요?', detail: '상세 주소가 있나요?' } as const
export const INFO_LABELS = { name: '성함', phone: '휴대폰 번호', address: '주소', detail: '상세 주소' } as const
export const ASK_SAVE = '이 정보로 저장할까요?'
export const SKIP_DETAIL = '상세 주소 없이 넘어가기'
export const PHONE_LIMIT = '휴대폰 번호는 11자리까지 적을 수 있어요.'
export const PHONE_CHECK = '휴대폰 번호를 다시 확인해 주세요.'
const SAVE_FAILED = '저장하지 못했어요. 다시 눌러 주세요.'

/** 휴대폰 번호 자리 수 */
const PHONE_DIGITS = 11
/** 글자 수 (서버 배송지 규칙 ADDRESS_LIMITS와 같게 — apps/server/src/parcel/rules.ts) */
const MAX_LENGTH = { name: 20, address: 100, detail: 100 } as const

/** 묻는 단계 — 손님 정보 칸 셋 + 상세 주소 */
export type InfoStep = OrderInfoField | 'detail'
type Step = InfoStep | 'confirm'
/** 화면 순서 (위로 올라간 줄도 이 순서로) */
const ORDER: readonly InfoStep[] = ['name', 'phone', 'address', 'detail']
/** 서버가 꼭 받아야 하는 칸 */
const REQUIRED: readonly OrderInfoField[] = ['name', 'phone', 'address']

type Values = Readonly<Record<InfoStep, string>>

/** 휴대폰 번호처럼 보이나: 0으로 시작하는 10~11자리 */
export const looksLikePhone = (digits: string): boolean => /^0\d{9,10}$/.test(digits)

/** 치는 동안의 휴대폰 번호 줄표: 010 → 010-1234 → 010-1234-5678 (10자리는 010-123-4567). 넘친 자리는 끝 묶음에 붙는다 */
export function phoneTyping(digits: string): string {
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

/** 숫자판 누름 하나 → 휴대폰 번호 (앞의 0을 떼지 않는다). 넘친 뒤에 더 치면 null(받지 않음 — 흔든다) — 상품 추가 typeDigits와 같은 규칙 */
export function typePhone(current: string, value: string): string | null {
  if (value === 'back') return current.slice(0, -1)
  if (current.length > PHONE_DIGITS) return null
  return current + value
}

const filled = (step: OrderInfoField, values: Values): boolean => (step === 'phone' ? looksLikePhone(values.phone) : values[step].trim() !== '')

/**
 * 묻는 단계 (순수 계산): 누른 칸부터, 그 뒤로 비어 있는 꼭 받을 칸(화면 순서). 주소를 물으면 바로 뒤에 상세 주소.
 * 이미 아는 칸은 묻지 않는다(위에 줄로 보이고, 눌러서 고칠 수 있다)
 */
export function infoSteps(start: OrderInfoField, values: Values): InfoStep[] {
  const asked: InfoStep[] = []
  const ask = (step: InfoStep) => {
    if (asked.includes(step)) return
    asked.push(step)
    if (step === 'address') asked.push('detail')
  }
  ask(start)
  for (const step of REQUIRED) if (!filled(step, values)) ask(step)
  return asked
}

/** 앞 단계: 확인 ← 마지막으로 묻는 단계, 묻는 단계 ← 그 앞. 첫 단계면 null(화면을 닫는다) */
export function previousInfoStep(step: Step, asked: readonly InfoStep[]): InfoStep | null {
  if (step === 'confirm') return asked[asked.length - 1] ?? null
  const index = asked.indexOf(step)
  return index > 0 ? (asked[index - 1] ?? null) : null
}

/** 다음 단계 (마지막이면 확인) */
const nextInfoStep = (step: InfoStep, asked: readonly InfoStep[]): Step => asked[asked.indexOf(step) + 1] ?? 'confirm'

/** 눌러서 고칠 칸을 묻는 단계에 넣는다: 지금 단계 바로 앞(확인 화면이면 끝). 주소면 상세 주소도 같이 */
function insertStep(asked: readonly InfoStep[], step: InfoStep, before: Step): InfoStep[] {
  if (asked.includes(step)) return [...asked]
  const add: InfoStep[] = step === 'address' && !asked.includes('detail') ? ['address', 'detail'] : [step]
  const at = before === 'confirm' ? asked.length : Math.max(asked.indexOf(before), 0)
  return [...asked.slice(0, at), ...add, ...asked.slice(at)]
}

/** 처음 값: 배송지 → 지난 주문 배송지(장부) → 주문 상세에서 아는 성함·휴대폰 번호 */
function initialFields(bundle: BundleView, detail: OrderDetailView | null): AddressFields {
  if (bundle.address !== null) return { name: bundle.address.name, phone: bundle.address.phone, address: bundle.address.address, detail: bundle.address.detail, zip: bundle.address.zip, memo: bundle.address.memo }
  const ledger = bundle.ledger ?? null
  if (ledger !== null) return { name: ledger.name, phone: ledger.phone, address: ledger.address, detail: ledger.detail, zip: ledger.zip, memo: '' }
  return { name: detail?.name ?? '', phone: detail?.phone ?? '', address: detail?.address?.address ?? '', detail: detail?.address?.detail ?? '', zip: detail?.address?.zip ?? '', memo: '' }
}

export interface OrderInfoProps {
  readonly date: string
  readonly buyer: string
  readonly field: OrderInfoField
  readonly onBack: () => void
  readonly onSaved: () => void
}

/** 손님 정보 쌓인 화면 — 머리 ‹: 첫 단계가 아니면 앞 단계로, 첫 단계면 화면을 닫는다 (상품 추가와 같게) */
export function OrderInfoScreen({ date, buyer, field, onBack, onSaved }: OrderInfoProps) {
  const stepBack = useRef<(() => boolean) | null>(null)
  return (
    <StackPage name={INFO_TITLE} title={INFO_TITLE} onBack={() => { if (stepBack.current?.() !== true) onBack() }} scroll={false} testID="order-info">
      <OrderInfoFlow date={date} buyer={buyer} field={field} onBack={onBack} onSaved={onSaved} stepBack={stepBack} />
    </StackPage>
  )
}

/**
 * 틀 없는 내용 (주문 상세가 쌓인 경로 없이 제자리에 그릴 때·시험). onBack은 틀(머리 ‹)이 쓴다 — 틀이 stepBack을 넘기면 머리 ‹가 먼저 앞 단계로 간다.
 */
export function OrderInfoFlow({ date, buyer, field, onSaved, stepBack }: OrderInfoProps & { readonly stepBack?: StepBack }) {
  const [attempt, setAttempt] = useState(0)
  const bundleView = useCachedGet<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer }), attempt)
  const detailView = useCachedGet<OrderDetailView>(orderPath(date, buyer), attempt)
  const bundle = bundleView.data?.bundle ?? null
  // 처음 값은 한 번만 정한다 — 다시 받아도(409 등) 적던 것을 덮지 않는다
  const [initial, setInitial] = useState<AddressFields | null>(null)
  const detailSettled = detailView.data !== null || detailView.error !== null
  useEffect(() => {
    if (initial !== null || bundle === null || !detailSettled) return
    setInitial(initialFields(bundle, detailView.data))
  }, [initial, bundle, detailSettled, detailView.data])

  if (bundle === null) {
    if (bundleView.error === null) return <Loading />
    return (
      <View style={{ padding: SPACE.xl, gap: SPACE.sm }}>
        <Notice tone="danger" alert>{bundleView.error.message}</Notice>
        <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} />
      </View>
    )
  }
  if (bundle.locked || bundle.expired) {
    return (
      <View style={{ padding: SPACE.xl }}>
        <Notice tone="info">{bundle.locked ? LOCKED_ADDRESS : ADDRESS_EXPIRED}</Notice>
      </View>
    )
  }
  if (initial === null) return <Loading />
  return <InfoSteps date={date} buyer={buyer} field={field} initial={initial} onSaved={onSaved} onConflict={() => setAttempt((n) => n + 1)} stepBack={stepBack} />
}

function InfoSteps({ date, buyer, field, initial, onSaved, onConflict, stepBack }: { readonly date: string; readonly buyer: string; readonly field: OrderInfoField; readonly initial: AddressFields; readonly onSaved: () => void; readonly onConflict: () => void; readonly stepBack: StepBack | undefined }) {
  const { p } = useKit()
  const footer = useFooterInset()
  const command = useAddressCommand()
  const [start] = useState<Values>(() => ({ name: initial.name, phone: initial.phone.replace(/\D/g, ''), address: initial.address, detail: initial.detail }))
  const [texts, setTexts] = useState<Omit<Values, 'phone'>>(start)
  // 휴대폰 번호와 넘쳐 친 횟수(흔들기)를 한 상태로 — 누름마다 앞 누름의 결과에서 이어 간다 (상품 추가 D-UX4-102와 같게)
  const [typed, setTyped] = useState<{ readonly phone: string; readonly again: number }>({ phone: start.phone, again: 0 })
  const values: Values = { ...texts, phone: typed.phone }
  const again = typed.again
  const [asked, setAsked] = useState<InfoStep[]>(() => infoSteps(field, start))
  const [step, setStep] = useState<Step>(field)
  const conflict = useRef(onConflict)
  conflict.current = onConflict
  /** 칸 아래 빨간 글 (단계마다 — 서버가 그 칸을 거절했을 때도) */
  const [fieldError, setFieldError] = useState<{ readonly step: InfoStep; readonly text: string } | null>(null)
  /** [저장하기] 위 빨간 글 */
  const [saveError, setSaveError] = useState<string | null>(null)

  const go = (next: Step) => {
    setFieldError(null)
    setSaveError(null)
    setStep(next)
  }
  // 뒤로 = 앞 단계로 (상품 추가와 같게 — 머리 ‹·밀기·안드로이드 뒤로)
  const back = () => {
    const previous = previousInfoStep(step, asked)
    if (previous === null) return false
    go(previous)
    return true
  }
  const { edgeHandlers } = useStepBack(stepBack, back, previousInfoStep(step, asked) === null)

  const set = (key: Exclude<InfoStep, 'phone'>, value: string) => {
    if (fieldError?.step === key) setFieldError(null)
    setTexts((now) => ({ ...now, [key]: value }))
  }
  // 그리기 전에 연달아 눌러도 앞 누름의 결과에 이어 붙인다 (D-UX4-102). 넘친 뒤에 더 치면 받지 않고 다시 흔든다
  const typeKey = (value: string) => {
    if (fieldError?.step === 'phone') setFieldError(null)
    setTyped((now) => {
      const next = typePhone(now.phone, value)
      return next === null ? { ...now, again: now.again + 1 } : { ...now, phone: next }
    })
  }
  const open = (key: InfoStep) => {
    setAsked((now) => insertStep(now, key, step))
    go(key)
  }

  const save = async () => {
    setSaveError(null)
    // 주소를 바꿨으면 옛 우편번호는 버린다 — 옛 주소의 우편번호가 남아 택배가 다시 돌아오지 않게(빈 우편번호는 서버가 찾아 채운다, D-UX3-36). AUTO D-UX4-126
    const moved = values.address.trim() !== initial.address.trim()
    const address: AddressFields = { name: values.name.trim(), phone: values.phone, address: values.address.trim(), detail: values.detail.trim(), zip: moved ? '' : initial.zip, memo: initial.memo }
    const saved = await command.send('PUT', `/api/parcels/days/${date}/address`, { buyer, address })
    if (saved !== null) {
      signalScreens(ORDERS_TOPIC)
      onSaved()
    }
  }
  // 저장 거절: 칸 문제면 그 단계로 돌아가 칸 아래에, 아니면 [저장하기] 위에. 409(그 사이 바뀜·접수됨)면 지금 모습을 다시 받는다
  useEffect(() => {
    const error = command.error
    if (error === null) return
    if (error.status === 409) conflict.current()
    const wrong = ORDER.find((key) => error.problemFor(`address.${key}`) !== undefined)
    const text = wrong === undefined ? undefined : error.problemFor(`address.${wrong}`)?.message
    if (wrong !== undefined && text !== undefined) {
      setAsked((now) => insertStep(now, wrong, 'confirm'))
      setStep(wrong)
      setFieldError({ step: wrong, text })
      return
    }
    setSaveError(error.message === '' ? SAVE_FAILED : error.message)
  }, [command.error])

  const phoneOver = values.phone.length > PHONE_DIGITS ? PHONE_LIMIT : null
  const shownError = step === 'confirm' ? null : fieldError?.step === step ? fieldError.text : step === 'phone' ? phoneOver : null
  // 잘못이 생기거나 바뀌면, 또 넘쳐 치면 큰 칸이 좌우로 흔들리고 진동한다 (상품 추가와 같게)
  const shake = useWrongShake(step === 'phone' ? shownError : null, again)

  if (step === 'confirm') {
    const where = [values.address.trim(), values.detail.trim()].filter((part) => part !== '').join(' ')
    return (
      <Animated.View {...edgeHandlers} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: SPACE.xxl }}>
          <View style={{ flex: CONFIRM_ABOVE }} />
          <View testID="info-confirm" style={{ alignItems: 'center', gap: CONFIRM_GAP }}>
            <View testID="info-confirm-lines" style={{ alignItems: 'center', gap: 2 }}>
              {[values.name.trim(), phoneDashes(values.phone), where].map((line, index) => (
                <Txt key={ORDER[index] ?? line} step="amount" weight="bold" ink={p.primaryText} center>
                  {line}
                </Txt>
              ))}
            </View>
            <Txt step="amount" weight="bold" center>
              {ASK_SAVE}
            </Txt>
          </View>
          <View style={{ flex: CONFIRM_BELOW }} />
        </View>
        <View style={{ paddingHorizontal: SPACE.xl, paddingBottom: footer + SPACE.xs, gap: SPACE.sm }}>
          {saveError !== null ? <ErrorLine>{saveError}</ErrorLine> : null}
          <BigButton label="저장하기" busy={command.busy} disabled={command.busy} onPress={() => void save()} />
        </View>
      </Animated.View>
    )
  }

  const value = values[step]
  const onNext = () => {
    if (step === 'phone' && !looksLikePhone(values.phone)) {
      setFieldError({ step: 'phone', text: PHONE_CHECK })
      return
    }
    go(nextInfoStep(step, asked))
  }
  // 위로 올라간 줄: 앞서 답한 단계 + 묻지 않는(이미 아는) 칸 — 화면 순서로
  const done = ORDER.flatMap((key) => {
    if (key === step) return []
    const isAsked = asked.includes(key)
    if (isAsked ? asked.indexOf(key) > asked.indexOf(step) : values[key].trim() === '') return []
    const text = key === 'phone' ? phoneDashes(values.phone) : values[key].trim()
    return [{ key, text: text === '' ? '없음' : text }]
  })
  return (
    <Animated.View {...edgeHandlers} style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: SPACE.xxl, paddingTop: SPACE.xxl, gap: SPACE.xxl }}>
        {done.map((line) => <DoneLine key={line.key} label={INFO_LABELS[line.key]} value={line.text} onPress={() => open(line.key)} />)}
        <View style={{ gap: SPACE.sm }}>
          {step === 'phone' ? (
            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              <BigNumber key={step} label={INFO_LABELS.phone} question={ASK_INFO.phone} digits={values.phone} format={phoneTyping} suffix="" />
            </Animated.View>
          ) : (
            <>
              <FocusInput
                key={step}
                aria-label={ASK_INFO[step]}
                autoFocus
                value={value}
                onChangeText={(text) => set(step, text)}
                placeholder={ASK_INFO[step]}
                placeholderTextColor={p.placeholder}
                maxLength={MAX_LENGTH[step]}
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="next"
                onSubmitEditing={() => { if (value.trim() !== '') onNext() }}
                style={{ fontSize: BIG, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
              />
              {/* 품종 없이 넘어가기처럼 토스 회색 칩 */}
              {step === 'detail' && value.trim() === '' ? <SoftChip label={SKIP_DETAIL} onPress={() => go(nextInfoStep('detail', asked))} /> : null}
            </>
          )}
          {shownError !== null ? <ErrorLine large>{shownError}</ErrorLine> : null}
        </View>
      </View>
      <NextButton onPress={onNext} disabled={value.trim() === '' || shownError !== null} />
      {step === 'phone' ? (
        <View style={{ paddingBottom: footer }}>
          <NumberKeys onKey={typeKey} />
        </View>
      ) : null}
    </Animated.View>
  )
}
