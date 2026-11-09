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
// ③ 맞으면 화면을 넘기지 않고 그 자리에서 (D-UX3-60, 사용자 지시 2026-11-07 토스 사진 27~34): 합친 칸이 초록으로 차며 숫자가 흐려지고, 알약을 거쳐 작은 원이 되는 동안
//    제목·남은 시간·뒤로가 흐려진다. 원이 다시 커지며(살짝 넘쳤다 제 크기) 안에 체크가 그려지고 아래 "인증 성공"이 나타난다. 다 그려진 뒤 2초 보이고 다음(홈·있는 계정 안내)으로.
//    (옛 D-UX3-49: 다음 화면 "인증 성공"으로 밀어 넘겼다.) ①·② 사이는 밀어 넘긴다(SlideSwitch).
// 가입 중(가입 표)과 로그인한 계정(번호 등록)이 같이 쓴다. 왼쪽 위 ‹는 ①에서 처음으로·로그아웃, ②에서 번호 다시 넣기.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import Svg, { Path } from 'react-native-svg'
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, Text, TextInput, View, type TextInputInstance } from 'react-native'
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
import { BigButton, NAV, NavBar, ErrorLine, KEYBOARD_AVOID, PopupDialog, TONES, Txt, UnderlineField, useBottomInset, useKeyboardShown, useKit, useTopInset, useWhiteTop, useWrongShake, Tap } from '../ui/kit/index.ts'
import { SHEET_OUT_MS } from '../ui/kit/sheets.tsx'
import { EdgeSwipeBack, SlideSwitch } from '../ui/kit/slide.tsx'
import { PAGE, RADIUS, SPACE, TYPE, WEIGHT } from '../ui/kit/tokens.ts'
import { font } from '../ui/kit/font.ts'

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

/**
 * 인증번호 칸에 새로 들어온 글로 다음 값을 정한다 (D-UX3-60, 사용자 지시 2026-11-07 "인증번호 키보드에 자동으로 뜨는거 눌렀을 때 자동으로 안 들어가는 경우가 있어").
 * 옛: 입력 칸에 6자리 제한(maxLength)을 걸어, 아이폰이 문자 속 번호를 넣을 때 칸에 숫자가 이미 있으면 넘치는 글을 통째로 거절하거나(틀린 6자리가 남아 있을 때)
 * 앞쪽만 잘라 넣어 틀린 번호가 됐다. 이제 제한 없이 받고 여기서 고른다.
 * - 새로 붙은 숫자가 6자리 이상이면(자동 채우기·붙여 넣기, 두 번 들어온 경우 포함) 그 마지막 6자리
 * - 이미 6자리(틀린 번호)가 있는데 더 치면 새로 친 숫자부터 다시
 * - 그 밖에는 숫자만 앞 6자리
 */
export function nextCode(prev: string, text: string): string {
  const digits = text.replace(/\D/g, '')
  // 새로 들어온 토막: 옛 값과 앞·뒤가 같은 부분을 뺀 가운데 (입력 자리가 끝이 아니어도 — D-UX3-61)
  let head = 0
  while (head < prev.length && head < digits.length && prev[head] === digits[head]) head += 1
  let tail = 0
  while (tail < prev.length - head && tail < digits.length - head && prev[prev.length - 1 - tail] === digits[digits.length - 1 - tail]) tail += 1
  const added = digits.length > prev.length ? digits.slice(head, digits.length - tail) : ''
  if (added.length >= CODE_LENGTH) return added.slice(-CODE_LENGTH)
  if (added.length > 0 && prev.length === CODE_LENGTH) return added
  return digits.slice(0, CODE_LENGTH)
}

const messageOf = (caught: unknown): string => (isApiError(caught) && !caught.network ? caught.message : APP_LOGIN_FAILED)
const clock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

type Step = 'phone' | 'code'
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
/** 제목과 "남은 시간" 사이·"남은 시간"과 칸 사이 (D-UX3-56, 폭 430 휴대폰 토스 사진을 재어 — 옛 16·32) */
const CODE_LEFT_TOP = 25
const CODE_BOXES_TOP = 40
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
  /** 맞았다 — 그 자리에서 원·체크로 바뀌는 중 (D-UX3-60) */
  const [passed, setPassed] = useState(false)
  const away = useEased(passed ? 0 : 1, WIN_AWAY_MS)
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
    if (checking || passed) return
    const next = nextCode(code, text)
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
          setPassed(true)
          setChecking(false)
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

  // 인증 성공이 다 그려지고 2초 뒤 다음으로 (D-UX3-60 — 옛 D-UX3-49는 성공 화면이 뜨고 2초)
  useEffect(() => {
    if (!passed) return
    const timer = setTimeout(() => void after.current?.(), WIN_MS + VERIFIED_HOLD_MS)
    return () => clearTimeout(timer)
  }, [passed])

  // 010 검사는 11자리를 다 넣은 뒤에 (D-UX3-50 — 옛 D-UX3-49는 앞 세 자리에서 바로)
  const wrongStart = digits.length === 11 && !digits.startsWith('010')
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const timeOver = step === 'code' && expiresAt > 0 && left === 0

  // 3분이 지나면 팝업 (D-UX3-53, 토스 사진 1). 다시 보내는 중에는 띄우지 않는다
  useEffect(() => {
    if (!timeOver || sending || passed) return
    setCodeMark((mark) => (mark === 'locked' ? mark : 'expired'))
    setPopup((open) => open ?? 'expired')
  }, [timeOver, sending])

  // 확인하는 동안·팝업이 떠 있는 동안 키보드를 숨기고, 팝업을 닫으면 다시 띄운다 (D-UX3-53). 틀리면 빨간 칸이 흔들린 뒤에 올린다 (D-UX3-54)
  useEffect(() => {
    if (step !== 'code') return
    if (checking || passed || popup !== null) {
      codeInput.current?.blur()
      return
    }
    if (!held) {
      codeInput.current?.focus()
      return
    }
    const timer = setTimeout(() => codeInput.current?.focus(), WRONG_KEYBOARD_MS)
    return () => clearTimeout(timer)
  }, [step, checking, passed, popup, held])

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
    if (checking || passed || popup !== null) return
    Keyboard.dismiss()
    setPopup('leave')
  }

  return (
    <>
      <SlideSwitch id={step} back={goingBack} testID="phone-verify">
        {step === 'phone' ? (
          <QuestionPage
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
          </QuestionPage>
        ) : (
          <QuestionPage
            onBack={askLeave}
            backLabel="번호 다시 넣기"
            title={CODE_ASK_TITLE}
            testID="code-step"
            away={away}
            footer={<NotComing hidden={checking || held || passed} onPress={() => setPopup('resend')} />}
          >
            <Animated.View style={{ marginTop: CODE_LEFT_TOP, opacity: away }}>
              <Txt step="meta" color="textSub">{`${CODE_LEFT} ${clock(left)}`}</Txt>
            </Animated.View>
            <CodeBoxes value={code} error={codeError} mark={timeOver && codeMark === null ? 'expired' : codeMark} checking={checking} passed={passed} held={held} onChange={typeCode} inputRef={codeInput} />
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
          </QuestionPage>
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
/** 질문 화면 틀 (‹·제목·내용·아래 단추, 왼쪽 끝 밀기로 뒤로) — 번호 확인과 "이미 가입한 적이 있어요"가 같이 쓴다 (D-UX3-59) */
export function QuestionPage({
  onBack,
  backLabel,
  title,
  children,
  footer,
  away,
  testID,
}: {
  readonly onBack: () => void
  readonly backLabel: string
  readonly title: string
  readonly children: ReactNode
  readonly footer?: ReactNode
  /** 1 → 0으로 뒤로·제목을 흐린다 (인증 성공 때, D-UX3-60) */
  readonly away?: Animated.Value
  readonly testID: string
}) {
  const { p } = useKit()
  const bottom = useBottomInset()
  const keyboard = useKeyboardShown()
  // 이 틀은 상태 막대 아래(SafeAreaView 위 여백)에서 시작한다 — 키보드 피하기는 부모 기준 자리로 재므로 그만큼 더해야 단추가 키보드에 가리지 않는다
  const top = useTopInset()
  return (
    <EdgeSwipeBack onBack={onBack}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} keyboardVerticalOffset={top} style={{ flex: 1, backgroundColor: p.surface }} testID={testID}>
        {/* 모든 쌓인 화면과 같은 머리 (D-UX4-40) */}
        <Animated.View style={{ opacity: away ?? 1 }}>
          <NavBar onBack={onBack} backLabel={backLabel} />
        </Animated.View>
        <View style={{ flex: 1, paddingHorizontal: PAGE.side, paddingTop: PAGE.titleTop - NAV.below }}>
          <Animated.View style={{ opacity: away ?? 1 }}>
            <Txt step="headline" weight="bold" role="heading" aria-level={1}>
              {title}
            </Txt>
          </Animated.View>
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
      <Tap role="button" aria-label={CODE_NOT_COMING} onPress={onPress} hitSlop={8} testID="code-not-coming" style={{ minHeight: 44, paddingHorizontal: SPACE.md, justifyContent: 'center' }}>
        {({ pressed }) => (
          <Text style={{ fontSize: TYPE.body, lineHeight: Math.round(TYPE.body * 1.4), ...font(), color: p.primaryText, textDecorationLine: 'underline', opacity: pressed ? 0.5 : 1 }}>{CODE_NOT_COMING}</Text>
        )}
      </Tap>
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

/**
 * 칸 크기 (D-UX3-56, 사용자 지시 "숫자 크기, 각 칸 가로 세로 너비 다시 맞출 것"): 사진을 찍은 휴대폰이 폭 430(15 Pro Max)이라 다시 재어
 * 칸 48×60·사이 8·여섯 칸 328 가운데, 숫자 32 (옛 D-UX3-55 칸 44×54·사이 7·줄 301·숫자 30 — 폭을 393으로 알고 재 9% 작았다)
 */
const CELL_GAP = 8
const CELL_HEIGHT = 60
const ROW_WIDTH = 328
/** 합칠 때 칸들이 가운데로 모이는 거리의 바깥 끝 (칸 사이를 다 메운다) */
const GATHER = ((CODE_LENGTH - 1) / 2) * CELL_GAP
const CELL_WIDTH = (ROW_WIDTH - (CODE_LENGTH - 1) * CELL_GAP) / CODE_LENGTH
/** 숫자 0 하나의 폭 (32·600을 사진으로 재어 약 18) */
const DIGIT_WIDTH = 18
/**
 * 모인 칸을 감싸는 바깥 테의 양옆 자리 (D-UX3-59, 사용자 지시 2026-11-07 "0과 0 사이 간격보다 맨 바깥쪽 0과 바깥 여백이 작아서 좀 답답해보이지 … 0과 0 사이 간격만큼 벌려줘야"):
 * 테에서 맨 바깥 숫자까지 = 숫자와 숫자 사이(칸 폭 − 숫자 폭). 옛 D-UX3-56은 모인 칸 끝(GATHER)에 붙어 바깥 여백이 숫자 사이의 절반이었다
 */
const FRAME_SIDE = GATHER - (CELL_WIDTH - DIGIT_WIDTH) / 2
/** 바깥 테는 이만큼 큰 채로 나타나 칸이 모이는 동안 제 크기로 줄어든다 (D-UX3-59) */
const FRAME_FROM = 1.08
/** 바깥 테가 나타나는 시간 (바로에 가깝게) */
const FRAME_IN_MS = 100
const COVER = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const

/**
 * 인증 성공 움직임 (D-UX3-60, 사용자 지시 2026-11-07 "입력칸이 점점 원으로 되고 나머지 글자는 다 페이드아웃되고 원이 다시 커지면서 안에 체크가 되는", 토스 사진 27~34).
 * 시각(밀리초)마다: ~WIN_FILL 합친 칸이 초록으로 차고 숫자가 흐려짐 → ~WIN_SHRINK 폭·높이가 줄며 알약을 거쳐 작은 원(WIN_DOT)
 * → ~WIN_GROW 원이 커지며 살짝 넘침(WIN_OVER) → WIN_MS 제 크기(WIN_CIRCLE). 체크는 원이 커지기 시작할 때부터 선을 따라 그려진다.
 * 크기는 폭 430 휴대폰 토스 사진을 재어(작은 원 32px·다 큰 원 62px → 약 38·72). 색은 토스 파랑이 아니라 우리 주색(초록).
 */
const WIN_FILL = 140
const WIN_SHRINK = 520
const WIN_GROW = 820
export const WIN_MS = 1000
/** 제목·남은 시간·뒤로가 흐려지는 시간 (작은 원이 될 때쯤 다 사라진다) */
const WIN_AWAY_MS = 420
const WIN_DOT = 38
const WIN_OVER = 78
const WIN_CIRCLE = 72
/** 원 아래 "인증 성공"까지 (사진 34px → 약 40에서 글자 위 여백을 빼) */
const WIN_TEXT_GAP = 32
/** 체크 (24 칸 기준) — 선 길이는 두 토막을 더한 값 */
const CHECK_D = 'M6.5 12.5 L10.3 16.2 L17.5 8.6'
const CHECK_LENGTH = Math.hypot(3.8, 3.7) + Math.hypot(7.2, 7.6)
const CHECK_SIZE = 38
const AnimatedPath = Animated.createAnimatedComponent(Path)

const lerp = (from: number, to: number, k: number): number => from + (to - from) * k
const clamp01 = (k: number): number => Math.min(1, Math.max(0, k))
const easeInOut = Easing.inOut(Easing.cubic)
const easeOut = Easing.out(Easing.cubic)

/** 시각 t의 초록 모양 (폭·높이·모서리) — 처음 크기는 합친 칸(바깥 테) */
export function winShape(t: number, width: number, height: number): { readonly w: number; readonly h: number; readonly r: number } {
  if (t <= WIN_FILL) return { w: width, h: height, r: RADIUS.lg }
  if (t <= WIN_SHRINK) {
    const k = easeInOut(clamp01((t - WIN_FILL) / (WIN_SHRINK - WIN_FILL)))
    const w = lerp(width, WIN_DOT, k)
    const h = lerp(height, WIN_DOT, k)
    // 모서리는 일찍 다 둥글어져 알약이 된다
    return { w, h, r: lerp(RADIUS.lg, h / 2, clamp01(k * 3)) }
  }
  const d = t <= WIN_GROW ? lerp(WIN_DOT, WIN_OVER, easeOut(clamp01((t - WIN_SHRINK) / (WIN_GROW - WIN_SHRINK)))) : lerp(WIN_OVER, WIN_CIRCLE, easeInOut(clamp01((t - WIN_GROW) / (WIN_MS - WIN_GROW))))
  return { w: d, h: d, r: d / 2 }
}

/** 시각 표(20밀리초마다)로 값을 미리 재 둔다 — Animated는 직선 이음이라 촘촘히 */
function winTable(pick: (t: number) => number): { readonly inputRange: number[]; readonly outputRange: number[] } {
  const inputRange: number[] = []
  for (let t = 0; t < WIN_MS; t += 20) inputRange.push(t)
  inputRange.push(WIN_MS)
  return { inputRange, outputRange: inputRange.map(pick) }
}

/** 합친 칸 → 알약 → 원 → 커지며 체크, 아래 "인증 성공" (D-UX3-60) */
function WinMark({ width, height }: { readonly width: number; readonly height: number }) {
  const { p } = useKit()
  const win = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const run = Animated.timing(win, { toValue: WIN_MS, duration: WIN_MS, easing: Easing.linear, useNativeDriver: false })
    run.start()
    return () => run.stop()
  }, [win])
  const tables = useMemo(
    () => ({
      w: winTable((t) => winShape(t, width, height).w),
      h: winTable((t) => winShape(t, width, height).h),
      r: winTable((t) => winShape(t, width, height).r),
      // 체크 그림은 원 크기를 따라 커진다
      k: winTable((t) => winShape(t, width, height).h / WIN_CIRCLE),
    }),
    [width, height],
  )
  const fill = win.interpolate({ inputRange: [0, WIN_FILL], outputRange: [0, 1], extrapolate: 'clamp' })
  const draw = win.interpolate({ inputRange: [WIN_SHRINK + 60, WIN_MS - 40], outputRange: [CHECK_LENGTH, 0], extrapolate: 'clamp' })
  const words = win.interpolate({ inputRange: [WIN_SHRINK, WIN_GROW + 80], outputRange: [0, 1], extrapolate: 'clamp' })
  return (
    <>
      <View pointerEvents="none" style={[COVER, { alignItems: 'center', justifyContent: 'center' }]} testID="code-passed">
        <Animated.View
          style={{
            width: win.interpolate(tables.w),
            height: win.interpolate(tables.h),
            borderRadius: win.interpolate(tables.r), borderCurve: 'continuous',
            backgroundColor: p.primary,
            opacity: fill,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View style={{ width: CHECK_SIZE, height: CHECK_SIZE, transform: [{ scale: win.interpolate(tables.k) }] }}>
            <Svg width={CHECK_SIZE} height={CHECK_SIZE} viewBox="0 0 24 24" aria-hidden>
              <AnimatedPath d={CHECK_D} stroke={p.onPrimary} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]} strokeDashoffset={draw} />
            </Svg>
          </Animated.View>
        </Animated.View>
      </View>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -PAGE.side, right: -PAGE.side, top: height / 2 + WIN_CIRCLE / 2 + WIN_TEXT_GAP, alignItems: 'center', opacity: words }} aria-live="polite">
        <Txt step="headline" weight="bold" role="heading" aria-level={2}>
          {PHONE_VERIFIED}
        </Txt>
      </Animated.View>
    </>
  )
}

/**
 * 인증번호 한 칸 (D-UX3-54, 토스 사진 13·14): 비면 회색. 숫자가 들어오면 칸이 살짝 줄었다 돌아오며 흰 바탕(얇은 회색 테)이 되고,
 * 숫자(초록)는 가운데서부터 서서히 커지며 나타난다. pink면 옅은 빨강 바탕·진한 숫자(틀린 뒤·시간 지남).
 * 숫자는 이 칸 안에만 있다 — 합칠 때도 칸이 숫자를 데리고 움직인다(같은 숫자를 두 겹으로 그리지 않는다, D-UX3-56).
 * skin: 칸 자체의 바탕·테(1 보임, 0 숨김 — 합쳐진 동안은 숨기고 바깥 테 하나만 보인다).
 */
function CodeCell({ char, active, pink, dark, index, together, skin }: { readonly char: string; readonly active: boolean; readonly pink: boolean; readonly dark: boolean; readonly index: number; readonly together: Animated.Value; readonly skin: Animated.Value }) {
  const { p } = useKit()
  const filled = char !== ''
  const fill = useEased(filled ? 1 : 0, CELL_MS)
  // 나뉠 때 옅은 빨강은 바로 (서서히 물들지 않는다), 고쳐 넣어 없어질 때는 서서히
  const pinkness = useEased(pink ? 1 : 0, pink ? 0 : SOFT_MS)
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
          // 합칠 때 가운데로 모인다 (사이가 메워지며 한 칸이 된다), 나눌 때 좌우로 갈라진다
          { translateX: together.interpolate({ inputRange: [0, 1], outputRange: [0, ((CODE_LENGTH - 1) / 2 - index) * CELL_GAP] }) },
          { scale: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [1, 0.88, 1] }) },
        ],
      }}
    >
      <Animated.View style={[COVER, { opacity: skin }]}>
        <View style={[shape, { backgroundColor: p.soft }]} />
        <Animated.View style={[shape, { backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, opacity: fill }]} />
        <Animated.View style={[shape, { backgroundColor: TONES.light.danger.bg, opacity: pinkness }]} />
      </Animated.View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {filled ? (
          <Animated.Text
            allowFontScaling={false}
            style={{
              ...DIGIT,
              color: dark || pink ? p.text : p.primaryText,
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

/** 숫자 (토스 사진을 재어 32·두께 600, D-UX3-56 — 옛 30) */
const DIGIT = { fontSize: 32, ...font(WEIGHT.medium) } as const

/**
 * 인증번호 6칸 (D-UX3-54 순서, D-UX3-56 움직임). 보이지 않는 입력 칸 하나를 칸들 위에 겹쳐 놓는다(누르면 키보드, 문자 자동 채우기).
 * 칸은 한 벌뿐이고 실제로 움직인다 — 사라지는 것과 생기는 것을 겹쳐 바꾸지 않는다
 * (사용자 지시 2026-11-07 "요소가 전환되는게 아니라 자연스럽게 사라지고 생기고 서로 붙고 … 다 쳤을 때는 박스 테두리가 사라지고 박스들이 서로 모이면서 새로운 테두리가 생기는거고,
 * 다시 나눠질 때는 그 반대로 합쳐졌던 박스가 다시 좌우로 움직이면서 갈라지는거고 빨간 테두리와 좌우에 박스 외에 빨간 배경은 바로 사라지는거고").
 * 확인 중: 칸마다 테·바탕은 바로 없어지고 칸(숫자)이 가운데로 모이며, 바깥 테(흰 바탕·연한 초록) 하나가 큰 채로 바로 나타나 모이는 동안 제 크기로 줄어든다(D-UX3-59).
 * 바깥 테에서 맨 바깥 숫자까지는 숫자 사이와 같다(D-UX3-59).
 * 틀림(held 동안)·횟수 초과: 바깥 테가 빨개지며(빨간 테·옅은 빨강 바탕·진한 숫자) 다시 커지고 흔들기·진동, 아래 "! 인증번호가 맞지 않아요."
 * 틀림(held 뒤): 빨간 테와 칸 밖 빨간 바탕은 바로 없어지고, 칸(옅은 빨강·진한 숫자)이 좌우로 움직이며 갈라진다. 문장은 사라진다. 시간 지남: 칸마다 옅은 빨강.
 */
function CodeBoxes({
  value,
  error,
  mark,
  checking,
  passed,
  held,
  onChange,
  inputRef,
}: {
  readonly value: string
  readonly error: string | null
  readonly mark: CodeMark
  readonly checking: boolean
  /** 맞았다 — 합친 칸이 원·체크로 바뀐다 (D-UX3-60) */
  readonly passed: boolean
  readonly held: boolean
  readonly onChange: (text: string) => void
  readonly inputRef: RefObject<TextInputInstance | null>
}) {
  const { p } = useKit()
  const [focused, setFocused] = useState(true)
  const red = mark === 'locked' || (mark === 'wrong' && held)
  const merged = checking || red || passed
  const [rowWidth, setRowWidth] = useState(ROW_WIDTH)
  // 맞으면 숫자가 흐려진다 (초록이 차는 동안)
  const digits = useEased(passed ? 0 : 1, passed ? WIN_FILL : 0)
  const pink = !merged && (mark === 'expired' || mark === 'wrong')
  const together = useEased(merged ? 1 : 0, MERGE_MS)
  // 칸마다 있던 테·바탕(skin)은 합칠 때 바로 없어지고 나눌 때 바로 돌아온다 (D-UX3-59, 사용자 지시 "기존 박스별로 있던 테두리는 바로 사라지기" — 옛 D-UX3-56 서서히).
  // 바깥 테(frame)는 큰 채로 곧바로 나타나 칸이 모이는 동안 줄어들고("큰 상태로 나타났다가 점점 작아지는"), 나눌 때는 빨강과 함께 바로 없어진다
  const skin = useEased(merged ? 0 : 1, 0)
  // 맞으면 바깥 테는 차오르는 초록 아래로 같이 사라진다 (D-UX3-60)
  const frame = useEased(merged && !passed ? 1 : 0, passed ? WIN_FILL : merged ? FRAME_IN_MS : 0)
  const redness = useEased(red ? 1 : 0, red ? MERGE_MS : 0)
  const size = useEased(checking || passed ? CHECKING_SCALE : 1, MERGE_MS)
  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '')
  const shake = useWrongShake(mark === 'wrong' ? error : mark === 'locked' ? CODE_LOCKED_TEXT : null)
  const wrongLine = useSoftShow(mark === 'wrong' && held && error !== null)
  const shape = { ...COVER, borderRadius: RADIUS.lg, borderCurve: 'continuous', borderWidth: 2 } as const
  return (
    <Animated.View style={{ marginTop: CODE_BOXES_TOP, alignItems: 'center', transform: [{ translateX: shake }] }}>
      <Animated.View style={{ width: '100%', maxWidth: ROW_WIDTH, height: CELL_HEIGHT, transform: [{ scale: size }] }} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
        {/* 모인 칸들을 감싸는 바깥 테 하나 (칸들 뒤) */}
        <Animated.View aria-hidden pointerEvents="none" testID={red ? 'code-wrong' : checking ? 'code-checking' : undefined} style={{ ...COVER, left: FRAME_SIDE, right: FRAME_SIDE, opacity: frame, transform: [{ scale: together.interpolate({ inputRange: [0, 1], outputRange: [FRAME_FROM, 1] }) }] }}>
          <View style={[shape, { backgroundColor: p.surface, borderColor: `${p.primary}99` }]} />
          <Animated.View style={[shape, { backgroundColor: TONES.light.danger.bg, borderColor: p.dangerText, opacity: redness }]} />
        </Animated.View>
        <Animated.View style={{ flex: 1, flexDirection: 'row', gap: CELL_GAP, opacity: digits }}>
          {cells.map((cell, index) => (
            <CodeCell key={index} index={index} char={cell} pink={pink} dark={red} together={together} skin={skin} active={focused && !merged && value.length < CODE_LENGTH && index === value.length} />
          ))}
        </Animated.View>
        {passed ? <WinMark width={Math.max(WIN_DOT, rowWidth - 2 * FRAME_SIDE)} height={CELL_HEIGHT} /> : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          aria-label={CODE_FIELD}
          aria-invalid={mark !== null}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          // caretHidden·contextMenuHidden을 쓰지 않는다 (D-UX3-61): contextMenuHidden은 칸이 모든 편집 동작에 "못 함"(canPerformAction NO)이라 답하게 해
          // 키보드 위 인증번호 누르기가 들어가지 않을 수 있고, caretHidden은 입력 자리를 지운다. 입력 자리는 색을 투명하게 해 숨긴다
          selectionColor="transparent"
          cursorColor="transparent"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID="code-input"
          style={{ ...COVER, opacity: 0.02, color: 'transparent', fontSize: 1 }}
        />
      </Animated.View>
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

