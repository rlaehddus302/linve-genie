// 로그인 화면 (AC-S05-01, SYS-01, 웹 LoginPage와 같은 문장). 계정은 운영자가 만든다 — 가입 화면·링크는 없다.
// 틀리면 서버 문장을 그대로 보이고 아이디는 남긴다. 세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다.
// 간편 로그인(카카오·네이버·구글)은 브라우저 흐름이라 앱 첫 판에는 없다 — "웹으로 열기"로 잇는다.
import { useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import { openWeb } from '../lib/open-web.ts'
import { LOGIN_ACCOUNT_NOTE, LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, OPEN_IN_WEB, SERVICE_NAME, SESSION_EXPIRED_MESSAGE } from '../lib/words.ts'
import { BigButton as KitButton } from '../ui/kit/index.ts'
import { BigButton, Field, Hint, Notice, Screen, Stack } from '../ui/parts.tsx'

export function LoginScreen({ expired, offline = false, onRecheck, onLogin }: { readonly expired: boolean; readonly offline?: boolean; readonly onRecheck?: () => Promise<void>; readonly onLogin: (loginId: string, password: string) => Promise<void> }) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [rechecking, setRechecking] = useState(false)

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
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={SERVICE_NAME} testID="login-screen">
      <Hint>아이디와 비밀번호를 넣어 주세요.</Hint>
      {expired ? <Notice tone="warning">{SESSION_EXPIRED_MESSAGE}</Notice> : null}
      {offline ? <Notice tone="warning" alert>{OFFLINE_AT_START_MESSAGE}</Notice> : null}
      {offline && onRecheck !== undefined ? <BigButton label="다시 확인" disabled={rechecking} onPress={() => void recheck()} /> : null}
      <Stack>
        <Field label="아이디" value={loginId} onChangeText={setLoginId} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" />
        <Field label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={() => void submit()} />
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {error !== null && error.code === 'LOGIN_FAILED' ? <Hint>{LOGIN_FAILED_HINT}</Hint> : null}
        <BigButton label="로그인" primary disabled={busy} onPress={() => void submit()} />
      </Stack>
      <Hint>{LOGIN_ACCOUNT_NOTE}</Hint>
      <KitButton kind="outline" label="간편 로그인 (카카오·네이버·구글)" ariaLabel={`간편 로그인(카카오·네이버·구글) — ${OPEN_IN_WEB}`} onPress={() => void openWeb('/login')} />
    </Screen>
  )
}
