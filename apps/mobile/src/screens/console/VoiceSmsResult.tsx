import { useContext, useEffect, useRef, useState } from 'react'
import type { SmsResultLine } from '@livejjim/web/src/voice/model.ts'
import { isApiError, newRequestId } from '../../api/client.ts'
import { claimWord } from '../../lib/derive.ts'
import { BigButton, Body, Field, Hint, Notice, Row } from '../../ui/parts.tsx'
import { ConsoleContext } from './context.ts'

/** HTTP 결과 seq를 현재 찜에 연결한다. 실제 찜이 없으면 성공 찜으로 꾸미지 않는다. */
export function VoiceSmsResult({ line }: { readonly line: SmsResultLine }) {
  const api = useContext(ConsoleContext)
  const [ask, setAsk] = useState(false)
  const [reason, setReason] = useState('')
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (api === null) return <Body>{`${line.no}번 문자찜을 보냈어요. 현재 상태를 확인해 주세요.`}</Body>
  const claim = [...api.data.claims.values()].find((item) => item.seq === line.seq && item.origin === 'sms')
  const caught = api.data.seq >= line.seq
  const active = claim !== undefined && ['CONFIRMED', 'WAITLISTED', 'CONFLICT', 'PENDING'].includes(claim.status)
  const body = !caught ? `${line.no}번 · 넣었어요 · 상태 확인 중…` : claim === undefined ? `${line.no}번 · 새 찜이 생기지 않았어요. 지금 상태를 확인해 주세요.` : `${line.no}번 · ${api.names.name(claim.currentBuyer)} · ${claimWord(api.data, claim)}`
  const schedule = (): void => {
    if (!claim || reason.trim() === '') return
    const requestId = newRequestId()
    const event = { type: 'host.cancel', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, ...(claim.options === null || claim.options.length === 0 ? {} : { options: Object.fromEntries(claim.options.map(([name, label]) => [name, label])) }), reason: reason.trim() }
    setAsk(false); setPhase('waiting'); setError(null)
    timer.current = setTimeout(() => {
      setPhase('sending')
      api.command(event, requestId).then(() => setPhase('done'), (caught: unknown) => { setPhase('idle'); setError(isApiError(caught) ? caught.message : '찜 취소를 보내지 못했어요. 다시 확인해 주세요.') })
    }, 5000)
  }
  return <>
    <Body>{body}</Body>
    {error ? <Notice tone="danger" alert>{error}</Notice> : null}
    {ask ? <><Field label="찜 취소 사유" value={reason} onChangeText={setReason} /><Row><BigButton label="취소 요청 보내기" disabled={reason.trim() === ''} onPress={schedule} /><BigButton label="안 바꾸기" onPress={() => setAsk(false)} /></Row></> : null}
    {phase === 'waiting' ? <><Hint>5초 뒤 찜 취소를 보내요.</Hint><BigButton label="찜 취소 되돌리기" onPress={() => { clearTimeout(timer.current); setPhase('idle') }} /></> : null}
    {phase === 'sending' ? <Hint>찜 취소를 보내는 중…</Hint> : null}
    {phase === 'done' ? <Hint>찜 취소 요청을 보냈어요.</Hint> : null}
    {!ask && phase === 'idle' && active && !api.sealed && !api.ended ? <BigButton label="찜 취소하기" ariaLabel={`${line.no}번 문자찜 찜 취소하기`} onPress={() => setAsk(true)} /> : null}
  </>
}
