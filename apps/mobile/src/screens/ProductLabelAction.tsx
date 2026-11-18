import { useRef, useState } from 'react'
import { View } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { isApiError, newRequestId, post, withRetry } from '../api/client.ts'
import { BigButton, ErrorLine, Txt } from '../ui/kit/index.ts'
import { IconMenuRow } from './console/parts.tsx'

import type { LabelEdits } from '../lib/label-fix.ts'

export type { LabelEdits }

/**
 * 상품 자세히의 1등 라벨 줄 (D-LBLROW-01, 사용자 지시 2026-11-18 "다른 버튼이랑 디자인 통일 · 누르면 팝업 닫히고 자동으로 출력 큐에"):
 * 메뉴 줄과 같은 아이콘 줄 "🏷️ 손님 · 라벨 인쇄". 누르면 대기열에 넣고(같은 요청 번호로 다시 보내도 한 장) 넣었으면 onQueued(판 닫기),
 * 못 넣었으면 onError(판에 오류 한 줄 — 판은 열어 둔다). 뽑을 수 없는 라벨은 그 낱말만.
 */
export function ProductLabelRow({ label, edits, title, onQueued, onError }: { label: LabelView; edits?: LabelEdits; title: string; onQueued: () => void; onError: (message: string | null) => void }) {
  const queue = useQueueLabel()
  if (!label.canReprint && !label.canPrint) return label.word ? <Txt color="textSub">{label.word}</Txt> : null
  const action = label.canReprint ? 'reprint' : 'print'
  const body = { b: label.broadcast, claim: label.claim, ...(label.canReprint ? { version: label.version, ...(edits ? { edits } : {}) } : {}) }
  const press = () => {
    onError(null)
    void queue.send(action, body).then((error) => {
      if (error === null) onQueued()
      else onError(error)
    })
  }
  return <IconMenuRow emoji="🏷️" tint="#EAF1F7" title={queue.busy ? LABEL_QUEUING : title} ariaLabel={title} onPress={press} />
}

const LABEL_QUEUING = '라벨 넣는 중…'
const QUEUE_FAILED = '라벨을 대기열에 넣지 못했어요. 다시 눌러 주세요.'

/** 라벨을 대기열에 넣기 — 넣는 중엔 다시 보내지 않고, 같은 내용을 다시 보내면 같은 요청 번호. 답: 오류 문구 또는 null(넣었다) */
function useQueueLabel() {
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const retry = useRef<{ input: string; id: string } | null>(null)
  const send = async (action: 'direct' | 'reprint' | 'print', body: Record<string, unknown>): Promise<string | null> => {
    if (locked.current) return null
    locked.current = true
    setBusy(true)
    try {
      const input = JSON.stringify([action, body])
      if (retry.current?.input !== input) retry.current = { input, id: newRequestId() }
      const requestId = retry.current.id
      await withRetry(() => post('/api/print/labels/' + action, { ...body, requestId }))
      retry.current = null
      return null
    } catch (caught) {
      return isApiError(caught) ? caught.message : QUEUE_FAILED
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return { busy, send }
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
