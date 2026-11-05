// 휴대폰 번호 확인 판 (D-UX3-30, 앱 PhoneVerify와 같은 문장): 번호 → [인증번호 받기] → 6자리 → [확인].
// 가입 중(가입 표 쿠키)과 로그인한 계정(번호 등록)이 같이 쓴다. 단추는 좌우로(부정 왼쪽·긍정 오른쪽 — CLAUDE.md 8).
import { useState, type FormEvent } from 'react'
import { isApiError } from '../api/client.ts'
import { CODE_CONFIRM, CODE_FIELD, CODE_RESEND, codeSentMessage, PHONE_CHANGE, PHONE_FIELD, PHONE_PLACEHOLDER, PHONE_SEND, START_FAILED } from '../lib/social-login.ts'

export function PhoneVerify({
  title,
  body,
  send,
  verify,
  back,
  busyText = null,
}: {
  readonly title: string
  readonly body: string
  readonly send: (phone: string) => Promise<string>
  readonly verify: (code: string) => Promise<void>
  readonly back?: { readonly label: string; readonly onPress: () => void }
  readonly busyText?: string | null
}) {
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
      setError(isApiError(caught) && !caught.network ? caught.message : START_FAILED)
    } finally {
      setBusy(false)
    }
  }
  const sendCode = () =>
    run(async () => {
      setSentTo(await send(phone))
      setCode('')
    })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (sentTo === null) void sendCode()
    else void run(() => verify(code))
  }

  return (
    <form className="stack phone-verify" onSubmit={submit}>
      <h2>{title}</h2>
      <p>{body}</p>
      {sentTo === null ? (
        <label className="field">
          <span>{PHONE_FIELD}</span>
          <input className="input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={PHONE_PLACEHOLDER} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
      ) : (
        <>
          <p className="notice" role="status">
            {codeSentMessage(sentTo)}
          </p>
          <label className="field">
            <span>{CODE_FIELD}</span>
            <input
              className="input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
        </>
      )}
      {error !== null ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {busyText !== null ? (
        <p className="notice" role="status">
          {busyText}
        </p>
      ) : null}
      <div className="row phone-buttons">
        {sentTo === null ? (
          back !== undefined ? (
            <button type="button" className="button" disabled={busy} onClick={back.onPress}>
              {back.label}
            </button>
          ) : null
        ) : (
          <button type="button" className="button" disabled={busy} onClick={() => void sendCode()}>
            {CODE_RESEND}
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={busy || (sentTo === null ? phone.replace(/\D/g, '').length < 10 : code.length !== 6)}>
          {sentTo === null ? PHONE_SEND : CODE_CONFIRM}
        </button>
      </div>
      {sentTo !== null ? (
        <p>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setSentTo(null)
              setCode('')
              setError(null)
            }}
          >
            {PHONE_CHANGE}
          </button>
        </p>
      ) : null}
    </form>
  )
}
