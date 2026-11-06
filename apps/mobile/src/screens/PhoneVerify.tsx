// 휴대폰 번호 확인 (D-UX3-30 → 모양·흐름은 D-UX3-49, 사용자 지시 2026-11-07 사진대로):
// ① "본인 확인을 위해 휴대폰 번호를 입력해 주세요" — 밑줄 칸 하나. 11자리가 차면 아래 [다음]이 켜지고, 눌러야 인증번호를 보내고 다음 화면으로 (D-UX3-50).
//    11자리를 다 넣었는데 010으로 시작하지 않으면 빨간 밑줄·라벨과 "휴대폰 번호를 다시 확인해 주세요." ([다음]·[지우기]·키보드는 그대로)
// ② "문자로 받은 인증번호 6자리를 입력해 주세요" — 남은 시간, 6칸. 6자리가 차면 키보드와 아래 글자 단추를 숨기고 서버에 확인한다.
//    틀리면 한 칸으로 부드럽게 합쳐 빨갛게 + "인증번호가 맞지 않아요."(남은 횟수는 알리지 않는다), 키보드·단추가 다시 나온다 (D-UX3-53).
//    3분이 지나면 "입력할 수 있는 시간이 지났어요" 팝업, 5번 틀리면 "입력 횟수를 초과했어요" 팝업 — 둘 다 [닫기]·[다시 받기] (D-UX3-53, 토스 사진 1·2).
//    키보드 위 밑줄 글자 [문자가 안 오나요?]를 누르면 팝업 "인증 문자를 다시 받을까요?" — 보낸 지 30초 전이면 "N초 뒤에 받을 수 있어요"와 꺼진 [다시 받기],
//    30초가 되면 "지금 바로 다시 받을 수 있어요"와 켜진 [다시 받기] (D-UX3-54). 가입 표(30분)가 없어졌으면 시간 지남이 아니라 [처음으로] 팝업 (D-UX3-54).
//    칸 움직임은 토스 사진 13~20 순서대로 (D-UX3-54): 빈 칸 회색 → 숫자가 들어오면 흰 칸·가운데서 커지는 초록 숫자 → 6자리면 키보드·글자 단추가 서서히 사라지고
//    여섯 칸이 한 칸(흰 바탕·연한 초록 테)으로 합쳐 살짝 줄어든 채 확인 → 틀리면 빨개지며 다시 커지고 흔들기·진동 → 키보드가 다시 올라오고 → 여섯 칸(옅은 빨강)으로 나뉜다.
//    칸은 문자 자동 채우기(아이폰 oneTimeCode·안드로이드 sms-otp)를 켠다.
// 아래 단추는 키보드가 뜨면 키보드 바로 위로 올라온다. 이 화면이 떠 있는 동안 맨 위 상태 막대 자리도 흰색이다(D-UX3-50).
// D-UX3-51: 잘못이어도 [다음]은 그대로 — 누르면 칸이 다시 흔들리고 진동한다. 뒤로·제목 자리와 잘못 모양은 공통 부품(PAGE·ErrorLine·useWrongShake).
// ③ "인증 성공" 2초 뒤 다음(홈·있는 계정 안내)으로. 화면 사이는 밀어 넘긴다(SlideSwitch).
// 가입 중(가입 표)과 로그인한 계정(번호 등록)이 같이 쓴다. 왼쪽 위 ‹는 ①에서 처음으로·로그아웃, ②에서 번호 다시 넣기.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, type TextInputInstance } from 'react-native'
import {
  CODE_ASK_TITLE,
  CODE_FIELD,
  CODE_LEFT,
  CODE_LOCKED_TEXT,
  CODE_NOT_COMING,
  CODE_RESEND_ASK,
  CODE_RESEND_GO,
  CODE_RESEND_NOW,
  CODE_RESEND_TITLE,
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
  START_OVER,
  VERIFY_LEAVE_GO,
  VERIFY_LEAVE_TEXT,
  VERIFY_LEAVE_TITLE,
} from '@livejjim/web/src/lib/social-login.ts'
import { isApiError } from '../api/client.ts'
import { APP_LOGIN_FAILED } from '../lib/social-auth.ts'
import { BackButton, BigButton, ErrorLine, Icon, PopupDialog, TONES, Txt, UnderlineField, useBottomInset, useKeyboardShown, useKit, useTopInset, useWhiteTop, useWrongShake } from '../ui/kit/index.ts'
import { SHEET_OUT_MS } from '../ui/kit/sheets.tsx'
import { EdgeSwipeBack, SlideSwitch } from '../ui/kit/slide.tsx'
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
/** gone: 가입 표가 없어져 처음부터 (D-UX3-54). leave: 뒤로·밀어서 뒤로 할 때 "다음에 할까요?" (D-UX3-55) */
type CodePopup = 'expired' | 'locked' | 'resend' | 'gone' | 'leave' | null
/** 부드럽게 (D-UX3-53 "애니메이션은 항상 부드럽게") */
const SOFT_MS = 220
/** 숫자 한 칸이 채워지는 시간 */
const CELL_MS = 300
/** 여섯 칸이 합쳐지고·빨개지는 시간 (D-UX3-55 — 옛 0.22초는 끊겨 보였다) */
const MERGE_MS = 320
/**
 * 시간 (D-UX3-55, 사용자 지시 2026-11-07 "아무리 빨라도 0.5초 동안 인증결과를 기다리다가, 틀리면 0.4초 뒤에 키보드 다시 올리고, 1초뒤에 버튼 다시 쪼개기 및 문자가 안 오나요 버튼 다시 페이드인"
 * — 옛 D-UX3-54 기다림 없음·0.65초·1.3초)
 */
export const MIN_CHECK_MS = 500
const WRONG_KEYBOARD_MS = 400
export const WRONG_HOLD_MS = 1000
/** 팝업이 흐려져 사라진 뒤에 이전 화면으로 넘긴다 */
const AFTER_POPUP_MS = SHEET_OUT_MS + 40
/** 확인하는 동안 합친 칸 크기 (토스 사진 16 — 살짝 줄어든다) */
const CHECKING_SCALE = 0.96
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
  // 닫히며 흐려지는 동안에도 같은 글을 보인다 — 옛: 닫는 순간 [문자가 안 오나요?] 글로 바뀌어 겹쳐 보였다 (D-UX3-54)
  const [shownPopup, setShownPopup] = useState<Exclude<CodePopup, null>>('resend')
  if (popup !== null && popup !== shownPopup) setShownPopup(popup)
  const [goneText, setGoneText] = useState<string | null>(null)
  /** 틀린 뒤 합친 빨간 칸을 보이는 동안 */
  const [held, setHeld] = useState(false)
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
      setHeld(false)
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
    setHeld(false)
    if (next.length !== CODE_LENGTH) return
    setChecking(true)
    setNote(null)
    // 서버가 빨리 답해도 0.5초는 합친 칸으로 기다린다 (D-UX3-55)
    const started = Date.now()
    const settle = (run: () => void) => setTimeout(run, Math.max(0, MIN_CHECK_MS - (Date.now() - started)))
    verify(next).then(
      (then) =>
        settle(() => {
          after.current = typeof then === 'function' ? then : null
          setChecking(false)
          go('done')
        }),
      (caught: unknown) =>
        settle(() => {
          setChecking(false)
          const kind = isApiError(caught) ? caught.code : null
          if (kind === 'CODE_EXPIRED') {
            setCodeMark('expired')
            setPopup('expired')
          } else if (kind === 'CODE_LOCKED') {
            setCodeMark('locked')
            setPopup('locked')
          } else if (kind === 'LOGIN_EXPIRED') {
            setGoneText(messageOf(caught))
            setPopup('gone')
          } else {
            setCodeMark('wrong')
            setCodeError(messageOf(caught))
            setHeld(true)
          }
        }),
    )
  }

  /** 팝업을 흐려 닫은 뒤 이전 화면(번호 넣기)으로 밀어 넘긴다 — 넣었던 번호는 남긴다 (D-UX3-55) */
  const backToPhone = (keepNumber: boolean) => {
    setPopup(null)
    setTimeout(() => {
      if (!keepNumber) setDigits('')
      setCode('')
      setCodeError(null)
      setCodeMark(null)
      setHeld(false)
      setExpiresAt(0)
      setNote(null)
      go('phone', true)
    }, AFTER_POPUP_MS)
  }
  /** "다음에 할까요?"에서 [나가기] */
  const leave = () => {
    if (step === 'code') {
      backToPhone(false)
      return
    }
    setPopup(null)
    setTimeout(back.onPress, AFTER_POPUP_MS)
  }
  const closePopup = () => {
    // 시간 지남·횟수 초과 팝업은 닫으면 이전 화면으로 (D-UX3-55, 사용자 지시 "그 화면에 남는게 아니라 이전 화면으로")
    if (popup === 'expired' || popup === 'locked') backToPhone(true)
    else setPopup(null)
  }

  const resendLeft = Math.max(0, Math.ceil((sentAt + CODE_RESEND_WAIT_SECONDS * 1000 - now) / 1000))
  const resend = () => {
    if (sending || checking || resendLeft > 0) return
    setNote(null)
    deliver(formatMobileInput(digits))
      .then(() => {
        setNote(CODE_RESENT)
        setPopup(null)
      })
      .catch((caught: unknown) => {
        if (isApiError(caught) && caught.code === 'LOGIN_EXPIRED') {
          setGoneText(messageOf(caught))
          setPopup('gone')
          return
        }
        setNote(messageOf(caught))
        setPopup(null)
      })
  }

  // 틀린 뒤 합친 빨간 칸은 잠깐만 — 그 뒤 여섯 칸으로 나눈다 (D-UX3-54)
  useEffect(() => {
    if (!held) return
    const timer = setTimeout(() => setHeld(false), WRONG_HOLD_MS)
    return () => clearTimeout(timer)
  }, [held])

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

  // 3분이 지나면 팝업 (D-UX3-53, 토스 사진 1). 다시 보내는 중에는 띄우지 않는다
  useEffect(() => {
    if (!timeOver || sending) return
    setCodeMark((mark) => (mark === 'locked' ? mark : 'expired'))
    setPopup((open) => open ?? 'expired')
  }, [timeOver, sending])

  // 확인하는 동안·팝업이 떠 있는 동안 키보드를 숨기고, 팝업을 닫으면 다시 띄운다 (D-UX3-53). 틀리면 빨간 칸이 흔들린 뒤에 올린다 (D-UX3-54)
  useEffect(() => {
    if (step !== 'code') return
    if (checking || popup !== null) {
      codeInput.current?.blur()
      return
    }
    if (!held) {
      codeInput.current?.focus()
      return
    }
    const timer = setTimeout(() => codeInput.current?.focus(), WRONG_KEYBOARD_MS)
    return () => clearTimeout(timer)
  }, [step, checking, popup, held])

  const popupText =
    shownPopup === 'expired'
      ? { message: CODE_TIME_OVER_TITLE, description: CODE_RESEND_ASK }
      : shownPopup === 'locked'
        ? { message: CODE_LOCKED_TEXT, description: resendLeft > 0 ? codeResendIn(resendLeft) : null }
        : shownPopup === 'gone'
          ? { message: goneText ?? APP_LOGIN_FAILED, description: null }
          : shownPopup === 'leave'
            ? { message: VERIFY_LEAVE_TITLE, description: VERIFY_LEAVE_TEXT }
            : { message: CODE_RESEND_TITLE, description: resendLeft > 0 ? codeResendIn(resendLeft) : CODE_RESEND_NOW }
  const confirmLabel = shownPopup === 'gone' ? START_OVER : shownPopup === 'leave' ? VERIFY_LEAVE_GO : CODE_RESEND_GO
  const onConfirm = shownPopup === 'gone' ? back.onPress : shownPopup === 'leave' ? leave : resend
  // 뒤로·밀어서 뒤로: 나가면 처음부터 다시라 먼저 묻는다 (D-UX3-55, 사용자 지시 "뒤로가기 시 \"다음에 할까요?\"")
  const askLeave = () => {
    if (checking || popup !== null) return
    Keyboard.dismiss()
    setPopup('leave')
  }

  return (
    <>
      <SlideSwitch id={step} back={goingBack} testID="phone-verify">
        {step === 'phone' ? (
          <Page
            onBack={askLeave}
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
            onBack={askLeave}
            backLabel="번호 다시 넣기"
            title={CODE_ASK_TITLE}
            testID="code-step"
            footer={<NotComing hidden={checking || held} onPress={() => setPopup('resend')} />}
          >
            <View style={{ marginTop: SPACE.lg }}>
              <Txt step="body" color="textSub">{`${CODE_LEFT} ${clock(left)}`}</Txt>
            </View>
            <CodeBoxes value={code} error={codeError} mark={timeOver && codeMark === null ? 'expired' : codeMark} checking={checking} held={held} onChange={typeCode} inputRef={codeInput} />
            {/* 확인 중 표시는 합친 칸이 살짝 줄어드는 것 (토스 사진 16) — 돌림표는 없다. 오래 걸리는 일 안내만 글로 */}
            {checking && busyText !== undefined && busyText !== null ? (
              <View style={{ marginTop: SPACE.lg }} aria-live="polite">
                <Txt step="caption" color="textSub" center>
                  {busyText}
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
      <PopupDialog
        visible={popup !== null}
        message={popupText.message}
        description={popupText.description}
        cancelLabel={POPUP_CLOSE}
        confirmLabel={confirmLabel}
        confirmDisabled={(shownPopup === 'resend' || shownPopup === 'expired' || shownPopup === 'locked') && resendLeft > 0}
        busy={sending}
        onCancel={closePopup}
        onConfirm={onConfirm}
      />
    </>
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
    <EdgeSwipeBack onBack={onBack}>
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
    </EdgeSwipeBack>
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

/** 값이 바뀌면 그 값으로 부드럽게 옮겨 간다 */
function useEased(target: number, ms: number): Animated.Value {
  const value = useRef(new Animated.Value(target)).current
  useEffect(() => {
    const run = Animated.timing(value, { toValue: target, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: native })
    run.start()
    return () => run.stop()
  }, [target, ms, value])
  return value
}

/** 칸 사이·칸 높이·여섯 칸 폭 (D-UX3-55, 사용자 지시 "숫자 크기, 각 칸 가로 세로 너비 다시 맞출 것" — 토스 사진을 재어 칸 44×54·사이 7·줄 301, 숫자 30. 옛 칸 51×64·사이 8) */
const CELL_GAP = 7
const CELL_HEIGHT = 54
const ROW_WIDTH = 301
/** 합칠 때 칸들이 가운데로 모이는 거리의 바깥 끝 (칸 사이를 다 메운다) */
const GATHER = ((CODE_LENGTH - 1) / 2) * CELL_GAP
const COVER = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const

/**
 * 인증번호 한 칸 (D-UX3-54, 토스 사진 13·14): 비면 회색. 숫자가 들어오면 칸이 살짝 줄었다 돌아오며 흰 바탕(얇은 회색 테)이 되고,
 * 숫자(초록)는 가운데서부터 서서히 커지며 나타난다. pink면 옅은 빨강 바탕·진한 숫자(틀린 뒤·시간 지남).
 */
function CodeCell({ char, active, pink, index, together }: { readonly char: string; readonly active: boolean; readonly pink: boolean; readonly index: number; readonly together: Animated.Value }) {
  const { p } = useKit()
  const filled = char !== ''
  const fill = useEased(filled ? 1 : 0, CELL_MS)
  const pinkness = useEased(pink ? 1 : 0, SOFT_MS)
  const pop = useRef(new Animated.Value(filled ? 1 : 0)).current
  const last = useRef(char)
  useEffect(() => {
    if (last.current === char) return
    last.current = char
    pop.setValue(0)
    if (char === '') return
    const run = Animated.timing(pop, { toValue: 1, duration: CELL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: native })
    run.start()
    return () => run.stop()
  }, [char, pop])
  const shape = { ...COVER, borderRadius: RADIUS.md, borderCurve: 'continuous' } as const
  return (
    <Animated.View
      style={{
        flex: 1,
        transform: [
          // 합칠 때 가운데로 모인다 (사이가 메워지며 한 칸이 된다)
          { translateX: together.interpolate({ inputRange: [0, 1], outputRange: [0, ((CODE_LENGTH - 1) / 2 - index) * CELL_GAP] }) },
          { scale: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [1, 0.88, 1] }) },
        ],
      }}
    >
      <View style={[shape, { backgroundColor: p.surfaceAlt }]} />
      <Animated.View style={[shape, { backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, opacity: fill }]} />
      <Animated.View style={[shape, { backgroundColor: TONES.light.danger.bg, opacity: pinkness }]} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {filled ? (
          <Animated.Text
            allowFontScaling={false}
            style={{
              ...DIGIT,
              color: pink ? p.text : p.primaryText,
              opacity: pop.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
              transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
            }}
          >
            {char}
          </Animated.Text>
        ) : active ? (
          <Caret />
        ) : null}
      </View>
    </Animated.View>
  )
}

/** 숫자 (토스 사진을 재어 두께 600, D-UX3-53) */
const DIGIT = { fontSize: TYPE.headline + 8, fontWeight: WEIGHT.medium } as const

/** 합친 한 칸 안 숫자 — 모인 칸들의 숫자 자리와 같다 */
function MergedDigits({ cells, color }: { readonly cells: readonly string[]; readonly color: string }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: GATHER }}>
      {cells.map((cell, index) => (
        <View key={index} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text allowFontScaling={false} style={{ ...DIGIT, color }}>
            {cell}
          </Text>
        </View>
      ))}
    </View>
  )
}

/**
 * 인증번호 6칸 (D-UX3-54, 토스 사진 13~20 순서대로). 보이지 않는 입력 칸 하나를 칸들 위에 겹쳐 놓는다(누르면 키보드, 문자 자동 채우기).
 * 확인 중: 여섯 칸이 가운데로 모이며 한 칸(흰 바탕·연한 초록 테·초록 숫자)이 되어 살짝 줄어든다.
 * 틀림(held 동안)·횟수 초과: 합친 칸이 빨개지며(빨간 테·옅은 빨강 바탕·진한 숫자) 다시 커지고 흔들기·진동, 아래 "! 인증번호가 맞지 않아요."
 * 틀림(held 뒤): 여섯 칸(옅은 빨강·진한 숫자)으로 나뉘고 문장은 사라진다. 고쳐 넣으면 보통 칸으로. 시간 지남: 칸마다 옅은 빨강.
 */
function CodeBoxes({
  value,
  error,
  mark,
  checking,
  held,
  onChange,
  inputRef,
}: {
  readonly value: string
  readonly error: string | null
  readonly mark: CodeMark
  readonly checking: boolean
  readonly held: boolean
  readonly onChange: (text: string) => void
  readonly inputRef: RefObject<TextInputInstance | null>
}) {
  const { p } = useKit()
  const [focused, setFocused] = useState(true)
  const red = mark === 'locked' || (mark === 'wrong' && held)
  const merged = checking || red
  const pink = !merged && (mark === 'expired' || mark === 'wrong')
  const together = useEased(merged ? 1 : 0, MERGE_MS)
  const redness = useEased(red ? 1 : 0, MERGE_MS)
  const size = useEased(checking ? CHECKING_SCALE : 1, MERGE_MS)
  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '')
  const shake = useWrongShake(mark === 'wrong' ? error : mark === 'locked' ? CODE_LOCKED_TEXT : null)
  const wrongLine = useSoftShow(mark === 'wrong' && held && error !== null)
  const shape = { ...COVER, borderRadius: RADIUS.lg, borderCurve: 'continuous', borderWidth: 2 } as const
  return (
    <Animated.View style={{ marginTop: SPACE.xxxl, alignItems: 'center', transform: [{ translateX: shake }] }}>
      <View style={{ width: '100%', maxWidth: ROW_WIDTH, height: CELL_HEIGHT }}>
        <Animated.View style={{ flex: 1, flexDirection: 'row', gap: CELL_GAP, opacity: together.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          {cells.map((cell, index) => (
            <CodeCell key={index} index={index} char={cell} pink={pink} together={together} active={focused && !merged && value.length < CODE_LENGTH && index === value.length} />
          ))}
        </Animated.View>
        <Animated.View aria-hidden pointerEvents="none" testID={red ? 'code-wrong' : checking ? 'code-checking' : undefined} style={{ ...COVER, opacity: together, transform: [{ scale: size }] }}>
          <View style={[shape, { backgroundColor: p.surface, borderColor: `${p.primary}99` }]}>
            <MergedDigits cells={cells} color={p.primaryText} />
          </View>
          <Animated.View style={[shape, { backgroundColor: TONES.light.danger.bg, borderColor: p.dangerText, opacity: redness }]}>
            <MergedDigits cells={cells} color={p.text} />
          </Animated.View>
        </Animated.View>
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
          style={{ ...COVER, opacity: 0.02, color: 'transparent', fontSize: 1 }}
        />
      </View>
      {wrongLine.mounted && error !== null ? (
        <Animated.View style={{ marginTop: SPACE.md, alignSelf: 'stretch', alignItems: 'center', opacity: wrongLine.value }}>
          <ErrorLine large>{error}</ErrorLine>
        </Animated.View>
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
