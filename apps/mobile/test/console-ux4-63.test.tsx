// 사용자 지시 2026-11-10 (D-UX4-63~67):
// - 감사 채팅 켜고 끌 때 위에 뜨던 결과 줄 없앰 · 이름 "자동 감사 채팅" · 이름 옆 ? — 누르면 꾸욱 눌리고 아래에서 설명 판(문장마다 줄 바꿈 + 예시 채팅 그림)
// - 라이브 아래 알약 셋이 누를 때마다 살짝 움직이던 것: 고른 알약만 테두리가 빠지고 글자가 굵어져 폭이 달라졌다
// - 채팅·문자: 꼬리표는 닉네임 오른쪽, "15번 취소됨 · 15번 취소 · 15번 찜 · 15번 대기 1" 꼴, 시각 칸 폭 고정
// - 들린 말 창: 부드럽게 펼치기, 지난 말 왼쪽에 들린 시각, 상태는 듣는 중(초록)·재연결 중(주황)·연결 끊김(빨강)
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MessagesView } from '@livejjim/web/src/api/types.ts'
import { THANKS_EXAMPLE, THANKS_HELP_BODY, THANKS_HELP_TITLE, THANKS_TITLE, ThanksSwitch } from '../src/screens/console/Manage.tsx'
import { Pill } from '../src/ui/day-pills.tsx'
import { chatClaimTag, chatResult, smsWord } from '../src/screens/console/LiveTalk.tsx'
import { DOCK_STATE, ListenLine, heardTime, listenChip } from '../src/screens/console/StreamAudio.tsx'
import type { ScopeData } from '../src/lib/scope-data.ts'
import type { VoiceSession, VoiceView } from '../src/lib/voice-session.ts'
import { claim } from './support.ts'

describe('자동 감사 채팅 (D-UX4-63·64)', () => {
  it('이름은 "자동 감사 채팅", 스위치는 따로 켜고 끈다', () => {
    const onPress = vi.fn()
    render(<ThanksSwitch on={false} busy={false} onPress={onPress} />)
    fireEvent.click(screen.getByRole('switch', { name: `${THANKS_TITLE} — 꺼짐` }))
    expect(onPress).toHaveBeenCalledWith(true)
    // 스위치를 눌러도 설명 판은 뜨지 않는다
    expect(screen.queryByRole('dialog', { name: THANKS_HELP_TITLE })).toBeNull()
  })

  it('이름 옆 ? 자리를 누르면 아래에서 설명 판 — 문장마다 줄 바꿈, 예시 채팅 그림, [확인]으로 닫는다', () => {
    const onPress = vi.fn()
    render(<ThanksSwitch on busy={false} onPress={onPress} />)
    fireEvent.click(screen.getByRole('button', { name: `${THANKS_TITLE} 설명 보기` }))
    const sheet = screen.getByRole('dialog', { name: THANKS_HELP_TITLE })
    expect(within(sheet).getByText(THANKS_HELP_TITLE)).toBeTruthy()
    // 한 문장에 한 줄
    const sentences = THANKS_HELP_BODY.split('\n')
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    for (const sentence of sentences) expect(sentence.trim().endsWith('요.')).toBe(true)
    expect(within(sheet).getByText((_, el) => el?.textContent === THANKS_HELP_BODY && el.children.length === 0)).toBeTruthy()
    // 예시: 손님이 번호만 치면 내 채널이 감사 인사
    const example = within(sheet).getByTestId('thanks-example')
    expect(example.textContent).toContain(`@${THANKS_EXAMPLE.buyer}`)
    expect(example.textContent).toContain(THANKS_EXAMPLE.thanks)
    expect(THANKS_EXAMPLE.thanks.startsWith(`${THANKS_EXAMPLE.order}번 `)).toBe(true)
    expect(THANKS_EXAMPLE.thanks.endsWith(`${THANKS_EXAMPLE.buyer}님 구매 감사합니다`)).toBe(true)
    expect(onPress).not.toHaveBeenCalled()
    fireEvent.click(within(sheet).getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('dialog', { name: THANKS_HELP_TITLE })).toBeNull()
  })
})

describe('알약은 골라도 크기가 같다 (D-UX4-65)', () => {
  it('고른 알약·안 고른 알약 모두 테두리 1, 글자 굵기 같음 — 고름은 색으로만', () => {
    render(
      <>
        <Pill on label="상품 3" ariaLabel="상품" onPress={() => {}} />
        <Pill on={false} label="찜 기록 2" ariaLabel="찜 기록" onPress={() => {}} />
      </>,
    )
    const look = (name: string, label: string) => {
      const pill = screen.getByRole('button', { name })
      return { border: getComputedStyle(pill).borderTopWidth, weight: within(pill).getByText(label).style.fontWeight }
    }
    const on = look('상품', '상품 3')
    const off = look('찜 기록', '찜 기록 2')
    expect(on.border).toBe('1px')
    expect(off.border).toBe('1px')
    expect(on.weight).toBe(off.weight)
  })
})

const NO_DATA = { claims: new Map(), products: new Map() } as unknown as ScopeData
const message = (patch: Partial<MessagesView['messages'][number]>): MessagesView['messages'][number] =>
  ({ id: 'm1', broadcast: 'b1', channel: 'ch1', nick: '꽃집언니', text: '15', owner: false, seq: 1, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z', ignored: false, order: false, cancel: false, orders: [], cancels: [], mentions: [], converted: [], claims: [], failed: false, ...patch }) as MessagesView['messages'][number]

describe('채팅·문자 꼬리표 (D-UX4-66)', () => {
  it('모두 "번호번 낱말" 꼴 — 찜 · 대기 n · 취소됨(찜이 취소됨) · 취소(취소 채팅)', () => {
    expect(chatClaimTag(NO_DATA, claim('c1', 137, 'u1')).word).toBe('137번 찜')
    expect(chatClaimTag(NO_DATA, claim('c1', 137, 'u1', { status: 'CANCELLED' })).word).toBe('137번 취소됨')
    const product = { waitlistClaims: ['c0', 'c2'] }
    const data = { claims: new Map(), products: new Map([['b1/137', product]]) } as unknown as ScopeData
    expect(chatClaimTag(data, claim('c2', 137, 'u2', { status: 'WAITLISTED' })).word).toBe('137번 대기 2')
    expect(chatResult(message({ cancel: true, cancels: [137] }), NO_DATA).map((tag) => tag.word)).toEqual(['137번 취소'])
    // 찜이 아직 없는 주문 채팅은 번호마다
    expect(chatResult(message({ order: true, orders: [15, 16] }), NO_DATA).map((tag) => tag.word)).toEqual(['15번 주문', '16번 주문'])
    // 문자 취소도 "15번 취소" (옛 "15번 취소 요청")
    expect(smsWord({ result: 'cancel', numbers: [15] }).map((tag) => tag.word)).toEqual(['15번 취소'])
  })
})

function fakeVoice(view: Partial<VoiceView>): VoiceSession {
  const full = { on: true, broadcastId: 'b1', state: { kind: 'listening' }, transcript: [], transcriptAt: [], ...view } as unknown as VoiceView
  return { subscribe: () => () => {}, getView: () => full } as unknown as VoiceSession
}
const voiceView = (view: Partial<VoiceView>) => fakeVoice(view).getView()

describe('들린 말 창 (D-UX4-67)', () => {
  it('상태는 세 가지: 듣는 중(초록) · 재연결 중(주황) · 연결 끊김(빨강)', () => {
    const off = voiceView({ on: false, broadcastId: null })
    expect(listenChip(off, 'b1', { phase: 'listening' })).toEqual({ word: DOCK_STATE.on, tone: 'on' })
    expect(listenChip(off, 'b1', { phase: 'reconnecting' })).toEqual({ word: DOCK_STATE.reconnecting, tone: 'warn' })
    expect(listenChip(off, 'b1', { phase: 'idle' })).toEqual({ word: DOCK_STATE.reconnecting, tone: 'warn' })
    expect(listenChip(off, 'b1', { phase: 'stopped' })).toEqual({ word: DOCK_STATE.lost, tone: 'off' })
    expect(listenChip(off, 'b1', null)).toEqual({ word: DOCK_STATE.lost, tone: 'off' })
    // 휴대폰 마이크
    expect(listenChip(voiceView({ state: { kind: 'listening' } as VoiceView['state'] }), 'b1', null).word).toBe(DOCK_STATE.on)
    expect(listenChip(voiceView({ state: { kind: 'reconnecting' } as unknown as VoiceView['state'] }), 'b1', null).word).toBe(DOCK_STATE.reconnecting)
    expect(listenChip(voiceView({ state: { kind: 'stopped' } as unknown as VoiceView['state'] }), 'b1', null).word).toBe(DOCK_STATE.lost)
  })

  it('펼치면 지난 말마다 왼쪽에 들린 시각(한국 시각)', () => {
    const base = Date.parse('2026-10-29T12:07:33.000Z') // 21:07:33 KST
    const lines = ['첫 말', '둘째 말', '지금 말']
    render(<ListenLine session={fakeVoice({ transcript: lines, transcriptAt: [base, base + 5000, base + 9000] })} broadcastId="b1" stream={{ status: null, hold: false, retry: () => {} }} bottom={0} />)
    const dock = screen.getByRole('region', { name: '들린 말 창' })
    fireEvent.click(within(dock).getByRole('button', { name: '들린 말 펼치기' }))
    const rows = within(dock).getAllByTestId('heard-row')
    expect(rows.map((row) => row.textContent)).toEqual(['21:07:33첫 말', '21:07:38둘째 말'])
    expect(heardTime(base)).toBe('21:07:33')
  })
})
