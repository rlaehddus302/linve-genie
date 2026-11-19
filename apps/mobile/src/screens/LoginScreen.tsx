// 로그인 화면 (AC-S05-01, SYS-01, 웹 LoginPage와 같은 문장). 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
// D-UX3-28 (사용자 지시 2026-11-05): 간편 로그인은 웹으로 넘기지 않고 앱 위 로그인 창으로 한다(lib/social-auth.ts). 처음 계정이면
// 바로 가입한다. 단추는 공식 로고를 왼쪽에 둔 긴 단추이고, 그 기기에서 마지막으로 로그인한 방법에 "최근 로그인" 말풍선.
// D-UX3-29 (사용자 지시 2026-11-05): 단추 이름 "…로 로그인", 크기·두께·간격은 KREAM 참고 사진(높이 52·글자 16 보통 굵게·사이 12·구글 테두리 옅게),
// 누르면 그 단추 안이 진해지고 다른 단추는 그대로. 동의 판은 없다 — 단추 아래 안내 한 줄을 보고 누른 것으로 동의, 처음 계정이면 바로 가입.
// D-UX3-30 (사용자 지시 2026-11-05 "같은 사람이면 하나의 계정으로"): 문자 인증이 켜진 서버에서 처음 계정이면 휴대폰 번호를 먼저 확인한다.
// 새 번호면 가입, 이미 있는 번호면 "이미 가입한 계정이 있어요" — 그 계정의 간편 로그인으로 다시 로그인하면 방금 공급자가 그 계정에 이어진다.
// D-UX3-31 (사용자 지시 2026-11-05 "아이디 비밀번호 방식 다 지우고 소셜 로그인만 남기고 밑에 쓸데 없는 설명은 지우고 필수적인거만"): 첫 화면은 간편 로그인 단추와
// 약관 안내만. 아이디·비밀번호 칸·"또는" 줄·아래 설명은 없앤다.
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어 … 로그인 화면은 첨부 사진과 같이"): KREAM 참고 배치 — 화면 높이를 나눠 위 칸 가운데에 큰 서비스명,
// 그 아래 간편 로그인 단추와 동의 안내, 일정한 빈칸, 맨 아래(안전 영역 안)에 이용약관·개인정보처리방침과 고객센터 번호·이메일.
// 빈칸은 flex 비율로 나눠 휴대폰 높이와 상관없이 같은 모양이고, 작은 화면에서는 최소 높이를 지키고 스크롤된다.
// 도우미(보조자)를 없애 [아이디로 로그인] 링크도 뺐다. 운영자가 만든 계정·심사용 계정은 서비스명을 2초 안에 다섯 번 누르면 아이디 칸이 열린다(숨은 길).
// 마지막으로 아이디로 들어온 기기이거나 간편 로그인이 켜지지 않은 서버면 처음부터 칸을 연다.
// D-UX3-49 (사용자 지시 2026-11-07 사진): 번호 확인은 사진대로 세 화면(번호 → 인증번호 6칸 → 인증 성공 2초)이고, 단계 사이는 밀어 넘긴다.
// D-UX3-33 (사용자 지시 2026-11-06 "처음이면 ... 동의한것으로 봐요 이 설명도 필요없어 지워"): 단추 아래 동의 안내 한 줄도 뺐다 — 약관 두 링크는 맨 아래에 그대로.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { Tap } from '../ui/kit/press.tsx'
import Svg, { Path } from 'react-native-svg'
import {
  continueLabel,
  NOT_THAT_ACCOUNT,
  START_OVER,
  RECENT_LOGIN,
  resultMessage,
  SIGNUP_MAKING,
  LOGIN_CODES,
  type ExistingLogin,
  type LastLogin,
  type LoginProvider,
} from '@livejjim/web/src/lib/social-login.ts'
import { SOCIAL_COLORS, SOCIAL_LOGOS } from '@livejjim/web/src/lib/social-logos.ts'
import { isApiError, post, type ApiError } from '../api/client.ts'
import { openWeb } from '../lib/open-web.ts'
import {
  appSignup,
  appSignupLink,
  appSignupPhoneSend,
  appSignupPhoneVerify,
  appSocialLogin,
  APP_LOGIN_FAILED,
  fetchAppLoginProviders,
  readAppLastLogin,
  rememberAppLastLogin,
} from '../lib/social-auth.ts'
import { ExistingAccount } from './ExistingAccount.tsx'
import { PhoneVerify } from './PhoneVerify.tsx'
import { SlideSwitch } from '../ui/kit/slide.tsx'
import { LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SERVICE_NAME, SESSION_EXPIRED_MESSAGE, SUPPORT_EMAIL, SUPPORT_PHONE } from '../lib/words.ts'
import { useBottomInset, useKit } from '../ui/kit/theme.tsx'
import { font } from '../ui/kit/font.ts'
import { MAX_FONT_SCALE } from '../ui/kit/tokens.ts'
import { BigButton, Field, Hint, Notice, Stack } from '../ui/parts.tsx'

/** 숨은 아이디 칸: 서비스명을 이 시간 안에 이만큼 누르면 연다 */
const ID_TAPS = 5
const ID_TAPS_MS = 2000

/** 간편 가입의 단계 (D-UX3-30): 처음 화면 → 번호 확인 → (있는 번호면) 그 계정으로 다시 로그인 */
type SignupStage =
  | { readonly kind: 'main' }
  | { readonly kind: 'phone'; readonly provider: LoginProvider; readonly ticket: string; readonly verifier: string }
  | {
      readonly kind: 'existing'
      readonly provider: LoginProvider
      readonly ticket: string
      readonly verifier: string
      readonly phone: string
      readonly accounts: readonly ExistingLogin[]
    }

/** 아이디로 로그인 글자 단추 (D-IDLOGIN-01) */
export const ID_LOGIN_LABEL = '아이디로 로그인'

export function LoginScreen({
  expired,
  offline = false,
  onRecheck,
  onLogin,
  onSocialDone,
}: {
  readonly expired: boolean
  readonly offline?: boolean
  readonly onRecheck?: () => Promise<void>
  readonly onLogin: (loginId: string, password: string) => Promise<void>
  /** 간편 로그인·가입으로 세션 쿠키를 받았다 — 세션을 다시 읽는다 */
  readonly onSocialDone?: () => Promise<void>
}) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [providers, setProviders] = useState<readonly LoginProvider[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [idOpen, setIdOpen] = useState(false)
  const [last, setLast] = useState<LastLogin | null>(null)
  const [moving, setMoving] = useState<LoginProvider | null>(null)
  const [socialMessage, setSocialMessage] = useState<string | null>(null)
  const [making, setMaking] = useState(false)
  const [stage, setStage] = useState<SignupStage>({ kind: 'main' })
  const taps = useRef<number[]>([])
  const { p } = useKit()
  const bottom = useBottomInset()

  /** 서비스명 누름: 2초 안에 다섯 번이면 아이디 칸을 연다 (운영자·심사용 계정, D-UX3-32) */
  const tapTitle = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((at) => now - at < ID_TAPS_MS), now]
    if (taps.current.length >= ID_TAPS) {
      taps.current = []
      setIdOpen(true)
    }
  }

  useEffect(() => {
    let alive = true
    void fetchAppLoginProviders().then((list) => {
      if (!alive) return
      setProviders(list)
      setProvidersLoaded(true)
    })
    void readAppLastLogin().then((value) => {
      if (!alive) return
      setLast(value)
      if (value === 'id') setIdOpen(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const recheck = async () => {
    if (rechecking || onRecheck === undefined) return
    setRechecking(true)
    try {
      await onRecheck()
    } finally {
      setRechecking(false)
    }
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onLogin(loginId, password)
      void rememberAppLastLogin('id')
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const social = async (provider: LoginProvider) => {
    if (moving !== null) return
    setMoving(provider)
    setSocialMessage(null)
    try {
      const outcome = await appSocialLogin(provider)
      if (outcome.kind === 'logged_in') {
        await rememberAppLastLogin(provider)
        await onSocialDone?.()
      } else if (outcome.kind === 'signup' && outcome.phoneRequired) {
        // 처음 계정: 휴대폰 번호부터 확인한다 (D-UX3-30)
        setStage({ kind: 'phone', provider: outcome.provider, ticket: outcome.ticket, verifier: outcome.verifier })
      } else if (outcome.kind === 'signup') {
        // 처음 계정: 단추 아래 안내를 보고 누른 것이 동의 — 바로 만든다 (D-UX3-29)
        setMaking(true)
        try {
          await appSignup(outcome.ticket, outcome.verifier)
        } finally {
          setMaking(false)
        }
        await rememberAppLastLogin(outcome.provider)
        await onSocialDone?.()
      } else if (outcome.kind === 'result') {
        const known = (LOGIN_CODES as readonly string[]).includes(outcome.code)
        setSocialMessage(known ? resultMessage({ code: outcome.code as (typeof LOGIN_CODES)[number], provider: outcome.provider }).text : APP_LOGIN_FAILED)
      } else if (outcome.kind === 'failed') {
        setSocialMessage(outcome.message)
      }
    } catch (caught) {
      setSocialMessage(isApiError(caught) && !caught.network ? caught.message : APP_LOGIN_FAILED)
    } finally {
      setMoving(null)
    }
  }

  /** 번호를 확인했다: 새 번호면 가입, 있는 번호면 다시 로그인 단계로 — 할 일은 "인증 성공" 화면 2초 뒤에 (D-UX3-49) */
  const phoneVerified = async (current: Extract<SignupStage, { kind: 'phone' }>, code: string): Promise<() => Promise<void>> => {
    const next = await appSignupPhoneVerify(current.ticket, current.verifier, code)
    if (next.next === 'LOGIN_EXISTING') {
      return async () => setStage({ kind: 'existing', provider: current.provider, ticket: current.ticket, verifier: current.verifier, phone: next.phone, accounts: next.accounts })
    }
    setMaking(true)
    try {
      await appSignup(current.ticket, current.verifier)
    } finally {
      setMaking(false)
    }
    return async () => {
      await rememberAppLastLogin(current.provider)
      await onSocialDone?.()
    }
  }

  /** 있는 번호의 계정으로 다시 로그인하고, 방금 공급자를 그 계정에 잇는다 */
  const relogin = async (current: Extract<SignupStage, { kind: 'existing' }>, provider: LoginProvider) => {
    if (moving !== null) return
    setMoving(provider)
    setSocialMessage(null)
    try {
      const outcome = await appSocialLogin(provider)
      if (outcome.kind === 'signup') setSocialMessage(NOT_THAT_ACCOUNT)
      else if (outcome.kind === 'result') {
        const known = (LOGIN_CODES as readonly string[]).includes(outcome.code)
        setSocialMessage(known ? resultMessage({ code: outcome.code as (typeof LOGIN_CODES)[number], provider: outcome.provider }).text : APP_LOGIN_FAILED)
      } else if (outcome.kind === 'failed') setSocialMessage(outcome.message)
      else if (outcome.kind === 'logged_in') {
        try {
          await appSignupLink(current.ticket, current.verifier)
        } catch (caught) {
          // 다른 계정으로 들어갔으면 그 세션을 닫고 다시 고르게 한다. 그 밖(이미 이어짐·표 만료)은 맞는 계정이라 그대로 들어간다
          if (isApiError(caught) && caught.code === 'LINK_MISMATCH') {
            await post('/api/logout', {}).catch(() => undefined)
            setSocialMessage(caught.message)
            return
          }
        }
        await rememberAppLastLogin(provider)
        await onSocialDone?.()
      }
    } catch (caught) {
      setSocialMessage(isApiError(caught) && !caught.network ? caught.message : APP_LOGIN_FAILED)
    } finally {
      setMoving(null)
    }
  }

  const startOver = () => {
    setStage({ kind: 'main' })
    setSocialMessage(null)
  }

  // 단계 사이는 밀어 넘긴다 — 처음 화면으로 돌아갈 때만 반대 방향 (D-UX3-49)
  const slide = (node: ReactNode) => (
    <SlideSwitch id={stage.kind} back={stage.kind === 'main'}>
      {node}
    </SlideSwitch>
  )

  if (stage.kind === 'phone') {
    const current = stage
    return slide(
      <View style={{ flex: 1 }} testID="login-phone">
        <PhoneVerify
          send={(phone) => appSignupPhoneSend(current.ticket, current.verifier, phone)}
          verify={(code) => phoneVerified(current, code)}
          back={{ label: START_OVER, onPress: startOver }}
          busyText={making ? SIGNUP_MAKING : null}
        />
      </View>,
    )
  }

  if (stage.kind === 'existing') {
    const current = stage
    // D-UX3-59: 토스 질문 화면 — 제목·설명·있는 계정 카드·[연결하기] (옛 D-UX3-30 공급자 단추 목록·[처음으로])
    return slide(
      <ExistingAccount
        phone={current.phone}
        provider={current.provider}
        accounts={current.accounts}
        moving={moving}
        message={socialMessage}
        onLink={(provider) => void relogin(current, provider)}
        onLeave={startOver}
      />,
    )
  }

  const idForm = idOpen || (providersLoaded && providers.length === 0)
  return slide(
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: bottom + 20 }}
      keyboardShouldPersistTaps="handled"
      testID="login-screen"
    >
      {expired ? <Notice tone="warning">{SESSION_EXPIRED_MESSAGE}</Notice> : null}
      {offline ? <Notice tone="warning" alert>{OFFLINE_AT_START_MESSAGE}</Notice> : null}
      {offline && onRecheck !== undefined ? <BigButton label="다시 확인" disabled={rechecking} onPress={() => void recheck()} /> : null}
      {/* 위 칸: 남은 높이를 나눠 가운데에 서비스명 (작은 화면에서도 최소 높이) */}
      <View style={{ flex: 3, minHeight: 140, justifyContent: 'center', alignItems: 'center' }}>
        {/* 누름 예외: 숨은 누름 — 단추가 아닌 서비스 이름 (D-UX4-72) */}
        <Pressable onPress={tapTitle} testID="login-title" accessible={false}>
          <Text role="heading" aria-level={1} allowFontScaling={false} style={{ color: p.text, fontSize: 44, ...font('900'), letterSpacing: -1.5 }}>
            {SERVICE_NAME}
          </Text>
        </Pressable>
      </View>
      <View style={{ gap: 12 }}>
        {providers.map((provider) => (
          // 누른 단추만 눌린 모양으로 — 다른 단추는 흐리게 하지 않는다. 겹쳐 누르기는 social()이 막는다 (D-UX3-29)
          <SocialButton key={provider} provider={provider} recent={last === provider} busy={moving === provider} onPress={() => void social(provider)} />
        ))}
        {making ? <Notice tone="info">{SIGNUP_MAKING}</Notice> : null}
        {socialMessage !== null ? <Notice tone="danger" alert>{socialMessage}</Notice> : null}
        {idForm ? (
          <Stack>
            <Field label="아이디" value={loginId} onChangeText={(text) => {
              setLoginId(text)
              setError(null)
            }} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" />
            <Field label="비밀번호" value={password} onChangeText={(text) => {
              setPassword(text)
              setError(null)
            }} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
            {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
            {error !== null && error.code === 'LOGIN_FAILED' ? <Hint>{LOGIN_FAILED_HINT}</Hint> : null}
            <BigButton label="로그인" primary disabled={busy} onPress={() => void submit()} />
          </Stack>
        ) : (
          // 아이디·비밀번호 로그인 (D-IDLOGIN-01, 사용자 2026-11-20 "문자 인증 필요 없는 아이디 비번 방식 ui 만들고"): 옛 판은 서비스 이름을 여러 번 눌러야 열렸다
          <Tap role="button" aria-label={ID_LOGIN_LABEL} testID="login-id-open" onPress={() => setIdOpen(true)} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12, opacity: pressed ? 0.5 : 1 })}>
            <Text allowFontScaling={false} style={{ color: p.textSub, fontSize: 15, ...font('500') }}>{ID_LOGIN_LABEL}</Text>
          </Tap>
        )}
      </View>
      {/* 단추와 맨 아래 사이 일정한 빈칸 (위 칸의 절반 비율, 최소 40) */}
      <View style={{ flex: 2, minHeight: 40 }} />
      <LoginFooter />
    </ScrollView>,
  )
}

/** 맨 아래: 이용약관·개인정보처리방침, 고객센터 번호·이메일 (D-UX3-32 — 번호는 임시) */
function LoginFooter() {
  const { p } = useKit()
  const link = (label: string, onPress: () => void, size: number, color: string, ariaLabel = label) => (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} role="link" aria-label={ariaLabel} onPress={onPress} suppressHighlighting={false} style={{ color, fontSize: size, ...font() }}>
      {label}
    </Text>
  )
  return (
    <View style={{ alignItems: 'center', gap: 8 }} testID="login-footer">
      <View style={{ flexDirection: 'row', gap: 20 }}>
        {link('이용약관', () => void openWeb('/terms'), 13, p.textSub)}
        {link('개인정보처리방침', () => void openWeb('/privacy'), 13, p.textSub)}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: '#6B7684', fontSize: 12, ...font() }}>
        {'고객센터 '}
        {link(SUPPORT_PHONE, () => void Linking.openURL(`tel:${SUPPORT_PHONE.replaceAll('-', '')}`), 12, '#6B7684', `고객센터 전화 ${SUPPORT_PHONE}`)}
        {'  |  '}
        {link(SUPPORT_EMAIL, () => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`), 12, '#6B7684', `고객센터 이메일 ${SUPPORT_EMAIL}`)}
      </Text>
    </View>
  )
}

/** 공급자 공식 로고 */
export function SocialLogo({ provider, size = 22 }: { readonly provider: LoginProvider; readonly size?: number }) {
  const logo = SOCIAL_LOGOS[provider]
  return (
    <Svg width={size} height={size} viewBox={logo.viewBox} aria-hidden>
      {logo.paths.map((path) => (
        <Path key={path.d} d={path.d} fill={path.fill} />
      ))}
    </Svg>
  )
}

/** 긴 단추: 왼쪽 공식 로고, 가운데 "카카오로 로그인", 오른쪽 "최근 로그인" 말풍선. 누르는 동안·로그인 중에는 단추 안이 진해진다 */
export function SocialButton({ provider, recent, busy, onPress }: { readonly provider: LoginProvider; readonly recent: boolean; readonly busy: boolean; readonly onPress: () => void }) {
  const color = SOCIAL_COLORS[provider]
  const label = continueLabel(provider)
  return (
    <Tap
      role="button"
      aria-label={recent ? `${label}, ${RECENT_LOGIN}` : label}
      aria-busy={busy}
      onPress={onPress}
      testID={`social-${provider}`}
      style={{
        height: 52,
        borderRadius: 12, borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: color.border,
        backgroundColor: color.background,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 52,
        overflow: 'hidden',
      }}
    >
      {({ pressed }) => (
        <>
          {pressed || busy ? <View testID={`social-${provider}-pressed`} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.pressed }} /> : null}
          <View style={{ position: 'absolute', left: 18, top: 0, bottom: 0, justifyContent: 'center' }}>
            <SocialLogo provider={provider} size={20} />
          </View>
          <Text allowFontScaling={false} style={{ color: color.text, fontSize: 16, ...font('600') }}>{label}</Text>
          {recent ? (
            <View style={{ position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderRightWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: '#333333' }} />
              <View style={{ backgroundColor: '#333333', borderRadius: 8, borderCurve: 'continuous', paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text allowFontScaling={false} style={{ color: '#FFFFFF', fontSize: 12, ...font('600') }}>{RECENT_LOGIN}</Text>
              </View>
            </View>
          ) : null}
        </>
      )}
    </Tap>
  )
}
