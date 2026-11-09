// 상품 추가 화면 (D-UX4-31, 사용자 지시 2026-11-09 토스 송금 사진 4·5·6): 상품 탭 오른쪽 아래 (+)로 연다(옛 "직접 넣기" 빠른 입력 시트를 바꿈).
// 맨 위 가운데 "상품 추가", 제목 없이 바로 밑줄 없는 큰 칸. 한 번에 하나씩 묻는다:
//   "상품 번호가 무엇인가요?" → [다음] → 번호는 위로 올라가고 "가격은 어떻게 되나요?"(아래에 한글 금액 "1만 5,000원")
//   → (다육이 방송이면) "어떤 품종인가요?" → 확인 화면 "15번 / 삼광색금 / 15,000원 / 상품을 추가할까요?" + [추가하기] → 방송 화면으로 돌아간다.
// 번호·가격은 시스템 키보드 대신 앱 숫자판(누르면 꾸욱 들어가며 작아진다), 값이 있으면 숫자판 바로 위에 [다음] 띠. 값 뒤에 "번"·"원"을 붙여 보인다.
// 품종은 글자라 휴대폰 키보드를 쓴다. 이미 올라온 단계는 눌러서 다시 고칠 수 있다.
// 쓰기는 원문 칸(noText·priceText, SRV1 약속 2) — 가격은 "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다. 앱은 판정하지 않는다.
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, TextInput, View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { productKey } from '../../lib/derive.ts'
import { BigButton, ErrorLine, Txt, font, useKit } from '../../ui/kit/index.ts'
import { SPACE, TYPE, WEIGHT } from '../../ui/kit/tokens.ts'
import { useConsoleApi } from './context.ts'
import { SlidePage, useFooterInset } from './parts.tsx'

type Step = 'no' | 'price' | 'name' | 'confirm'

export const ADD_TITLE = '상품 추가'
export const ASK_NO = '상품 번호가 무엇인가요?'
export const ASK_PRICE = '가격은 어떻게 되나요?'
export const ASK_NAME = '어떤 품종인가요?'
export const ASK_ADD = '상품을 추가할까요?'

/** 큰 칸 글자 (토스 "얼마나 옮길까요?" 사진을 재어 — 키트 headline과 같은 크기) */
const BIG = TYPE.amount
/** 숫자판 키 높이 */
const KEY_HEIGHT = 64
const PAD: readonly (readonly string[])[] = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['00', '0', 'back']]

const won = (digits: string): string => `${Number(digits).toLocaleString('ko-KR')}원`

/** 앱 숫자판 키 하나 — 누르는 동안 꾸욱 들어가며 작아지고 옅은 바탕이 생긴다 (사진 5) */
function PadKey({ value, onPress }: { readonly value: string; readonly onPress: (value: string) => void }) {
  const { p } = useKit()
  const press = useRef(new Animated.Value(0)).current
  const to = (target: number) => {
    if (Platform.OS === 'web') return
    Animated.timing(press, { toValue: target, duration: target === 1 ? 70 : 160, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] })
  return (
    <Pressable role="button" aria-label={value === 'back' ? '지우기' : value} onPress={() => onPress(value)} onPressIn={() => to(1)} onPressOut={() => to(0)} style={{ flex: 1, height: KEY_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', top: 4, bottom: 4, left: 10, right: 10, borderRadius: 18, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, opacity: press, transform: [{ scale }] }} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Txt step="amount" weight="regular" ink={p.textSub}>
          {value === 'back' ? '←' : value}
        </Txt>
      </Animated.View>
    </Pressable>
  )
}

function NumberKeys({ onKey }: { readonly onKey: (value: string) => void }) {
  return (
    <View role="group" aria-label="숫자판" style={{ paddingHorizontal: SPACE.sm, paddingTop: SPACE.xs }}>
      {PAD.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row' }}>
          {row.map((value) => <PadKey key={value} value={value} onPress={onKey} />)}
        </View>
      ))}
    </View>
  )
}

/** 깜빡이는 글자 자리 표시 (사진 4의 칸 앞 막대) */
function Caret() {
  const { p } = useKit()
  const blink = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (Platform.OS === 'web') return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 0, duration: 450, delay: 300, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [blink])
  return <Animated.View aria-hidden style={{ width: 2.5, height: BIG + 4, marginHorizontal: 2, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.primary, opacity: blink }} />
}

/** 앱 숫자판으로 넣는 큰 칸: 비면 묻는 말(회색), 차면 값 + 붙임말(번·원) */
function BigNumber({ label, question, shown, empty }: { readonly label: string; readonly question: string; readonly shown: string; readonly empty: boolean }) {
  const { p } = useKit()
  return (
    <View role="status" aria-label={empty ? question : `${label} ${shown}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: BIG * 1.5 }}>
      {empty ? <Caret /> : null}
      <Txt step="amount" weight="bold" ink={empty ? p.placeholder : p.text}>
        {empty ? question : shown}
      </Txt>
      {empty ? null : <Caret />}
    </View>
  )
}

/** 이미 답한 단계 (위로 올라간 값) — 누르면 그 단계로 돌아가 고친다 */
function DoneLine({ label, value, onPress }: { readonly label: string; readonly value: string; readonly onPress: () => void }) {
  return (
    <Pressable role="button" aria-label={`${label} ${value} 고치기`} onPress={onPress} style={({ pressed }) => ({ gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Txt step="body" color="textSub">
        {label}
      </Txt>
      <Txt step="title" weight="bold">
        {value}
      </Txt>
    </Pressable>
  )
}

/** 숫자판 바로 위 [다음] 띠 (사진 5 — 가장자리까지 꽉 찬 주색 띠) */
function NextBar({ label = '다음', onPress, disabled }: { readonly label?: string; readonly onPress: () => void; readonly disabled?: boolean }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.primaryPressed : p.primary, opacity: disabled === true ? 0.5 : 1 })}>
      <Txt step="lead" weight="medium" color="onPrimary">
        {label}
      </Txt>
    </Pressable>
  )
}

/**
 * askName: 다육이 방송이면 품종도 묻는다 (사용자 지시 "방송 연결할 때 다육이를 선택했다면").
 * onAdded: 추가한 상품 열쇠 — 방송 화면이 그 상품을 잠깐 강조한다
 */
export function ProductAddPage({ visible, onClose, askName, onAdded }: { readonly visible: boolean; readonly onClose: () => void; readonly askName: boolean; readonly onAdded: (key: string) => void }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const footer = useFooterInset()
  const [step, setStep] = useState<Step>('no')
  const [no, setNo] = useState('')
  const [price, setPrice] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!visible) return
    setStep('no')
    setNo('')
    setPrice('')
    setName('')
    setError(null)
    setBusy(false)
  }, [visible])

  const maxNumber = (() => {
    const value = api.data.broadcasts.get(api.b)?.settings['claim.maxNumber']
    return typeof value === 'number' && value > 0 ? value : null
  })()
  const type = (value: string) => {
    setError(null)
    const current = step === 'no' ? no : price
    const limit = step === 'no' ? Math.max(String(maxNumber ?? 9999).length, 1) : 9
    let next = value === 'back' ? current.slice(0, -1) : (current + value).replace(/^0+/, '')
    if (next.length > limit) next = current
    if (step === 'no') setNo(next)
    else setPrice(next)
  }
  const nextFromNo = () => {
    const value = Number(no)
    if (no === '' || !Number.isSafeInteger(value) || value < 1) return setError('상품 번호를 숫자로 적어 주세요.')
    if (maxNumber !== null && value > maxNumber) return setError(`번호는 ${String(maxNumber)}번까지 적을 수 있어요.`)
    const existing = api.data.products.get(productKey(api.b, value))
    if (existing !== undefined && existing.status !== 'CLOSED') return setError(`${String(value)}번은 이미 있어요. 다른 번호를 적어 주세요.`)
    setError(null)
    setStep('price')
  }
  const nextFromPrice = () => {
    if (price === '' || Number(price) < 100) return setError('가격은 100원 이상으로 적어 주세요.')
    setError(null)
    setStep(askName ? 'name' : 'confirm')
  }
  const add = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const value = Number(no)
    const key = productKey(api.b, value)
    const raw = { noText: no, priceText: `${price}원` }
    const trimmed = name.trim()
    try {
      const existing = api.data.products.get(key)
      if (existing !== undefined && existing.status === 'CLOSED') {
        // 지운(판매 종료한) 번호를 다시 올리면 새 값으로 고친 뒤 다시 판다
        await api.command({ type: 'product.update', b: api.b, ...raw, ...(trimmed === '' ? {} : { name: trimmed }) })
        await api.command({ type: 'product.open', b: api.b, no: value })
      } else {
        const result = await api.command({ type: 'product.register', b: api.b, ...raw, name: trimmed })
        if (!result.changed) throw new Error(`${String(value)}번은 이미 있어요. 다른 번호로 다시 해 주세요.`)
      }
      setBusy(false)
      onAdded(key)
    } catch (caught) {
      setBusy(false)
      setError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : '추가하지 못했어요. 다시 눌러 주세요.')
    }
  }

  const done: { readonly step: Step; readonly label: string; readonly value: string }[] = []
  if (step !== 'no') done.push({ step: 'no', label: '번호', value: `${no}번` })
  if (step === 'name') done.push({ step: 'price', label: '가격', value: won(price) })

  if (step === 'confirm') {
    return (
      <SlidePage visible={visible} onClose={onClose} title={ADD_TITLE} name={ADD_TITLE} scroll={false} testID="product-add">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.xxl, gap: 2 }}>
          {[`${no}번`, ...(name.trim() === '' ? [] : [name.trim()]), won(price)].map((line) => (
            <Txt key={line} step="amount" weight="bold" ink={p.primaryText} center>
              {line}
            </Txt>
          ))}
          <Txt step="amount" weight="bold" center>
            {ASK_ADD}
          </Txt>
        </View>
        <View style={{ paddingHorizontal: SPACE.xl, paddingBottom: footer + SPACE.xs, gap: SPACE.sm }}>
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          <BigButton label="추가하기" busy={busy} disabled={busy} onPress={() => void add()} />
        </View>
      </SlidePage>
    )
  }

  const active = step === 'no' ? no : step === 'price' ? price : name
  const onNext = step === 'no' ? nextFromNo : step === 'price' ? nextFromPrice : () => setStep('confirm')
  return (
    <SlidePage visible={visible} onClose={onClose} title={ADD_TITLE} name={ADD_TITLE} scroll={false} testID="product-add">
      <View style={{ flex: 1, paddingHorizontal: SPACE.xxl, paddingTop: SPACE.xxl, gap: SPACE.xxl }}>
        {done.map((line) => <DoneLine key={line.step} label={line.label} value={line.value} onPress={() => { setError(null); setStep(line.step) }} />)}
        <View style={{ gap: SPACE.sm }}>
          {step === 'name' ? (
            <>
              <TextInput
                aria-label={ASK_NAME}
                autoFocus
                value={name}
                onChangeText={(value) => setName(value)}
                placeholder={ASK_NAME}
                placeholderTextColor={p.placeholder}
                maxLength={40}
                returnKeyType="next"
                onSubmitEditing={() => { if (name.trim() !== '') setStep('confirm') }}
                style={{ fontSize: BIG, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
              />
              {name.trim() === '' ? (
                <Pressable role="button" aria-label="품종 없이 넘어가기" onPress={() => setStep('confirm')} hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: SPACE.xs }}>
                  <Txt step="body" color="textSub">품종 없이 넘어가기</Txt>
                </Pressable>
              ) : null}
            </>
          ) : (
            <BigNumber label={step === 'no' ? '번호' : '가격'} question={step === 'no' ? ASK_NO : ASK_PRICE} shown={step === 'no' ? `${no}번` : won(price)} empty={active === ''} />
          )}
          {/* 만 원 아래는 한글 읽기가 위 금액과 같아 그리지 않는다 */}
          {step === 'price' && Number(price) >= 10_000 ? (
            <Txt step="body" color="textSub">
              {koreanWon(Number(price))}
            </Txt>
          ) : null}
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
        </View>
      </View>
      {active.trim() === '' ? null : <NextBar onPress={onNext} />}
      {step === 'name' ? null : (
        <View style={{ paddingBottom: footer }}>
          <NumberKeys onKey={type} />
        </View>
      )}
    </SlidePage>
  )
}

/** 상품 탭 오른쪽 아래 (+) 둥근 단추 (D-UX4-31) */
export function AddFab({ onPress, bottom }: { readonly onPress: () => void; readonly bottom: number }) {
  const { p } = useKit()
  return (
    <Pressable
      role="button"
      aria-label={ADD_TITLE}
      testID="add-product"
      onPress={onPress}
      style={({ pressed }) => ({ position: 'absolute', right: SPACE.xl, bottom, width: 58, height: 58, borderRadius: 29, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.primaryPressed : p.primary, transform: [{ scale: pressed ? 0.94 : 1 }], shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 })}
    >
      <View aria-hidden style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 22, height: 3, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.onPrimary }} />
        <View style={{ position: 'absolute', width: 3, height: 22, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.onPrimary }} />
      </View>
    </Pressable>
  )
}
