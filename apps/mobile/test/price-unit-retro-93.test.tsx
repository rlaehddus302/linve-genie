// 가격을 말할 때 단위 (11월 12일 라이브 복기 6.4 "305번", 개선 계획표 A6, D-RETRO-84 · 화면은 D-RETRO-93):
// 가게 설정 "판매 규칙"에서 단위 없이 말한 가격을 만 원·천 원·원 가운데 무엇으로 읽을지 고른다 — 쉬운 낱말, 말한 예, 언제 적용되는지 한 줄.
// 함께: 방송 화면 음성 안내 카드의 단추 차례 (D-UX4-01 — 부정 왼쪽, 긍정 오른쪽).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DEFAULT_SETTINGS, PRICE_UNITS } from '@livejjim/core/settings'
import { describe, expect, it } from 'vitest'
import { LISTEN_CONSENT_NO, LISTEN_CONSENT_YES } from '../src/lib/listen-source.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ShopSettingsScreen } from '../src/screens/ShopSettingsScreen.tsx'
import { PRICE_UNIT_CHOICES, PRICE_UNIT_LABEL, PRICE_UNIT_SPOKEN, PRICE_UNIT_WHEN, priceUnitExample } from '../src/screens/settings/PriceUnit.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

function settingsWorld() {
  const w = makeWorld()
  const writes: (Record<string, unknown> | null)[] = []
  w.server.on('GET', /^\/api\/shop$/, () => ({ body: { shop: { name: '초록가게', bank: '', accountNumber: '', accountHolder: '', accountNote: '' } } }))
  w.server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: DEFAULT_SETTINGS } }))
  w.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
  w.server.on('GET', /^\/api\/parcels\/settings$/, () => ({ body: { settings: { carrier: null, carrierName: null, carriers: [{ code: 'EPOST', name: '우체국택배', autoBook: false }], customerNoLast4: null, sender: null, shopName: '초록가게', box: '60', boxes: ['60', '80'] } } }))
  w.server.on('GET', /^\/api\/customer-settings$/, () => ({ body: { settings: { regularCount: 3, regularAmount: null, waitDays: 3 } } }))
  w.server.on('GET', /^\/api\/ledger-settings$/, () => ({ body: { settings: { months: 12, consoleBadges: false } } }))
  w.server.on('GET', /^\/api\/assist\/settings$/, () => ({ body: { available: false, enabled: false, consentedAt: null, usedToday: 0, dailyLimit: 50 } }))
  w.server.on('GET', /^\/api\/backups$/, () => ({ body: { enabled: true, retentionDays: 14, lastSuccessAt: new Date().toISOString(), backups: [] } }))
  w.server.on('PATCH', /^\/api\/settings$/, (call) => {
    writes.push(call.body)
    return { body: { settings: { ...DEFAULT_SETTINGS, ...((call.body?.['settings'] ?? {}) as Record<string, unknown>) } } }
  })
  return { w, writes }
}

describe('가격을 말할 때 단위 (D-RETRO-93, 개선 계획표 A6)', () => {
  it('엔진이 받는 단위를 모두 고를 수 있고 낱말은 쉬운 한국어 — 영어 값이 화면 글에 없다', () => {
    expect([...PRICE_UNIT_CHOICES.map((choice) => choice.value)].sort()).toEqual([...PRICE_UNITS].sort())
    expect(PRICE_UNIT_CHOICES.map((choice) => choice.word)).toEqual(['만 원', '천 원', '원 그대로', '자동'])
    for (const choice of PRICE_UNIT_CHOICES) expect(`${choice.word} ${choice.example}`, choice.value).not.toMatch(/[A-Z_]{3,}/)
    expect(priceUnitExample('TEN_THOUSAND')).toBe("'삼십오'라고 하면 350,000원")
    expect(priceUnitExample('THOUSAND')).toBe("'삼십오'라고 하면 35,000원")
    expect(priceUnitExample('모르는 값')).toBeNull()
  })

  it('가게 설정 판매 규칙에 "가격을 말할 때 단위" — 알약이 한 줄에 좌우로, 고른 단위의 예와 언제 적용되는지 한 줄', async () => {
    const { w } = settingsWorld()
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    const group = await screen.findByRole('radiogroup', { name: PRICE_UNIT_LABEL })
    expect(PRICE_UNIT_LABEL).toBe('가격을 말할 때 단위')
    const pills = within(group).getAllByRole('button')
    expect(pills.map((pill) => pill.textContent)).toEqual(['만 원', '천 원', '원 그대로', '자동'])
    for (const pill of pills) expect(pill.parentElement).toBe(pills[0]!.parentElement)
    expect(getComputedStyle(pills[0]!.parentElement!).flexDirection).toBe('row')
    // 기본값은 천 원
    expect(within(group).getByRole('button', { name: `${PRICE_UNIT_LABEL} 천 원` }).getAttribute('aria-selected')).toBe('true')
    expect(within(group).getByText("'삼십오'라고 하면 35,000원")).toBeTruthy()
    expect(within(group).getByText(PRICE_UNIT_SPOKEN)).toBeTruthy()
    expect(within(group).getByText(PRICE_UNIT_WHEN)).toBeTruthy()
    expect(PRICE_UNIT_WHEN).toBe('다음에 시작하는 라이브부터 적용돼요. 지금 하는 라이브는 그대로예요.')
    // 옛 "가격 단위" 고르기는 이 칸으로 바뀌었다 — 같은 설정이 두 번 보이지 않는다
    expect(screen.queryByRole('radiogroup', { name: '가격 단위' })).toBeNull()
  })

  it('[만 원]을 고르면 예가 바뀌고, 저장하면 price.unit만 보낸다', async () => {
    const { w, writes } = settingsWorld()
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    const group = await screen.findByRole('radiogroup', { name: PRICE_UNIT_LABEL })
    fireEvent.click(within(group).getByRole('button', { name: `${PRICE_UNIT_LABEL} 만 원` }))
    expect(within(group).getByText("'삼십오'라고 하면 350,000원")).toBeTruthy()
    expect(within(group).queryByText("'삼십오'라고 하면 35,000원")).toBeNull()
    expect(screen.getByText('저장하지 않은 칸: 판매 규칙')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({ settings: { 'price.unit': 'TEN_THOUSAND' } })
    await waitFor(() => expect(within(group).getByRole('button', { name: `${PRICE_UNIT_LABEL} 만 원` }).getAttribute('aria-selected')).toBe('true'))
  })
})

describe('음성 안내 카드의 단추 차례 (D-UX4-01, 절대 규칙 8)', () => {
  it('왼쪽 [안 켤래요] · 오른쪽 [알겠어요, 켤게요] 한 줄 — 옛: 긍정이 왼쪽이었다', async () => {
    const world = makeWorld({ products: [] })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    act(() => {
      void world.services.voice.turnOn('b1', '저녁 방송')
    })
    const dialog = await screen.findByRole('dialog', { name: '음성 안내' })
    const buttons = within(dialog).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([LISTEN_CONSENT_NO, LISTEN_CONSENT_YES])
    expect(buttons.map((button) => button.textContent)).toEqual(['안 켤래요', '알겠어요, 켤게요'])
    const row = buttons[0]!.parentElement?.parentElement
    expect(buttons[1]!.parentElement?.parentElement).toBe(row)
    expect(getComputedStyle(row!).flexDirection).toBe('row')
    expect(getComputedStyle(row!).flexWrap).not.toBe('wrap')
    // [안 켤래요]면 켜지 않는다
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '음성 안내' })).toBeNull())
    expect(world.audio.starts.length).toBe(0)
  })
})
