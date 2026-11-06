// 휴대폰 번호 확인 (D-UX3-30 → 모양·흐름은 D-UX3-49, 사용자 지시 2026-11-07 사진대로):
// ① "본인 확인을 위해 휴대폰 번호를 입력해 주세요" — 밑줄 칸 하나. 11자리가 차면 아래 [다음]이 켜지고, 눌러야 인증번호를 보내고 다음 화면으로 (D-UX3-50).
//    11자리를 다 넣었는데 010으로 시작하지 않으면 빨간 밑줄·라벨과 "휴대폰 번호를 다시 확인해 주세요." ([다음]·[지우기]·키보드는 그대로)
// ② "문자로 받은 인증번호 6자리를 입력해 주세요" — 남은 시간, 6칸. 6자리가 차면 키보드와 아래 글자 단추를 숨기고 서버에 확인한다.
//    틀리면 한 칸으로 부드럽게 합쳐 빨갛게 + "인증번호가 맞지 않아요."(남은 횟수는 알리지 않는다), 키보드·단추가 다시 나온다 (D-UX3-53).
//    3분이 지나면 "입력할 수 있는 시간이 지났어요" 팝업, 5번 틀리면 "입력 횟수를 초과했어요" 팝업 — 둘 다 [닫기]·[다시 받기] (D-UX3-53, 토스 사진 1·2).
//    키보드 위 밑줄 글자 [문자가 안 오나요?]를 누르면 팝업 — 보낸 지 30초 전이면 "N초 뒤에 받을 수 있어요"와 꺼진 [다시 받기]가 30초에 켜진다 (D-UX3-53).
//    숫자는 들어올 때 살짝 떠오르며 나타난다. 칸은 문자 자동 채우기(아이폰 oneTimeCode·안드로이드 sms-otp)를 켠다.
// 아래 단추는 키보드가 뜨면 키보드 바로 위로 올라온다. 이 화면이 떠 있는 동안 맨 위 상태 막대 자리도 흰색이다(D-UX3-50).
// D-UX3-51: 잘못이어도 [다음]은 그대로 — 누르면 칸이 다시 흔들리고 진동한다. 뒤로·제목 자리와 잘못 모양은 공통 부품(PAGE·ErrorLine·useWrongShake).
// ③ "인증 성공" 2초 뒤 다음(홈·있는 계정 안내)으로. 화면 사이는 밀어 넘긴다(SlideSwitch).
// 가입 중(가입 표)과 로그인한 계정(번호 등록)이 같이 쓴다. 왼쪽 위 ‹는 ①에서 처음으로·로그아웃, ②에서 번호 다시 넣기.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, type TextInputInstance } from 'react-native'
import {
  CODE_ASK_TITLE,
  CODE_FIELD,
  CODE_LEFT,
  CODE_LOCKED_TEXT,
  CODE_NOT_COMING,
  CODE_RESEND_ASK,
  CODE_RESEND_GO,
  CODE_RESEND_WAIT_SECONDS,
  CODE_RESENT,
  CODE_TIME_OVER_TITLE,
  codeResendIn,
  formatMobileInput,
  PHONE_ASK_TITLE,
  PHONE_FIELD,
  PHONE_NEXT,
  POPUP_CLOSE,
  PHONE_RECHECK,
  PHONE_VERIFIED,
} from '@livejjim/web/src/lib/social-login.ts'
import { isApiError } from '../api/client.ts'
import { APP_LOGIN_FAILED } from '../lib/social-auth.ts'
import { BackButton, BigButton, ErrorLine, Icon, PopupDialog, TONES, Txt, UnderlineField, useBottomInset, useKeyboardShown, useKit, useTopInset, useWhiteTop, useWrongShake } from '../ui/kit/index.ts'
import { SlideSwitch } from '../ui/kit/slide.tsx'
import { PAGE, RADIUS, SPACE, TYPE, WEIGHT } from '../ui/kit/tokens.ts'

/** 인증번호 유효 시간 — 서버(CODE_TTL_MS)와 같다 */
export const CODE_TTL_SECONDS = 180
/** 인증 성공 화면을 보이는 시간 */
export const VERIFIED_HOLD_MS = 2000
const CODE_LENGTH = 6

export interface PhoneVerifyProps {
  /** 인증번호 보내기 → 가린 번호 */
  readonly send: (phone: string) => Promise<string>
  /** 인증번호 확인 (틀리면 서버 문장으로 던진다). 성공 화면 뒤에 할 일을 돌려줄 수 있다 */
  readonly verify: (code: string) => Promise<(() => void | Promise<void>) | void>
  /** 첫 화면 왼쪽 위 ‹ (처음으로·로그아웃) */
  readonly back: { readonly label: string; readonly onPress: () => void }
  /** 확인 뒤 오래 걸리는 일 안내 (가입 만드는 중…) */
  readonly busyText?: string | null
}

const messageOf = (caught: unknown): string => (isApiError(caught) && !caught.network ? caught.message : APP_LOGIN_FAILED)
const clock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

type Step = 'phone' | 'code' | 'done'
/** 인증번호 칸 표시: 틀림(합친 빨간 칸 + 문장), 횟수 초과(합친 빨간 칸), 시간 지남(칸마다 옅은 빨강) */
type CodeMark = 'wrong' | 'locked' | 'expired' | null
type CodePopup = 'expired' | 'locked' | 'resend' | null
/** 부드럽게 (D-UX3-53 "애니메이션은 항상 부드럽게") */
const SOFT_MS = 220
const native = Platform.OS !== 'web'

export function PhoneVerify({ send, verify, back, busyText }: PhoneVerifyProps) {
  const [step, setStep] = useState<Step>('phone')
  const [goingBack, setGoingBack] = useState(false)
  const [digits, setDigits] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeMark, setCodeMark] = useState<CodeMark>(null)
  const [popup, setPopup] = useState<CodePopup>(null)
  const codeInput = useRef<TextInputInstance | null>(null)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState(0)
  const [sentAt, setSentAt] = useState(0)
  /** 잘못인 번호에서 [다음]을 누른 횟수 — 누를 때마다 다시 흔든다 */
  const [phoneAgain, setPhoneAgain] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const after = useRef<(() => void | Promise<void>) | null>(null)
  useWhiteTop()

  const go = (next: Step, backward = false) => {
    setGoingBack(backward)
    setStep(next)
  }

  const deliver = async (phone: string): Promise<boolean> => {
    setSending(true)
    try {
      await send(phone)
      setExpiresAt(Date.now() + CODE_TTL_SECONDS * 1000)
      setSentAt(Date.now())
      setNow(Date.now())
      setCode('')
      setCodeError(null)
      setCodeMark(null)
      return true
    } finally {
      setSending(false)
    }
  }

  const typePhone = (text: string) => {
    if (sending) return
    const next = text.replace(/\D/g, '').slice(0, 11)
    setDigits(next)
    setSendError(null)
  }

  // 11자리가 차도 저절로 넘어가지 않는다 — [다음]을 눌러야 보낸다 (D-UX3-50, 옛 D-UX3-49는 바로 보냈다)
  const phoneReady = digits.length === 11 && digits.startsWith('010')
  const nextFromPhone = () => {
    if (digits.length === 11 && !phoneReady) {
      setPhoneAgain((count) => count + 1)
      return
    }
    if (!phoneReady || sending) return
    void deliver(formatMobileInput(digits))
      .then(() => {
        setNote(null)
        go('code')
      })
      .catch((caught: unknown) => setSendError(messageOf(caught)))
  }

  // 맞는지는 서버가 판정한다 — 앱은 6자리가 찼는지만 본다
  const typeCode = (text: string) => {
    if (checking) return
    const next = text.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(next)
    setCodeError(null)
    setCodeMark(null)
    if (next.length !== CODE_LENGTH) return
    setChecking(true)
    setNote(null)
    verify(next)
      .then((then) => {
        after.current = typeof then === 'function' ? then : null
        go('done')
      })
      .catch((caught: unknown) => {
        const kind = isApiError(caught) ? caught.code : null
        if (kind === 'CODE_EXPIRED') {
          setCodeMark('expired')
          setPopup('expired')
        } else if (kind === 'CODE_LOCKED') {
          setCodeMark('locked')
          setPopup('locked')
        } else {
          setCodeMark('wrong')
          setCodeError(messageOf(caught))
        }
      })
      .finally(() => setChecking(false))
  }

  const resendLeft = Math.max(0, Math.ceil((sentAt + CODE_RESEND_WAIT_SECONDS * 1000 - now) / 1000))
  const resend = () => {
    if (sending || checking || resendLeft > 0) return
    setNote(null)
    deliver(formatMobileInput(digits))
      .then(() => setNote(CODE_RESENT))
      .catch((caught: unknown) => setNote(messageOf(caught)))
      .finally(() => setPopup(null))
  }

  // 남은 시간
  useEffect(() => {
    if (step !== 'code') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [step])

  // 성공 화면 2초 뒤 다음으로
  useEffect(() => {
    if (step !== 'done') return
    const timer = setTimeout(() => void after.current?.(), VERIFIED_HOLD_MS)
    return () => clearTimeout(timer)
  }, [step])

  // 010 검사는 11자리를 다 넣은 뒤에 (D-UX3-50 — 옛 D-UX3-49는 앞 세 자리에서 바로)
  const wrongStart = digits.length === 11 && !digits.startsWith('010')
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const timeOver = step === 'code' && expiresAt > 0 && left === 0

  // 3분이 지나면 팝업 (D-UX3-53, 토스 사진 1)
  useEffect(() => {
    if (!timeOver) return
    setCodeMark((mark) => (mark === 'locked' ? mark : 'expired'))
    setPopup((open) => open ?? 'expired')
  }, [timeOver])

  // 확인하는 동안·팝업이 떠 있는 동안 키보드를 숨기고, 틀리거나 팝업을 닫으면 다시 띄운다 (D-UX3-53)
  useEffect(() => {
    if (step !== 'code') return
    if (checking || popup !== null) codeInput.current?.blur()
    else codeInput.current?.focus()
  }, [step, checking, popup])

  const popupText =
    popup === 'expired'
      ? { message: CODE_TIME_OVER_TITLE, description: CODE_RESEND_ASK }
      : popup === 'locked'
        ? { message: CODE_LOCKED_TEXT, description: resendLeft > 0 ? codeResendIn(resendLeft) : null }
        : { message: CODE_NOT_COMING, description: resendLeft > 0 ? codeResendIn(resendLeft) : CODE_RESEND_ASK }

  return (
    <SlideSwitch id={step} back={goingBack} testID="phone-verify">
      {step === 'phone' ? (
        <Page
          onBack={back.onPress}
          backLabel={back.label}
          title={PHONE_ASK_TITLE}
          testID="phone-step"
          footer={<BigButton label={PHONE_NEXT} onPress={nextFromPhone} disabled={digits.length !== 11} busy={sending} testID="phone-next" />}
        >
          <View style={{ marginTop: PAGE.titleGap }}>
            <UnderlineField
              label={PHONE_FIELD}
              value={formatMobileInput(digits)}
              onChangeText={typePhone}
              error={wrongStart ? PHONE_RECHECK : sendError}
              again={phoneAgain}
              keyboardType="number-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoFocus
              maxLength={13}
              testID="phone-input"
            />
          </View>
        </Page>
      ) : step === 'code' ? (
        <Page
          onBack={() => {
            setDigits('')
            setCode('')
            setCodeError(null)
            go('phone', true)
          }}
          backLabel="번호 다시 넣기"
          title={CODE_ASK_TITLE}
          testID="code-step"
          footer={<NotComing hidden={checking} onPress={() => setPopup('resend')} />}
        >
          <View style={{ marginTop: SPACE.lg }}>
            <Txt step="body" color="textSub">{`${CODE_LEFT} ${clock(left)}`}</Txt>
          </View>
          <CodeBoxes value={code} error={codeError} mark={timeOver && codeMark === null ? 'expired' : codeMark} onChange={typeCode} inputRef={codeInput} />
          {checking ? (
            <View style={{ marginTop: SPACE.lg, flexDirection: 'row', justifyContent: 'center', gap: SPACE.sm, alignItems: 'center' }}>
              <ActivityIndicator />
              {busyText === undefined || busyText === null ? null : <Txt step="caption" color="textSub">{busyText}</Txt>}
            </View>
          ) : null}
          {note === null ? null : (
            <View style={{ marginTop: SPACE.md }} aria-live="polite">
              <Txt step="caption" color="textSub" center>
                {note}
              </Txt>
            </View>
          )}
          <PopupDialog
            visible={popup !== null}
            message={popupText.message}
            description={popupText.description}
            cancelLabel={POPUP_CLOSE}
            confirmLabel={CODE_RESEND_GO}
            confirmDisabled={resendLeft > 0}
            busy={sending}
            onCancel={() => setPopup(null)}
            onConfirm={resend}
          />
        </Page>
      ) : (
        <Verified />
      )}
    </SlideSwitch>
  )
}

/** 한 화면 틀: 왼쪽 위 ‹, 두 줄 제목, 내용, 아래 단추(키보드가 뜨면 키보드 바로 위 — 사이 12) */
function Page({ onBack, backLabel, title, children, footer, testID }: { readonly onBack: () => void; readonly backLabel: string; readonly title: string; readonly children: ReactNode; readonly footer?: ReactNode; readonly testID: string }) {
  const { p } = useKit()
  const bottom = useBottomInset()
  const keyboard = useKeyboardShown()
  // 이 틀은 상태 막대 아래(SafeAreaView 위 여백)에서 시작한다 — 키보드 피하기는 부모 기준 자리로 재므로 그만큼 더해야 단추가 키보드에 가리지 않는다
  const top = useTopInset()
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={top} style={{ flex: 1, backgroundColor: p.surface }} testID={testID}>
      <View style={{ paddingLeft: PAGE.backLeft }}>
        <BackButton label={backLabel} onPress={onBack} />
      </View>
      <View style={{ flex: 1, paddingHorizontal: PAGE.side, paddingTop: PAGE.titleTop }}>
        <Txt step="headline" weight="bold" role="heading" aria-level={1}>
          {title}
        </Txt>
        {children}
      </View>
      {footer === undefined || footer === null ? null : (
        <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: keyboard ? SPACE.md : Math.max(bottom, SPACE.md) + SPACE.xs }}>{footer}</View>
      )}
    </KeyboardAvoidingView>
  )
}

/** 키보드 위 밑줄 글자 단추 "문자가 안 오나요?" (토스와 같은 모양, D-UX3-53). 확인하는 동안은 부드럽게 숨긴다 */
function NotComing({ hidden, onPress }: { readonly hidden: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  const fade = useRef(new Animated.Value(hidden ? 0 : 1)).current
  useEffect(() => {
    Animated.timing(fade, { toValue: hidden ? 0 : 1, duration: SOFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start()
  }, [hidden, fade])
  return (
    <Animated.View style={{ opacity: fade, alignItems: 'center' }} pointerEvents={hidden ? 'none' : 'auto'} aria-hidden={hidden}>
      <Pressable role="button" aria-label={CODE_NOT_COMING} onPress={onPress} hitSlop={8} testID="code-not-coming" style={{ minHeight: 44, paddingHorizontal: SPACE.md, justifyContent: 'center' }}>
        {({ pressed }) => (
          <Text style={{ fontSize: TYPE.body, lineHeight: Math.round(TYPE.body * 1.4), color: p.primaryText, textDecorationLine: 'underline', opacity: pressed ? 0.5 : 1 }}>{CODE_NOT_COMING}</Text>
        )}
      </Pressable>
    </Animated.View>
  )
}

/** 0 → 1로 부드럽게 (보이는 동안 1, 사라질 때 0이 된 뒤에 내린다) */
function useSoftShow(on: boolean): { readonly mounted: boolean; readonly value: Animated.Value } {
  const value = useRef(new Animated.Value(on ? 1 : 0)).current
  const [mounted, setMounted] = useState(on)
  useEffect(() => {
    if (on) setMounted(true)
    const run = Animated.timing(value, { toValue: on ? 1 : 0, duration: SOFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: native })
    run.start(({ finished }) => {
      if (finished && !on) setMounted(false)
    })
    return () => run.stop()
  }, [on, value])
  return { mounted: on || mounted, value }
}

/** 칸에 들어온 숫자 — 살짝 아래에서 떠오르며 서서히 나타난다 (D-UX3-53 "딱딱하지 않게") */
function RisingDigit({ children, style }: { readonly children: string; readonly style: object }) {
  const rise = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: SOFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start()
  }, [rise])
  return (
    <Animated.Text
      allowFontScaling={false}
      style={[style, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }, { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }]}
    >
      {children}
    </Animated.Text>
  )
}

/**
 * 인증번호 6칸. 보이지 않는 입력 칸 하나를 칸들 위에 겹쳐 놓는다(누르면 키보드, 문자 자동 채우기).
 * 틀림·횟수 초과면 여섯 칸이 한 칸으로 부드럽게 합쳐 빨갛게(토스 사진 2), 시간 지남이면 칸마다 옅은 빨강(토스 사진 1).
 * 숫자 두께는 토스 사진을 재어 600 (D-UX3-53 — 옛 700).
 */
function CodeBoxes({ value, error, mark, onChange, inputRef }: { readonly value: string; readonly error: string | null; readonly mark: CodeMark; readonly onChange: (text: string) => void; readonly inputRef: RefObject<TextInputInstance | null> }) {
  const { p } = useKit()
  const [focused, setFocused] = useState(true)
  const merged = mark === 'wrong' || mark === 'locked'
  const together = useSoftShow(merged)
  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '')
  const digit = { fontSize: TYPE.headline + 8, fontWeight: WEIGHT.medium, color: p.text } as const
  const shake = useWrongShake(mark === 'wrong' ? error : mark === 'locked' ? CODE_LOCKED_TEXT : null)
  const cellBg = mark === 'expired' ? TONES.light.danger.bg : p.surfaceAlt
  return (
    <Animated.View style={{ marginTop: SPACE.xxxl, alignItems: 'center', transform: [{ translateX: shake }] }}>
      <View style={{ width: '100%', maxWidth: 360, height: 64 }}>
        <Animated.View style={{ flex: 1, flexDirection: 'row', gap: SPACE.sm, opacity: together.value.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          {cells.map((cell, index) => {
            const active = focused && !merged && index === Math.min(value.length, CODE_LENGTH - 1) && value.length < CODE_LENGTH
            return (
              <View key={index} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: cellBg }}>
                {cell !== '' ? <RisingDigit style={digit}>{cell}</RisingDigit> : active ? <Caret /> : null}
              </View>
            )
          })}
        </Animated.View>
        {together.mounted ? (
          <Animated.View
            testID={merged ? 'code-wrong' : undefined}
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: together.value, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: RADIUS.lg, borderCurve: 'continuous', borderWidth: 2, borderColor: p.dangerText, backgroundColor: TONES.light.danger.bg }}
          >
            {cells.map((cell, index) => (
              <Text key={index} allowFontScaling={false} style={digit}>
                {cell}
              </Text>
            ))}
          </Animated.View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          aria-label={CODE_FIELD}
          aria-invalid={mark !== null}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={CODE_LENGTH}
          autoFocus
          caretHidden
          contextMenuHidden
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID="code-input"
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: 'transparent', fontSize: 1 }}
        />
      </View>
      {mark === 'wrong' && error !== null ? (
        <View style={{ marginTop: SPACE.md, alignSelf: 'stretch', alignItems: 'center' }}>
          <ErrorLine>{error}</ErrorLine>
        </View>
      ) : null}
    </Animated.View>
  )
}

/** 깜빡이는 입력 자리 */
function Caret() {
  const { p } = useKit()
  const [on, setOn] = useState(true)
  useEffect(() => {
    const timer = setInterval(() => setOn((value) => !value), 530)
    return () => clearInterval(timer)
  }, [])
  return <View aria-hidden style={{ width: 2, height: 30, borderRadius: 1, borderCurve: 'continuous', backgroundColor: on ? p.primary : 'transparent' }} />
}

/** 인증 성공 (2초 보인 뒤 다음으로) */
function Verified() {
  const { p } = useKit()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xxl, backgroundColor: p.surface }} testID="phone-verified">
      <View aria-hidden style={{ width: 76, height: 76, borderRadius: 38, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: p.primary }}>
        <Icon name="check" size={40} color={p.onPrimary} />
      </View>
      <Txt step="headline" weight="bold" role="heading" aria-level={1}>
        {PHONE_VERIFIED}
      </Txt>
    </View>
  )
}
