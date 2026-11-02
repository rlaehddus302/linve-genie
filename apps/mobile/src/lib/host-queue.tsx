// 방송자 조치 5초 대기·되돌리기 (D-083 — 웹 host-delay·UndoBar와 같은 규칙·문구, D-APPX-03). 확인 필요·구매자·방송 화면이 같이 쓴다.
// 대기 시간은 서버 /api/client-config(운영 5초), 못 읽으면 운영 값. 화면이 내려가면 기다리던 조치는 보내지 않는다.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { HOST_ACTION_DELAY_MS, UndoQueue, type UndoItem } from '@livejjim/web/src/lib/undo-queue.ts'
import { get, newRequestId } from '../api/client.ts'
import { BigButton, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'

export const NOT_APPLIED_MESSAGE = '적용되지 않았어요. 지금 상태를 확인해 주세요.'
export const NO_ITEMS: readonly UndoItem[] = []

/** 대기 시간 글자: 5000 → "5초", 300 → "0.3초" */
export function secondsWord(ms: number): string {
  const seconds = Math.round(ms / 100) / 10
  return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)}초`
}

/** 화면이 열린 동안의 되돌리기 목록 (대기 시간은 서버 설정 — 못 읽으면 운영 5초). 화면이 내려가면 기다리던 조치는 보내지 않는다 */
export function useUndoQueue(): UndoQueue | null {
  const [queue, setQueue] = useState<UndoQueue | null>(null)
  useEffect(() => {
    let alive = true
    let made: UndoQueue | null = null
    const start = (delayMs: number) => {
      if (!alive) return
      made = new UndoQueue({ delayMs, requestId: newRequestId })
      setQueue(made)
    }
    get<{ hostActionDelayMs: number }>('/api/client-config').then(
      (config) => start(Number.isFinite(config.hostActionDelayMs) && config.hostActionDelayMs >= 0 ? config.hostActionDelayMs : HOST_ACTION_DELAY_MS),
      () => start(HOST_ACTION_DELAY_MS),
    )
    return () => {
      alive = false
      made?.cancelAll()
    }
  }, [])
  return queue
}

export const waitingCount = (items: readonly UndoItem[]): number => items.filter((item) => item.kind === 'action' && (item.status === 'waiting' || item.status === 'sending' || item.status === 'retrying')).length


export const noSubscribe = () => () => undefined
export const noItems = (): readonly UndoItem[] => NO_ITEMS

/** 되돌리기 띠 (웹 UndoBar와 같은 문장): 기다림 → 되돌리기, 보내는 중, 보냄, 적용 안 됨, 보내지 않음, 실패 → 다시 보내기 */
export function UndoStrip({ items, queue }: { readonly items: readonly UndoItem[]; readonly queue: UndoQueue }) {
  const shown = items.filter((item) => item.kind === 'action')
  if (shown.length === 0) return null
  return (
    <View style={{ gap: SPACE.xs }} aria-label="보내기 전·보낸 것" role="region">
      {shown.map((item) => {
        if (item.kind !== 'action') return null
        switch (item.status) {
          case 'waiting':
            return (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <View style={{ flex: 1 }}>
                  <Txt>{`${secondsWord(queue.delayMs)} 뒤 보내요: ${item.label}`}</Txt>
                </View>
                <BigButton kind="outline" label="되돌리기" ariaLabel={`${item.label} 되돌리기`} onPress={() => queue.undo(item.id)} />
              </View>
            )
          case 'sending':
          case 'retrying':
            return <Txt key={item.id} color="textSub">{`보내는 중…: ${item.label}`}</Txt>
          case 'done':
          case 'outcome':
            return <Notice key={item.id} tone="success">{`보냈어요: ${item.label}`}</Notice>
          case 'notApplied':
            return (
              <View key={item.id} style={{ gap: SPACE.xs }}>
                <Notice tone="warning">{`${item.label} — ${NOT_APPLIED_MESSAGE}`}</Notice>
                <BigButton kind="secondary" label="확인" onPress={() => queue.dismiss(item.id)} />
              </View>
            )
          case 'cancelled':
            return <Txt key={item.id} color="textSub">{`보내지 않았어요: ${item.label}`}</Txt>
          case 'failed':
            return (
              <View key={item.id} style={{ gap: SPACE.xs }}>
                <Notice tone="danger" alert>{`${item.label} — ${item.error?.message ?? '보내지 못했어요.'}${item.error?.problems.map((problem) => ` ${problem.message}`).join('') ?? ''}`}</Notice>
                <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                  {item.error?.transient === true ? <BigButton kind="outline" label="다시 보내기" onPress={() => queue.resend(item.id)} /> : null}
                  <BigButton kind="secondary" label="확인" onPress={() => queue.dismiss(item.id)} />
                </View>
              </View>
            )
        }
      })}
    </View>
  )
}

