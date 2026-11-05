// 로그인 화면 (AC-S05-01, SYS-01, 웹 LoginPage와 같은 문장). 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
// D-UX3-28 (사용자 지시 2026-11-05): 간편 로그인은 웹으로 넘기지 않고 앱 위 로그인 창으로 한다(lib/social-auth.ts). 처음 계정이면 동의 판(취소|동의하고 시작하기)에서
// 바로 가입한다. 단추는 공식 로고를 왼쪽에 둔 긴 단추이고, 그 기기에서 마지막으로 로그인한 방법에 "최근 로그인" 말풍선.
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import {
  continueLabel,
  RECENT_LOGIN,
  resultMessage,
  SIGNUP_AGREE,
  SIGNUP_BODY,
  SIGNUP_BUTTON,
  SIGNUP_HAVE_ID,
  SIGNUP_NEED_AGREE,
  signupTitle,
  LOGIN_CODES,
  type LastLogin,
  type LoginProvider,
} from '@livejjim/web/src/lib/social-login.ts'
import { SOCIAL_COLORS, SOCIAL_LOGOS } from '@livejjim/web/src/lib/social-logos.ts'
import { isApiError, type ApiError } from '../api/client.ts'
import { appSignup, appSocialLogin, APP_LOGIN_FAILED, fetchAppLoginProviders, readAppLastLogin, rememberAppLastLogin } from '../lib/social-auth.ts'
import { LOGIN_ACCOUNT_NOTE, LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SERVICE_NAME, SESSION_EXPIRED_MESSAGE } from '../lib/words.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { BigButton, Card, Field, Hint, Notice, Screen, Stack } from '../ui/parts.tsx'

interface Signup {
  readonly provider: LoginProvider
  readonly ticket: string
  readonly verifier: string
}

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
  const [last, setLast] = useState<LastLogin | null>(null)
  const [moving, setMoving] = useState<LoginProvider | null>(null)
  const [socialMessage, setSocialMessage] = useState<string | null>(null)
  const [signup, setSignup] = useState<Signup | null>(null)

  useEffect(() => {
    let alive = true
    void fetchAppLoginProviders().then((list) => {
      if (alive) setProviders(list)
    })
    void readAppLastLogin().then((value) => {
      if (alive) setLast(value)
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
    setSignup(null)
    try {
      const outcome = await appSocialLogin(provider)
      if (outcome.kind === 'logged_in') {
        await rememberAppLastLogin(provider)
        await onSocialDone?.()
      } else if (outcome.kind === 'signup') {
        setSignup({ provider: outcome.provider, ticket: outcome.ticket, verifier: outcome.verifier })
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

  return (
    <Screen title={SERVICE_NAME} testID="login-screen">
      {signup !== null ? (
        <SignupPanel
          signup={signup}
          onCancel={() => setSignup(null)}
          onDone={async () => {
            await rememberAppLastLogin(signup.provider)
            await onSocialDone?.()
          }}
        />
      ) : null}
      {expired ? <Notice tone="warning">{SESSION_EXPIRED_MESSAGE}</Notice> : null}
      {offline ? <Notice tone="warning" alert>{OFFLINE_AT_START_MESSAGE}</Notice> : null}
      {offline && onRecheck !== undefined ? <BigButton label="다시 확인" disabled={rechecking} onPress={() => void recheck()} /> : null}
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
      {providers.length > 0 ? (
        <Stack tight>
          <OrLine />
          {providers.map((provider) => (
            <SocialButton key={provider} provider={provider} recent={last === provider} disabled={moving !== null} onPress={() => void social(provider)} />
          ))}
          {socialMessage !== null ? <Notice tone="danger" alert>{socialMessage}</Notice> : null}
        </Stack>
      ) : null}
      <Hint>{LOGIN_ACCOUNT_NOTE}</Hint>
    </Screen>
  )
}

function OrLine() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginVertical: SPACE.sm }}>
      <View style={{ flex: 1, height: 1, backgroundColor: '#C7CAD1' }} />
      <Text style={{ color: '#5F6368', fontSize: 15 }}>또는</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: '#C7CAD1' }} />
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

/** 긴 단추: 왼쪽 공식 로고, 가운데 "카카오로 계속하기", 오른쪽 "최근 로그인" 말풍선 */
export function SocialButton({ provider, recent, disabled, onPress }: { readonly provider: LoginProvider; readonly recent: boolean; readonly disabled: boolean; readonly onPress: () => void }) {
  const color = SOCIAL_COLORS[provider]
  const label = continueLabel(provider)
  return (
    <Pressable
      role="button"
      aria-label={recent ? `${label}, ${RECENT_LOGIN}` : label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={`social-${provider}`}
      style={({ pressed }) => ({
        minHeight: 54,
        borderRadius: RADIUS.lg, borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: color.border,
        backgroundColor: color.background,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 56,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <View style={{ position: 'absolute', left: 20, top: 0, bottom: 0, justifyContent: 'center' }}>
        <SocialLogo provider={provider} />
      </View>
      <Text style={{ color: color.text, fontSize: 17, fontWeight: '700' }}>{label}</Text>
      {recent ? (
        <View style={{ position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderRightWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: '#333333' }} />
          <View style={{ backgroundColor: '#333333', borderRadius: 8, borderCurve: 'continuous', paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>{RECENT_LOGIN}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  )
}

/** 동의 판 (D-UX3-28): 동의 체크(필수) → 취소 | 동의하고 시작하기 (좌우 — CLAUDE.md 8) */
function SignupPanel({ signup, onCancel, onDone }: { readonly signup: Signup; readonly onCancel: () => void; readonly onDone: () => Promise<void> }) {
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const start = async () => {
    if (busy) return
    if (!agree) {
      setProblem(SIGNUP_NEED_AGREE)
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await appSignup(signup.ticket, signup.verifier)
      await onDone()
    } catch (caught) {
      setProblem(isApiError(caught) && !caught.network ? caught.message : APP_LOGIN_FAILED)
      setBusy(false)
    }
  }
  return (
    <Card label={signupTitle(signup.provider)}>
      <Stack tight>
        <Text role="heading" style={{ fontSize: 18, fontWeight: '700' }}>{signupTitle(signup.provider)}</Text>
        <Text style={{ fontSize: 16 }}>{SIGNUP_BODY}</Text>
        <Pressable
          role="checkbox"
          aria-checked={agree}
          aria-label={SIGNUP_AGREE}
          onPress={() => {
            setAgree((value) => !value)
            setProblem(null)
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44 }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 6, borderCurve: 'continuous', borderWidth: 2, borderColor: agree ? '#2557C7' : '#747775', backgroundColor: agree ? '#2557C7' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
            {agree ? <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>✓</Text> : null}
          </View>
          <Text style={{ fontSize: 16, fontWeight: '600', flexShrink: 1 }}>{SIGNUP_AGREE}</Text>
        </Pressable>
        {problem !== null ? <Notice tone="danger" alert>{problem}</Notice> : null}
        <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
          <View style={{ flex: 1 }}>
            <BigButton label="취소" disabled={busy} onPress={onCancel} />
          </View>
          <View style={{ flex: 1 }}>
            <BigButton label={SIGNUP_BUTTON} primary disabled={busy} onPress={() => void start()} />
          </View>
        </View>
        <Hint>{SIGNUP_HAVE_ID}</Hint>
      </Stack>
    </Card>
  )
}
