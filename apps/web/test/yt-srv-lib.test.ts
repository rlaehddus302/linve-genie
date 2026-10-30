// YT-SRV 화면 판단 (YT-11 AC2·AC5·AC6, D-YT-SRV-03·06·07): 막힘·형식 변경은 바로 경고, 처음 잇는 채널 확인 줄, 이은 줄.
import { describe, expect, it } from 'vitest'
import type { CollectorView } from '../src/api/types.ts'
import { RESUMED_MESSAGE, collectorWarning, firstChannelQuestion, webLinkLine } from '../src/lib/youtube.ts'

const collector = (patch: Partial<CollectorView>): CollectorView => ({
  status: 'LIVE',
  statusMessage: '채팅을 받는 중',
  reason: null,
  reasonMessage: null,
  mode: 'WEB',
  lastMessageAt: null,
  recorded: 0,
  skippedBeforeLink: 0,
  gap: false,
  gapMessage: null,
  restartable: false,
  ...patch,
})

const BLOCKED = '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.'
const FORMAT = '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.'
const OFF = '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'

describe('막힘·형식 변경·운영자 끔 경고 (YT-11 AC5·AC6)', () => {
  it('막힘·모르는 모양은 10초를 기다리지 않고 바로, 서버 문장 그대로 한 줄', () => {
    expect(collectorWarning(collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'BLOCKED', reasonMessage: BLOCKED }), false)?.message).toBe(BLOCKED)
    expect(collectorWarning(collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'FORMAT', reasonMessage: FORMAT }), false)?.message).toBe(FORMAT)
  })

  it('연결 오류는 그대로 10초 넘게 이어질 때만', () => {
    const network = collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'NETWORK', reasonMessage: '연결이 끊겼어요' })
    expect(collectorWarning(network, false)).toBeNull()
    expect(collectorWarning(network, true)?.message).toBe('유튜브 채팅을 받지 못하고 있어요 — 연결이 끊겼어요')
  })

  it('운영자 끔(STOPPED·OPERATOR_OFF)은 바로, 다시 받기 버튼 없음', () => {
    expect(collectorWarning(collector({ status: 'STOPPED', statusMessage: '멈춤', reason: 'OPERATOR_OFF', reasonMessage: OFF, restartable: false }), false)).toEqual({ message: OFF, reconnect: false, restartable: false })
  })

  it('다시 받는 줄', () => {
    expect(RESUMED_MESSAGE).toBe('유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.')
  })
})

describe('서버 잇기 줄 (YT-02 서버 잇기, D-YT-SRV-03)', () => {
  it('처음 잇는 채널 확인 줄·이은 줄 — 채널 이름은 글자 그대로', () => {
    expect(firstChannelQuestion('처음 채널')).toBe('처음 잇는 채널이에요 (채널: 처음 채널). 이 방송이 맞나요?')
    expect(webLinkLine('<img src=x onerror=alert(1)>')).toBe('유튜브 방송 · <img src=x onerror=alert(1)>')
  })
})
