// 리허설 조작판 (AC-S05-54, YT-09, D-082): 가짜 채팅 생성기 시작·멈춤·상태, "시청자로 보내기".
// 생성기와 시청자 채팅은 서버가 수집기 경로로 기록한다 — 화면은 채팅을 직접 쓰지 않는다. 실제 방송 콘솔에는 이 판이 없다.
import { useRef, useState, type FormEvent } from 'react'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { GeneratorStatus, WriteResult } from '../api/types.ts'
import { stopReasonWord } from '../lib/words.ts'
import { ErrorNote, FieldError } from './ErrorNote.tsx'

export interface RehearsalPanelProps {
  readonly broadcastId: string
  readonly generator: GeneratorStatus | null
  readonly onGenerator: (status: GeneratorStatus) => void
  readonly onWritten: (result: WriteResult) => void
}

export function RehearsalPanel({ broadcastId, generator, onGenerator, onWritten }: RehearsalPanelProps) {
  const [total, setTotal] = useState('300')
  const [perSecond, setPerSecond] = useState('1')
  const [seed, setSeed] = useState('')
  const [genError, setGenError] = useState<ApiError | null>(null)
  const [genBusy, setGenBusy] = useState(false)
  const [nick, setNick] = useState('')
  const [text, setText] = useState('')
  const [chatError, setChatError] = useState<ApiError | null>(null)
  const [chatBusy, setChatBusy] = useState(false)
  const chatRequest = useRef<{ key: string; requestId: string } | null>(null)
  const textField = useRef<HTMLInputElement>(null)

  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}/rehearsal`

  const toInt = (value: string): number | string => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : value)

  const start = async (event: FormEvent) => {
    event.preventDefault()
    if (genBusy) return
    setGenBusy(true)
    setGenError(null)
    try {
      const body = { total: toInt(total), perSecond: toInt(perSecond), ...(seed.trim() === '' ? {} : { seed: toInt(seed) }), requestId: newRequestId() }
      const { generator: status } = await post<{ generator: GeneratorStatus }>(`${base}/generator/start`, body)
      onGenerator(status)
    } catch (error) {
      if (!isApiError(error)) throw error
      setGenError(error)
    } finally {
      setGenBusy(false)
    }
  }

  const stop = async () => {
    if (genBusy) return
    setGenBusy(true)
    setGenError(null)
    try {
      const { generator: status } = await post<{ generator: GeneratorStatus }>(`${base}/generator/stop`, {})
      onGenerator(status)
    } catch (error) {
      if (!isApiError(error)) throw error
      setGenError(error)
    } finally {
      setGenBusy(false)
    }
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (chatBusy) return
    const key = JSON.stringify([nick, text])
    if (chatRequest.current?.key !== key) chatRequest.current = { key, requestId: newRequestId() }
    const requestId = chatRequest.current.requestId
    setChatBusy(true)
    setChatError(null)
    try {
      const result = await withRetry(() => post<WriteResult>(`${base}/chat`, { requestId, nick, text }))
      chatRequest.current = null
      setText('')
      onWritten(result)
      textField.current?.focus()
    } catch (error) {
      if (!isApiError(error)) throw error
      setChatError(error)
    } finally {
      setChatBusy(false)
    }
  }

  const running = generator?.running === true
  return (
    <section className="rehearsal card" aria-label="리허설 조작판">
      <h2 className="section-title">리허설 조작판</h2>
      <form className="stack-tight" onSubmit={(event) => void start(event)} aria-label="가짜 채팅">
        <div className="fix-fields">
          <label className="field">
            <span>총 개수</span>
            <input className="input" inputMode="numeric" value={total} onChange={(event) => setTotal(event.target.value)} />
          </label>
          <label className="field">
            <span>초당 속도</span>
            <input className="input" inputMode="numeric" value={perSecond} onChange={(event) => setPerSecond(event.target.value)} />
          </label>
          <label className="field">
            <span>시드(선택)</span>
            <input className="input" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} />
          </label>
        </div>
        <FieldError error={genError} field="total" />
        <FieldError error={genError} field="perSecond" />
        <FieldError error={genError} field="seed" />
        <div className="row">
          <button type="submit" className="button button-primary" disabled={genBusy || running}>
            가짜 채팅 시작
          </button>
          <button type="button" className="button" disabled={genBusy || !running} onClick={() => void stop()}>
            멈춤
          </button>
        </div>
        <p role="status" aria-label="가짜 채팅 상태">
          {generator === null
            ? '가짜 채팅을 아직 시작하지 않았어요.'
            : `보낸 수 ${String(generator.sent)} / ${String(generator.total)} · ${running ? '보내는 중' : stopReasonWord(generator.stopReason)}${
                generator.seed === null ? '' : ` · 시드 ${String(generator.seed)}`
              }${generator.failed > 0 ? ` · 저장 못 함 ${String(generator.failed)}` : ''}`}
        </p>
        {genError !== null ? <ErrorNote error={genError} omitFields={['total', 'perSecond', 'seed']} /> : null}
      </form>
      <form className="stack-tight" onSubmit={(event) => void send(event)} aria-label="시청자로 보내기">
        <h3 className="sub-title">시청자로 보내기</h3>
        <div className="fix-fields">
          <label className="field">
            <span>닉네임</span>
            <input className="input" value={nick} onChange={(event) => setNick(event.target.value)} />
          </label>
          <label className="field">
            <span>채팅 한 줄</span>
            <input ref={textField} className="input" value={text} onChange={(event) => setText(event.target.value)} />
          </label>
        </div>
        <FieldError error={chatError} field="nick" />
        <FieldError error={chatError} field="text" />
        <button type="submit" className="button" disabled={chatBusy}>
          시청자로 보내기
        </button>
        {chatError !== null ? <ErrorNote error={chatError} omitFields={['nick', 'text']} /> : null}
      </form>
    </section>
  )
}
