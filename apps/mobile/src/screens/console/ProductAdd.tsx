// 상품 추가 화면 (D-UX4-31, 사용자 지시 2026-11-09 토스 송금 사진 4·5·6): 상품 탭 오른쪽 아래 (+)로 연다(옛 "직접 넣기" 빠른 입력 시트를 바꿈).
// 맨 위 가운데 "상품 추가", 제목 없이 바로 밑줄 없는 큰 칸. 한 번에 하나씩 묻는다:
//   "상품 번호가 무엇인가요?" → [다음] → 번호는 위로 올라가고 "가격은 어떻게 되나요?"(아래에 한글 금액 "1만 5,000원")
//   → (다육이 방송이면) "어떤 품종인가요?" → 확인 화면 "15번 / 삼광색금 / 15,000원 / 상품을 추가할까요?" + [추가하기] → 방송 화면으로 돌아간다.
// 번호·가격은 시스템 키보드 대신 앱 숫자판(누르면 꾸욱 들어가며 작아진다), 값이 있으면 숫자판 바로 위에 [다음] 띠. 값 뒤에 "번"·"원"을 붙여 보인다.
// 품종은 글자라 휴대폰 키보드를 쓴다. 이미 올라온 단계는 눌러서 다시 고칠 수 있다.
// D-UX4-43 (사용자 지시 2026-11-09): 깜빡이는 글자 자리 표시는 없앴다. 글자를 넣고 지울 때 그 글자가 부드럽게 나타나고 사라지며, 숫자판 키는 햅틱과 함께 꾸욱 눌린다.
// [다음]은 꽉 찬 띠가 아니라 큰 단추, "품종 없이 넘어가기"는 토스 회색 칩. 품종 칸 휴대폰 키보드가 뜨면 [다음]이 키보드 위로 올라온다.
// 쓰기는 원문 칸(noText·priceText, SRV1 약속 2) — 가격은 "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다. 앱은 판정하지 않는다.
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, LayoutAnimation, Platform, TextInput, View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { productKey } from '../../lib/derive.ts'
import { BigButton, ErrorLine, PressScale, SoftChip, Txt, font, useKit, useWrongShake, Tap } from '../../ui/kit/index.ts'
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

/** 방송에 번호 끝이 없을 때 번호 칸이 받는 가장 큰 수 (네 자리) */
const NO_FALLBACK_MAX = 9999
/** 가격 칸 자리 수 (9억 원대까지) */
const PRICE_DIGITS = 9
export const PRICE_LIMIT = '가격은 9억 9,999만 9,999원까지 적을 수 있어요.'
export const noLimitWords = (max: number): string => `번호는 ${String(max)}번까지 적을 수 있어요.`

const won = (digits: string): string => `${Number(digits).toLocaleString('ko-KR')}원`

/** 앱 숫자판 키 하나 — 누르는 동안 꾸욱 들어가며 작아지고 옅은 바탕이 생긴다, 누른 순간 햅틱 (사진 5, D-UX4-43) */
function PadKey({ value, onPress }: { readonly value: string; readonly onPress: (value: string) => void }) {
  const { p } = useKit()
  return (
    <PressScale ariaLabel={value === 'back' ? '지우기' : value} onPress={() => onPress(value)} scale={0.86} pad={{ x: 10, y: 4 }} radius={18} style={{ flex: 1, height: KEY_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
      <Txt step="amount" weight="regular" ink={p.textSub}>
        {value === 'back' ? '←' : value}
      </Txt>
    </PressScale>
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

/** 글자를 넣고 지울 때의 움직임 (D-UX4-52, 사용자 지시 2026-11-09 "입력할 땐 위에서 아래로 내려왔다가 지울 때는 다시 올라가게") */
export const CHAR_IN_MS = 200
export const CHAR_OUT_MS = 160
/** 쉼표가 생기거나 없어져 옆 글자가 밀리는 시간 */
export const CHAR_SHIFT_MS = 200
const CHAR_DROP = 14

/** 큰 칸 글자 조각: 숫자는 왼쪽부터 몇 번째 숫자인지, 쉼표는 오른쪽부터 몇 번째 묶음인지로 이름을 붙인다 — 끝에 숫자를 넣고 지워도 남은 글자는 같은 조각이라, 쉼표만 옆으로 미끄러진다 */
export interface CharPiece {
  readonly key: string
  readonly char: string
}

export function charPieces(shown: string, suffix: string): CharPiece[] {
  if (shown === '') return []
  const chars = [...shown]
  const digitTotal = chars.filter((char) => /[0-9]/.test(char)).length
  const pieces: CharPiece[] = []
  let seen = 0
  for (const char of chars) {
    if (/[0-9]/.test(char)) {
      pieces.push({ key: `d${String(seen)}`, char })
      seen += 1
    } else {
      // 쉼표 뒤에 남은 숫자 수 ÷ 3 = 천·백만… 묶음
      pieces.push({ key: `c${String(Math.round((digitTotal - seen) / 3))}`, char })
    }
  }
  if (suffix !== '') pieces.push({ key: 'suffix', char: suffix })
  return pieces
}

/** 글자 조각 하나: 새로 생기면 위에서 내려오며 나타난다(처음 그릴 때는 그대로) */
function PieceChar({ char, color, enter, onPlace }: { readonly char: string; readonly color: string; readonly enter: boolean; readonly onPlace: (x: number, y: number) => void }) {
  const show = useRef(new Animated.Value(enter ? 0 : 1)).current
  useEffect(() => {
    if (!enter) return
    Animated.timing(show, { toValue: 1, duration: CHAR_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [enter, show])
  const drop = show.interpolate({ inputRange: [0, 1], outputRange: [-CHAR_DROP, 0] })
  return (
    <Animated.View onLayout={(event) => onPlace(event.nativeEvent.layout.x, event.nativeEvent.layout.y)} style={{ opacity: show, transform: [{ translateY: drop }] }}>
      <Txt step="amount" weight="bold" ink={color}>{char}</Txt>
    </Animated.View>
  )
}

/** 지운 글자 조각: 있던 자리에서 위로 올라가며 사라진다 — 자리를 차지하지 않아 남은 글자가 바로 미끄러진다 */
function LeavingChar({ char, color, x, y, onDone }: { readonly char: string; readonly color: string; readonly x: number; readonly y: number; readonly onDone: () => void }) {
  const hide = useRef(new Animated.Value(1)).current
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    Animated.timing(hide, { toValue: 0, duration: CHAR_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => done.current())
  }, [hide])
  const rise = hide.interpolate({ inputRange: [0, 1], outputRange: [-CHAR_DROP, 0] })
  return (
    <Animated.View aria-hidden pointerEvents="none" style={{ position: 'absolute', left: x, top: y, opacity: hide, transform: [{ translateY: rise }] }}>
      <Txt step="amount" weight="bold" ink={color}>{char}</Txt>
    </Animated.View>
  )
}

interface Leaving {
  readonly id: number
  readonly char: string
  readonly x: number
  readonly y: number
}

/**
 * 앱 숫자판으로 넣는 큰 칸: 비면 묻는 말(회색), 차면 값 + 붙임말(번·원). 글자 자리 표시(커서)는 없다 (D-UX4-43).
 * 넣은 글자는 위에서 내려오며 나타나고, 지운 글자는 위로 올라가며 사라진다. 쉼표가 생기거나 없어지면 옆 글자가 부드럽게 밀린다 (D-UX4-52).
 * 웹(시험)은 움직이지 않고 한 덩어리 글로 그린다.
 */
function BigNumber({ label, question, digits, format, suffix }: { readonly label: string; readonly question: string; readonly digits: string; readonly format: (digits: string) => string; readonly suffix: string }) {
  const { p } = useKit()
  const empty = digits === ''
  const shown = empty ? '' : format(digits)
  const pieces = charPieces(shown, suffix)
  const places = useRef(new Map<string, { readonly x: number; readonly y: number }>())
  const before = useRef<readonly CharPiece[]>(pieces)
  const ready = useRef(false)
  const counter = useRef(0)
  const [leaving, setLeaving] = useState<readonly Leaving[]>([])
  // 바뀐 그 그리기에서 옆으로 밀리는 움직임을 정한다(그리기 중에 불러야 바뀐 배치에 붙는다)
  const signature = pieces.map((piece) => piece.key).join('|')
  const lastSignature = useRef(signature)
  if (lastSignature.current !== signature) {
    lastSignature.current = signature
    if (Platform.OS !== 'web') LayoutAnimation.configureNext({ duration: CHAR_SHIFT_MS, update: { type: LayoutAnimation.Types.easeInEaseOut } })
  }
  useEffect(() => {
    ready.current = true
  }, [])
  useEffect(() => {
    const now = new Set(pieces.map((piece) => piece.key))
    const gone = before.current.filter((piece) => !now.has(piece.key))
    before.current = pieces
    if (gone.length === 0 || Platform.OS === 'web') return
    const added = gone.flatMap((piece) => {
      const place = places.current.get(piece.key)
      places.current.delete(piece.key)
      if (place === undefined) return []
      counter.current += 1
      return [{ id: counter.current, char: piece.char, x: place.x, y: place.y }]
    })
    if (added.length > 0) setLeaving((list) => [...list, ...added])
    // pieces는 signature가 같으면 같은 내용이다
  }, [signature, shown])
  const box = { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: BIG * 1.5 }
  if (empty && leaving.length === 0) {
    return (
      <View role="status" aria-label={question} style={box}>
        <Txt step="amount" weight="bold" ink={p.placeholder}>
          {question}
        </Txt>
      </View>
    )
  }
  if (Platform.OS === 'web') {
    return (
      <View role="status" aria-label={`${label} ${shown}${suffix}`} style={box}>
        <Txt step="amount" weight="bold" ink={p.text}>
          {`${shown}${suffix}`}
        </Txt>
      </View>
    )
  }
  return (
    <View role="status" aria-label={empty ? question : `${label} ${shown}${suffix}`} style={box}>
      {pieces.map((piece) => (
        <PieceChar key={piece.key} char={piece.char} color={p.text} enter={ready.current} onPlace={(x, y) => places.current.set(piece.key, { x, y })} />
      ))}
      {leaving.map((item) => (
        <LeavingChar key={`out-${String(item.id)}`} char={item.char} color={p.text} x={item.x} y={item.y} onDone={() => setLeaving((list) => list.filter((one) => one.id !== item.id))} />
      ))}
    </View>
  )
}

/** 이미 답한 단계 (위로 올라간 값) — 누르면 그 단계로 돌아가 고친다 */
function DoneLine({ label, value, onPress }: { readonly label: string; readonly value: string; readonly onPress: () => void }) {
  return (
    <Tap role="button" aria-label={`${label} ${value} 고치기`} onPress={onPress} style={({ pressed }) => ({ gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Txt step="body" color="textSub">
        {label}
      </Txt>
      <Txt step="title" weight="bold">
        {value}
      </Txt>
    </Tap>
  )
}

/** 숫자판·키보드 바로 위 [다음] — 꽉 찬 띠가 아닌 큰 단추 (D-UX4-43, 사용자 지시 "원래처럼 별도의 버튼으로") */
// 값이 없거나 틀리면 숨기지 않고 흐린 채로 눌리지 않는다 (D-UX4-54, 사용자 지시 2026-11-09 "처음에 안보이게 하지말고 비활성화로")
function NextButton({ onPress, disabled }: { readonly onPress: () => void; readonly disabled: boolean }) {
  return (
    <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: SPACE.sm }}>
      <BigButton label="다음" onPress={onPress} disabled={disabled} />
    </View>
  )
}

/**
 * 상품 추가 화면 틀 없는 내용 (D-UX4-57): 방송 화면 위 진짜 쌓인 화면(app/console/[id]/add)과, 경로가 없을 때(시험·웹) 방송 화면 안 겹친 화면이 같이 쓴다.
 * askName: 다육이 방송이면 품종도 묻는다 (사용자 지시 "방송 연결할 때 다육이를 선택했다면").
 * onAdded: 추가한 상품 열쇠 — 방송 화면이 그 상품을 잠깐 강조한다
 */
export function ProductAddFlow({ askName, onAdded }: { readonly askName: boolean; readonly onAdded: (key: string) => void }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const footer = useFooterInset()
  const [step, setStep] = useState<Step>('no')
  const [no, setNo] = useState('')
  const [price, setPrice] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const maxNumber = (() => {
    const value = api.data.broadcasts.get(api.b)?.settings['claim.maxNumber']
    return typeof value === 'number' && value > 0 ? value : null
  })()
  // 넣는 동안 바로 알리는 말 (토스 "출금할 수 있는 돈이 …이에요." 사진, D-UX4-54): 칸 아래 빨간 글 + 칸이 좌우로 흔들리고 에러 진동, [다음]은 흐리게
  // D-UX4-61 (사용자 지시 2026-11-09): 자리 수를 넘는 한 자리도 칸에 보여 준다 — 그래야 넘친 걸 보고 한 자리를 지울 수 있다. 그보다 더 치면 받지 않고 다시 흔든다
  const digitLimit = (step: Step): number => (step === 'no' ? Math.max(String(maxNumber ?? NO_FALLBACK_MAX).length, 1) : PRICE_DIGITS)
  const tooBig = (step: Step, digits: string): string | null => {
    if (digits === '') return null
    if (digits.length > digitLimit(step)) return step === 'no' ? noLimitWords(maxNumber ?? NO_FALLBACK_MAX) : PRICE_LIMIT
    if (step === 'no' && maxNumber !== null && Number(digits) > maxNumber) return noLimitWords(maxNumber)
    return null
  }
  const [again, setAgain] = useState(0)
  const type = (value: string) => {
    setError(null)
    const current = step === 'no' ? no : price
    const next = value === 'back' ? current.slice(0, -1) : (current + value).replace(/^0+/, '')
    if (next.length > digitLimit(step) + 1) {
      // 넘친 한 자리까지만 보여 주고, 더 치면 받지 않고 다시 흔든다(진동 포함)
      setAgain((count) => count + 1)
      return
    }
    if (step === 'no') setNo(next)
    else setPrice(next)
  }
  const nextFromNo = () => {
    const value = Number(no)
    if (no === '' || !Number.isSafeInteger(value) || value < 1) return setError('상품 번호를 숫자로 적어 주세요.')
    if (maxNumber !== null && value > maxNumber) return setError(noLimitWords(maxNumber))
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

  // 훅은 확인 화면으로 일찍 돌아가기 전에
  const active = step === 'no' ? no : step === 'price' ? price : name
  const shownError = error ?? (step === 'name' || step === 'confirm' ? null : tooBig(step, active))
  // 잘못이 생기거나 바뀌면, 또 넘쳐 치면 큰 칸이 좌우로 흔들리고 진동한다 (D-UX3-51 흔들기, D-UX4-61)
  const shake = useWrongShake(step === 'name' || step === 'confirm' ? null : shownError, again)
  if (step === 'confirm') {
    return (
      <View style={{ flex: 1 }}>
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
      </View>
    )
  }

  const onNext = step === 'no' ? nextFromNo : step === 'price' ? nextFromPrice : () => setStep('confirm')
  return (
    <View style={{ flex: 1 }}>
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
              {/* 토스 "잔액 · 159,952원 입력" 같은 회색 칩 — 꾸욱 눌린다 (D-UX4-43) */}
              {name.trim() === '' ? <SoftChip label="품종 없이 넘어가기" onPress={() => setStep('confirm')} /> : null}
            </>
          ) : (
            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              <BigNumber label={step === 'no' ? '번호' : '가격'} question={step === 'no' ? ASK_NO : ASK_PRICE} digits={active} format={step === 'no' ? (value) => value : (value) => Number(value).toLocaleString('ko-KR')} suffix={step === 'no' ? '번' : '원'} />
            </Animated.View>
          )}
          {/* 만 원 아래는 한글 읽기가 위 금액과 같아 그리지 않는다 */}
          {step === 'price' && Number(price) >= 10_000 ? (
            <Txt step="body" color="textSub">
              {koreanWon(Number(price))}
            </Txt>
          ) : null}
          {shownError !== null ? <ErrorLine large>{shownError}</ErrorLine> : null}
        </View>
      </View>
      <NextButton onPress={onNext} disabled={active.trim() === '' || shownError !== null} />
      {step === 'name' ? null : (
        <View style={{ paddingBottom: footer }}>
          <NumberKeys onKey={type} />
        </View>
      )}
    </View>
  )
}

/** 경로가 없을 때(시험·웹) 방송 화면 안에 겹쳐 그리는 상품 추가 화면 — 열 때마다 처음부터 */
export function ProductAddPage({ visible, onClose, askName, onAdded }: { readonly visible: boolean; readonly onClose: () => void; readonly askName: boolean; readonly onAdded: (key: string) => void }) {
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (visible) setRound((count) => count + 1)
  }, [visible])
  return (
    <SlidePage visible={visible} onClose={onClose} title={ADD_TITLE} name={ADD_TITLE} scroll={false} testID="product-add">
      <ProductAddFlow key={round} askName={askName} onAdded={onAdded} />
    </SlidePage>
  )
}

/** 상품 탭 오른쪽 아래 (+) 둥근 단추 (D-UX4-31) */
export function AddFab({ onPress, bottom }: { readonly onPress: () => void; readonly bottom: number }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={ADD_TITLE}
      testID="add-product"
      onPress={onPress}
      pressScale={0.94}
      style={({ pressed }) => ({ position: 'absolute', right: SPACE.xl, bottom, width: 58, height: 58, borderRadius: 29, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.primaryPressed : p.primary, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 })}
    >
      <View aria-hidden style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 22, height: 3, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.onPrimary }} />
        <View style={{ position: 'absolute', width: 3, height: 22, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.onPrimary }} />
      </View>
    </Tap>
  )
}
