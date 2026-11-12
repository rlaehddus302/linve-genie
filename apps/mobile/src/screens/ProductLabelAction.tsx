import { useRef, useState } from 'react'
import { View } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { isApiError, newRequestId, post, withRetry } from '../api/client.ts'
import { BigButton, ErrorLine, Txt } from '../ui/kit/index.ts'

export type LabelEdits = { no?: number; name?: string; price?: number; nickname?: string }

export function ProductLabelAction({ label, edits, title, disabled = false }: { label: LabelView; edits?: LabelEdits; title: string; disabled?: boolean }) {
  if (!label.canReprint && !label.canPrint) return label.word ? <Txt color="textSub">{label.word}</Txt> : null
  const action = label.canReprint ? 'reprint' : 'print'
  const body = { b: label.broadcast, claim: label.claim, ...(label.canReprint ? { version: label.version, ...(edits ? { edits } : {}) } : {}) }
  return <QueueLabelButton action={action} body={body} title={title} disabled={disabled} />
}

export function QueueLabelButton({ action, body, title, disabled, onQueued }: { onQueued?: () => void; action: 'direct' | 'reprint' | 'print'; body: Record<string, unknown>; title: string; disabled: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')
  const locked = useRef(false)
  const retry = useRef<{ input: string; id: string } | null>(null)
  const send = async () => {
    if (locked.current || disabled) return
    locked.current = true
    setState('busy')
    setError('')
    try {
      const input = JSON.stringify([action, body])
      if (retry.current?.input !== input) retry.current = { input, id: newRequestId() }
      const requestId = retry.current.id
      await withRetry(() => post('/api/print/labels/' + action, { ...body, requestId }))
      setState('done')
    } catch (caught) {
      setState('idle')
      locked.current = false
      setError(isApiError(caught) ? caught.message : '라벨을 대기열에 넣지 못했어요. 다시 눌러 주세요.')
    }
  }
  if (state === 'done') return <View><Txt role="status">출력 대기열에 넣었어요.</Txt>{onQueued ? <BigButton label="한 장 더 준비" kind="outline" onPress={onQueued} /> : null}</View>
  return <View><BigButton label={title} kind="secondary" busy={state === 'busy'} disabled={disabled} onPress={() => void send()} />{error ? <ErrorLine>{error}</ErrorLine> : null}</View>
}
