// 로그인 화면 (AC-S05-01, SYS-01, 웹 LoginPage와 같은 문장). 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
// D-UX3-28 (사용자 지시 2026-11-05): 간편 로그인은 웹으로 넘기지 않고 앱 위 로그인 창으로 한다(lib/social-auth.ts). 처음 계정이면
// 바로 가입한다. 단추는 공식 로고를 왼쪽에 둔 긴 단추이고, 그 기기에서 마지막으로 로그인한 방법에 "최근 로그인" 말풍선.
// D-UX3-29 (사용자 지시 2026-11-05): 단추 이름 "…로 로그인", 크기·두께·간격은 KREAM 참고 사진(높이 52·글자 16 보통 굵게·사이 12·구글 테두리 옅게),
// 누르면 그 단추 안이 진해지고 다른 단추는 그대로. 동의 판은 없다 — 단추 아래 안내 한 줄을 보고 누른 것으로 동의, 처음 계정이면 바로 가입.
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import {
  continueLabel,
  RECENT_LOGIN,
  resultMessage,
  SIGNUP_MAKING,
  SOCIAL_TERMS_NOTE,
  LOGIN_CODES,
  type LastLogin,
  type LoginProvider,
} from '@livejjim/web/src/lib/social-login.ts'
import { SOCIAL_COLORS, SOCIAL_LOGOS } from '@livejjim/web/src/lib/social-logos.ts'
import { isApiError, type ApiError } from '../api/client.ts'
import { openWeb } from '../lib/open-web.ts'
import { appSignup, appSocialLogin, APP_LOGIN_FAILED, fetchAppLoginProviders, readAppLastLogin, rememberAppLastLogin } from '../lib/social-auth.ts'
import { LOGIN_ACCOUNT_NOTE, LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SERVICE_NAME, SESSION_EXPIRED_MESSAGE } from '../lib/words.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { BigButton, Field, Hint, Notice, Screen, Stack } from '../ui/parts.tsx'

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
  const [making, setMaking] = useState(false)

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
    try {
      const outcome = await appSocialLogin(provider)
      if (outcome.kind === 'logged_in') {
        await rememberAppLastLogin(provider)
        await onSocialDone?.()
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

  return (
    <Screen title={SERVICE_NAME} testID="login-screen">
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
          <View style={{ gap: 12 }}>
            {providers.map((provider) => (
              // 누른 단추만 눌린 모양으로 — 다른 단추는 흐리게 하지 않는다. 겹쳐 누르기는 social()이 막는다 (D-UX3-29)
              <SocialButton key={provider} provider={provider} recent={last === provider} busy={moving === provider} onPress={() => void social(provider)} />
            ))}
          </View>
          {making ? <Notice tone="info">{SIGNUP_MAKING}</Notice> : null}
          {socialMessage !== null ? <Notice tone="danger" alert>{socialMessage}</Notice> : null}
          <TermsNote />
        </Stack>
      ) : null}
      <Hint>{LOGIN_ACCOUNT_NOTE}</Hint>
    </Screen>
  )
}

/** 간편 로그인 아래 안내 한 줄과 이용약관·개인정보처리방침 링크 (D-UX3-29) */
function TermsNote() {
  const link = (label: string, path: string) => (
    <Text role="link" aria-label={label} onPress={() => void openWeb(path)} style={{ color: '#4E5968', fontSize: 13, textDecorationLine: 'underline' }}>
      {label}
    </Text>
  )
  return (
    <View style={{ gap: 6, alignItems: 'center', paddingTop: 4 }}>
      <Text style={{ color: '#6B7684', fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{SOCIAL_TERMS_NOTE}</Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        {link('이용약관', '/terms')}
        {link('개인정보처리방침', '/privacy')}
      </View>
    </View>
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

/** 긴 단추: 왼쪽 공식 로고, 가운데 "카카오로 로그인", 오른쪽 "최근 로그인" 말풍선. 누르는 동안·로그인 중에는 단추 안이 진해진다 */
export function SocialButton({ provider, recent, busy, onPress }: { readonly provider: LoginProvider; readonly recent: boolean; readonly busy: boolean; readonly onPress: () => void }) {
  const color = SOCIAL_COLORS[provider]
  const label = continueLabel(provider)
  return (
    <Pressable
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
          <Text allowFontScaling={false} style={{ color: color.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
          {recent ? (
            <View style={{ position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderRightWidth: 6, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: '#333333' }} />
              <View style={{ backgroundColor: '#333333', borderRadius: 8, borderCurve: 'continuous', paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text allowFontScaling={false} style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600' }}>{RECENT_LOGIN}</Text>
              </View>
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  )
}
