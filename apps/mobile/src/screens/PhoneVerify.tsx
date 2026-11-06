// 휴대폰 번호 확인 (D-UX3-30 → 모양·흐름은 D-UX3-49, 사용자 지시 2026-11-07 사진대로):
// ① "본인 확인을 위해 휴대폰 번호를 입력해 주세요" — 밑줄 칸 하나. 11자리가 차면 아래 [다음]이 켜지고, 눌러야 인증번호를 보내고 다음 화면으로 (D-UX3-50).
//    11자리를 다 넣었는데 010으로 시작하지 않으면 빨간 밑줄·라벨과 "휴대폰 번호를 다시 확인해 주세요." ([다음]·[지우기]·키보드는 그대로)
// ② "문자로 받은 인증번호 6자리를 입력해 주세요" — 남은 시간, 6칸. 6자리가 차면 바로 확인. 틀리면 한 칸으로 합쳐 빨갛게 + 서버 문장.
//    아래 [다시 문자 받을게요]는 보낸 지 30초가 지나야 켜진다(D-UX3-50). 칸은 문자 자동 채우기(아이폰 oneTimeCode·안드로이드 sms-otp)를 켠다.
// 아래 단추는 키보드가 뜨면 키보드 바로 위로 올라온다. 이 화면이 떠 있는 동안 맨 위 상태 막대 자리도 흰색이다(D-UX3-50).
// D-UX3-51: 잘못이어도 [다음]은 그대로 — 누르면 칸이 다시 흔들리고 진동한다. 뒤로·제목 자리와 잘못 모양은 공통 부품(PAGE·ErrorLine·useWrongShake).
// ③ "인증 성공" 2초 뒤 다음(홈·있는 계정 안내)으로. 화면 사이는 밀어 넘긴다(SlideSwitch).
// 가입 중(가입 표)과 로그인한 계정(번호 등록)이 같이 쓴다. 왼쪽 위 ‹는 ①에서 처음으로·로그아웃, ②에서 번호 다시 넣기.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native'
import {
  CODE_ASK_TITLE,
  CODE_FIELD,
  CODE_LEFT,
  CODE_NOT_COMING,
  CODE_RESEND_WAIT_SECONDS,
  CODE_RESENT,
  CODE_TIME_OVER,
  codeResendIn,
  formatMobileInput,
  PHONE_ASK_TITLE,
  PHONE_FIELD,
  PHONE_NEXT,
  PHONE_RECHECK,
  PHONE_VERIFIED,
} from '@livejjim/web/src/lib/social-login.ts'
import { isApiError } from '../api/client.ts'
import { APP_LOGIN_FAILED } from '../lib/social-auth.ts'
import { BackButton, BigButton, ErrorLine, Icon, TONES, Txt, UnderlineField, useBottomInset, useKeyboardShown, useKit, useTopInset, useWhiteTop, useWrongShake } from '../ui/kit/index.ts'
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

export function PhoneVerify({ send, verify, back, busyText }: PhoneVerifyProps) {
  const [step, setStep] = useState<Step>('phone')
  const [goingBack, setGoingBack] = useState(false)
  const [digits, setDigits] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
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

  const typeCode = (text: string) => {
    if (checking) return
    const next = text.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(next)
    setCodeError(null)
    if (next.length !== CODE_LENGTH) return
    setChecking(true)
    setNote(null)
    verify(next)
      .then((then) => {
        after.current = typeof then === 'function' ? then : null
        go('done')
      })
      .catch((caught: unknown) => setCodeError(messageOf(caught)))
      .finally(() => setChecking(false))
  }

  const resendLeft = Math.max(0, Math.ceil((sentAt + CODE_RESEND_WAIT_SECONDS * 1000 - now) / 1000))
  const resend = () => {
    if (sending || checking || resendLeft > 0) return
    setNote(null)
    deliver(formatMobileInput(digits))
      .then(() => setNote(CODE_RESENT))
      .catch((caught: unknown) => setNote(messageOf(caught)))
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
          footer={
            <View style={{ gap: SPACE.sm }}>
              {resendLeft > 0 ? (
                <Txt step="caption" color="textSub" center>
                  {codeResendIn(resendLeft)}
                </Txt>
              ) : null}
              <BigButton label={CODE_NOT_COMING} kind="secondary" onPress={resend} disabled={resendLeft > 0} busy={sending} testID="code-resend" />
            </View>
          }
        >
          <View style={{ marginTop: SPACE.lg }}>
            <Txt step="body" color="textSub">{`${CODE_LEFT} ${clock(left)}`}</Txt>
          </View>
          <CodeBoxes value={code} error={codeError} onChange={typeCode} />
          {checking ? (
            <View style={{ marginTop: SPACE.lg, flexDirection: 'row', justifyContent: 'center', gap: SPACE.sm, alignItems: 'center' }}>
              <ActivityIndicator />
              {busyText === undefined || busyText === null ? null : <Txt step="caption" color="textSub">{busyText}</Txt>}
            </View>
          ) : null}
          {codeError === null && left === 0 && expiresAt > 0 ? (
            <View style={{ marginTop: SPACE.lg }}>
              <Txt step="caption" color="dangerText" center>
                {CODE_TIME_OVER}
              </Txt>
            </View>
          ) : null}
          {note === null ? null : (
            <View style={{ marginTop: SPACE.md }} aria-live="polite">
              <Txt step="caption" color="textSub" center>
                {note}
              </Txt>
            </View>
          )}
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

/** 인증번호 6칸. 보이지 않는 입력 칸 하나를 칸들 위에 겹쳐 놓는다(누르면 키보드, 문자 자동 채우기) */
function CodeBoxes({ value, error, onChange }: { readonly value: string; readonly error: string | null; readonly onChange: (text: string) => void }) {
  const { p } = useKit()
  const [focused, setFocused] = useState(true)
  const bad = error !== null
  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '')
  const digit = { fontSize: TYPE.headline + 8, fontWeight: WEIGHT.bold, color: p.text } as const
  const shake = useWrongShake(error)
  return (
    <Animated.View style={{ marginTop: SPACE.xxxl, alignItems: 'center', transform: [{ translateX: shake }] }}>
      <View style={{ width: '100%', maxWidth: 360, height: 64 }}>
        {bad ? (
          <View testID="code-wrong" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: RADIUS.lg, borderCurve: 'continuous', borderWidth: 2, borderColor: p.dangerText, backgroundColor: TONES.light.danger.bg }}>
            {cells.map((cell, index) => (
              <Text key={index} allowFontScaling={false} style={digit}>
                {cell}
              </Text>
            ))}
          </View>
        ) : (
          <View style={{ flex: 1, flexDirection: 'row', gap: SPACE.sm }}>
            {cells.map((cell, index) => {
              const active = focused && index === Math.min(value.length, CODE_LENGTH - 1) && value.length < CODE_LENGTH
              return (
                <View key={index} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
                  {cell !== '' ? (
                    <Text allowFontScaling={false} style={digit}>
                      {cell}
                    </Text>
                  ) : active ? (
                    <Caret />
                  ) : null}
                </View>
              )
            })}
          </View>
        )}
        <TextInput
          value={value}
          onChangeText={onChange}
          aria-label={CODE_FIELD}
          aria-invalid={bad}
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
      {bad ? (
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
