// 휴대폰 번호 확인 판 (D-UX3-30): 번호 → [인증번호 받기] → 6자리 → [확인]. 가입 중(가입 표)과 로그인한 계정(번호 등록)이 같이 쓴다.
// 번호 바꾸기는 글 링크. 인증번호 칸은 문자 자동 채우기(아이폰 oneTimeCode·안드로이드 sms-otp)를 켠다. 단추는 좌우로(부정 왼쪽, 긍정 오른쪽 — CLAUDE.md 8).
import { useState } from 'react'
import { Text, View } from 'react-native'
import {
  CODE_CONFIRM,
  CODE_FIELD,
  CODE_RESEND,
  codeSentMessage,
  PHONE_CHANGE,
  PHONE_FIELD,
  PHONE_PLACEHOLDER,
  PHONE_SEND,
} from '@livejjim/web/src/lib/social-login.ts'
import { isApiError } from '../api/client.ts'
import { APP_LOGIN_FAILED } from '../lib/social-auth.ts'
import { BigButton, Body, Field, Notice, Row, Stack, Title } from '../ui/parts.tsx'

export interface PhoneVerifyProps {
  readonly title: string
  readonly body: string
  /** 인증번호 받기 → 가린 번호 */
  readonly send: (phone: string) => Promise<string>
  /** 인증번호 확인 (틀리면 서버 문장으로 던진다) */
  readonly verify: (code: string) => Promise<void>
  /** 왼쪽 단추 (처음으로·로그아웃) */
  readonly back?: { readonly label: string; readonly onPress: () => void }
  readonly busyText?: string | null
}

const messageOf = (caught: unknown): string => (isApiError(caught) && !caught.network ? caught.message : APP_LOGIN_FAILED)

export function PhoneVerify({ title, body, send, verify, back, busyText }: PhoneVerifyProps) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      setSentTo(await send(phone))
      setCode('')
    })
  const confirm = () => run(() => verify(code))

  const pair = (left: { label: string; onPress: () => void } | undefined, right: { label: string; onPress: () => void; disabled: boolean; testID: string }) => (
    <Row>
      {left !== undefined ? (
        <View style={{ flex: 1 }}>
          <BigButton label={left.label} onPress={left.onPress} disabled={busy} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <BigButton label={right.label} primary onPress={right.onPress} disabled={busy || right.disabled} testID={right.testID} />
      </View>
    </Row>
  )

  return (
    <Stack>
      <Title>{title}</Title>
      <Body muted>{body}</Body>
      {sentTo === null ? (
        <>
          <Field
            label={PHONE_FIELD}
            value={phone}
            placeholder={PHONE_PLACEHOLDER}
            onChangeText={(text) => {
              setPhone(text)
              setError(null)
            }}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            onSubmitEditing={() => void sendCode()}
            testID="phone-input"
          />
          {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
          {pair(back, { label: PHONE_SEND, onPress: () => void sendCode(), disabled: phone.replace(/\D/g, '').length < 10, testID: 'phone-send' })}
        </>
      ) : (
        <>
          <Notice tone="info">{codeSentMessage(sentTo)}</Notice>
          <Field
            label={CODE_FIELD}
            value={code}
            onChangeText={(text) => {
              setCode(text.replace(/\D/g, '').slice(0, 6))
              setError(null)
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            onSubmitEditing={() => void confirm()}
            testID="code-input"
          />
          {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
          {busyText !== undefined && busyText !== null ? <Notice tone="info">{busyText}</Notice> : null}
          {pair({ label: CODE_RESEND, onPress: () => void sendCode() }, { label: CODE_CONFIRM, onPress: () => void confirm(), disabled: code.length !== 6, testID: 'code-confirm' })}
          {/* 단추를 위아래로 쌓지 않게 번호 바꾸기는 글 링크로 (CLAUDE.md 8) */}
          <Text
            role="link"
            onPress={() => {
              if (busy) return
              setSentTo(null)
              setCode('')
              setError(null)
            }}
            style={{ alignSelf: 'center', color: '#4E5968', fontSize: 15, textDecorationLine: 'underline', paddingVertical: 8 }}
          >
            {PHONE_CHANGE}
          </Text>
        </>
      )}
    </Stack>
  )
}
