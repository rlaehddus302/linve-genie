// 문자찜 입력 화면 (AC-S06-10~15·81·82, ORD-08, D-089). 실제 코어로 도는 가짜 서버.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { SmsPage } from '../src/components/SmsPage.tsx'
import { chat, register, sms } from './engine.ts'
import { EngineServer, PHONE_SENTENCE } from './engine-server.ts'
import { DATE, FakeEventSource, apiError, flush } from './support.ts'

let engine: EngineServer

function setup(events: Record<string, unknown>[] = [], options: ConstructorParameters<typeof EngineServer>[1] = {}) {
  engine = new EngineServer(events, options)
  vi.stubGlobal('fetch', engine.server.fetch)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

async function open() {
  const utils = render(<SmsPage navigate={() => {}} />)
  await flush(10)
  return utils
}

const numberField = () => screen.getByLabelText('번호') as HTMLInputElement
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } })

describe('방송 고르기 (AC-S06-10)', () => {
  it('끝나지 않은 실제 방송 중 가장 최근 것(같은 날이면 나중에 만든 것)이 골라져 있고 번호 칸에 포커스', async () => {
    setup()
    await open()
    const chosen = screen.getByRole('region', { name: '고른 방송' })
    // 연도·요일까지 (AC-S06b-22)
    expect(chosen.textContent).toContain('2부 · 2026년 10월 19일(월)')
    expect(chosen.textContent).toContain('진행 중')
    await waitFor(() => expect(document.activeElement).toBe(numberField()))
  })

  it('끝나지 않은 실제 방송이 없으면 고른 방송이 없고 보낼 수 없다 → "방송 고르기"에서 끝난 방송도 고른다', async () => {
    setup([], { ended: ['b1', 'b2'] })
    await open()
    expect(screen.getByText('문자찜을 넣을 방송을 골라 주세요.')).toBeDefined()
    expect((screen.getByRole('button', { name: '문자찜 넣기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '방송 고르기' }))
    const dialog = await screen.findByRole('dialog', { name: '방송 고르기' })
    const choices = within(dialog).getAllByRole('button').filter((button) => button.textContent?.includes('부'))
    expect(choices.map((button) => button.textContent)).toEqual(['2부 · 2026년 10월 19일(월)끝남', '1부 · 2026년 10월 19일(월)끝남'])
    expect(choices.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
    fireEvent.click(choices[1] as HTMLElement)
    await flush(10)
    expect(screen.getByRole('region', { name: '고른 방송' }).textContent).toContain('1부 · 2026년 10월 19일(월)')
    await waitFor(() => expect(document.activeElement).toBe(numberField()))
  })
})

describe('번호·미리 보기·칸 확인 (AC-S06-11·12·13)', () => {
  it('번호는 숫자만, 범위 밖이면 문장, 치는 동안 그 방송의 그 번호 상품 (네 가지)', async () => {
    setup([
      register(15, '핑크프릴', 10000, 'b2'),
      chat('m1', 'UC_hong1234', '홍길동', '15', 'b2'),
      chat('m2', 'UC_kim5555', '김철수', '15', 'b2'),
      register(16, '청보석', 20000, 'b2'),
      { type: 'product.hold', b: 'b2', no: 16 },
      { type: 'product.register', b: 'b2', no: 17, name: '금황', price: 5000, status: 'READY' },
    ])
    await open()
    type(numberField(), '1a5')
    expect(numberField().value).toBe('15')
    expect(screen.getByRole('status', { name: '번호의 상품' }).textContent).toBe('15번 핑크프릴 10,000원 · 판매 완료 · 1등 홍길동 · 대기 1')
    expect(screen.getByRole('button', { name: '15번에 문자찜 넣기' })).toBeDefined()
    type(numberField(), '16')
    expect(screen.getByRole('status', { name: '번호의 상품' }).textContent).toContain('지금 판매 중이 아니라 넣으면 거절돼요.')
    type(numberField(), '17')
    expect(screen.getByRole('status', { name: '번호의 상품' }).textContent).toContain('공개 전 상품이라 넣으면 보류 찜이 돼요.')
    type(numberField(), '20')
    expect(screen.getByRole('status', { name: '번호의 상품' }).textContent).toBe('20번 상품이 아직 없어요. 넣으면 보류 찜이 되고, 30초 안에 등록되면 판정돼요.')
    type(numberField(), '1000')
    expect(screen.getByText('번호는 1~999 사이로 적어 주세요.')).toBeDefined()
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush()
    expect(engine.posts).toHaveLength(0)
  })

  it('미리 보기는 다른 기기의 등록·판정을 따른다 (알림 → 증분)', async () => {
    setup()
    await open()
    type(numberField(), '15')
    expect(screen.getByRole('status', { name: '번호의 상품' }).textContent).toContain('15번 상품이 아직 없어요.')
    act(() => engine.write(register(15, '핑크프릴', 10000, 'b2')))
    await flush(10)
    expect(screen.getByRole('status', { name: '번호의 상품' }).textContent).toContain('15번 핑크프릴 10,000원 · 판매 중')
  })

  it('받은 시각: 읽은 값과 날짜를 바로 보이고, 읽지 못하면 보내지 않는다', async () => {
    setup()
    await open()
    expect(screen.getByText('비우면 지금 시각(초까지)으로 넣어요')).toBeDefined()
    type(field('받은 시각'), '2001')
    expect(screen.getByText(/^(어제|오늘|내일) 20:01에 받은 문자$/)).toBeDefined()
    type(field('받은 시각'), '25:00')
    expect(screen.getByText('받은 시각을 20:01처럼 적어 주세요.')).toBeDefined()
    type(numberField(), '15')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush()
    expect(engine.posts).toHaveLength(0)
  })

  it('전화번호: 읽히면 "뒤 4자리 5678로 이어져요", 읽히지 않으면 막는다. 메모의 휴대폰 번호도 막는다', async () => {
    setup()
    await open()
    type(numberField(), '15')
    type(field('전화번호'), '010-1234-5678')
    expect(screen.getByText('뒤 4자리 5678로 이어져요')).toBeDefined()
    for (const bad of ['1234', '+82 10-1234-5678', '010-12']) {
      type(field('전화번호'), bad)
      expect(screen.getByText('휴대폰 번호로 읽지 못했어요. 고치거나 지워 주세요.')).toBeDefined()
    }
    fireEvent.submit(numberField().form as HTMLFormElement)
    type(field('전화번호'), '')
    type(field('메모'), '김씨 010-9999-8888')
    expect(screen.getByText(PHONE_SENTENCE)).toBeDefined()
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush()
    expect(engine.posts).toHaveLength(0)
  })

  it('구매자 표시 이름 미리 보기: "문자찜", 메모가 있으면 "문자찜(김씨)", 유튜브 구매자를 고르면 그 닉네임(메모가 바꾸지 않는다)', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '안녕하세요', 'b2')])
    await open()
    const preview = () => screen.getByLabelText('구매자 표시 이름').textContent
    expect(preview()).toBe('구매자 표시: 문자찜')
    type(field('메모'), '김씨')
    expect(preview()).toBe('구매자 표시: 문자찜(김씨)')
    type(field('구매자 고르기'), '1234')
    fireEvent.click(within(screen.getByRole('list', { name: '찾은 구매자' })).getByRole('button'))
    expect(preview()).toBe('구매자 표시: 홍길동')
    expect(field('전화번호').disabled).toBe(true)
    expect(screen.getByText('구매자를 골랐으면 전화번호는 쓰지 않아요')).toBeDefined()
  })
})

describe('보내기·결과·같은 사람 하나 더 (AC-S06-14·81)', () => {
  it('바로 보내고(요청 번호), 결과 카드는 그 찜의 지금 상태, 칸을 모두 비우고 번호 칸으로 — 전화번호 원문은 남지 않는다', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '15', 'b2'), register(16, '청보석', 20000, 'b2')])
    const { container } = await open()
    type(numberField(), '15')
    type(field('받은 시각'), '')
    type(field('전화번호'), '010-1234-5678')
    type(field('메모'), '김씨')
    fireEvent.keyDown(numberField(), { key: 'Enter' })
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    expect(engine.posts).toHaveLength(1)
    expect(engine.posts[0]).toMatchObject({ type: 'sms', b: 'b2', no: 15, phone: '010-1234-5678', memo: '김씨' })
    expect(engine.posts[0]).not.toHaveProperty('received')
    expect(typeof engine.posts[0]?.requestId).toBe('string')
    const result = await screen.findByRole('region', { name: '넣은 결과' })
    // 받은 시각은 날짜와 함께 (AC-S06b-31), 대기는 보통 색 (AC-S06b-40)
    await waitFor(() => expect(result.textContent).toContain('15번 · 문자찜(김씨) · 대기 1번 · 받은 시각 10/19 10:00:00'))
    expect(result.getAttribute('data-tone')).toBe('info')
    expect(result.textContent).toContain('뒤 4자리 5678')
    expect([numberField().value, field('받은 시각').value, field('전화번호').value, field('메모').value]).toEqual(['', '', '', ''])
    expect(document.activeElement).toBe(numberField())
    expect(container.innerHTML).not.toContain('010-1234-5678')
    expect(container.innerHTML).not.toContain('01012345678')
    // 같은 사람 하나 더: 방금 찜의 구매자를 고른 구매자로 — 전화번호를 다시 채우지 않는다
    fireEvent.click(within(result).getByRole('button', { name: '같은 사람 하나 더' }))
    expect(screen.getByRole('group', { name: '고른 구매자' }).textContent).toContain('문자찜(김씨)')
    expect(field('전화번호').value).toBe('')
    type(numberField(), '16')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    expect(engine.posts[1]).toMatchObject({ type: 'sms', b: 'b2', no: 16, buyer: 'sms:r1' })
    expect(engine.posts[1]).not.toHaveProperty('phone')
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('16번 · 문자찜(김씨) · 1등'))
    expect(screen.getByRole('region', { name: '넣은 결과' }).getAttribute('data-tone')).toBe('success')
  })

  it('지정 구매자가 이미 찜한 상품이면 "이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)"', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '15', 'b2')])
    await open()
    type(field('구매자 고르기'), '홍길')
    fireEvent.click(within(screen.getByRole('list', { name: '찾은 구매자' })).getByRole('button'))
    type(numberField(), '15')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)'))
    expect(screen.getByRole('region', { name: '넣은 결과' }).getAttribute('data-tone')).toBe('warning')
  })

  it('TE-S06-001: 같은 전화번호로 같은 번호를 다시 넣으면(전화번호로 이은 구매자가 이미 찜) "이미 찜한 구매자라…(지금 1등)", 같은 사람 하나 더는 그 문자 구매자', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), register(16, '청보석', 20000, 'b2')])
    await open()
    const sendPhone = async (no: string) => {
      type(numberField(), no)
      type(field('전화번호'), '010-2222-3333')
      fireEvent.submit(numberField().form as HTMLFormElement)
      await flush(20)
    }
    await sendPhone('15')
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('15번 · 문자찜 · 1등'))
    await sendPhone('15')
    expect(engine.posts).toHaveLength(2)
    const result = screen.getByRole('region', { name: '넣은 결과' })
    await waitFor(() => expect(result.textContent).toContain('15번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)'))
    expect(result.textContent).toContain('뒤 4자리 3333')
    fireEvent.click(within(result).getByRole('button', { name: '같은 사람 하나 더' }))
    expect(screen.getByRole('group', { name: '고른 구매자' }).textContent).toContain('문자찜')
    type(numberField(), '16')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    expect(engine.posts[2]).toMatchObject({ type: 'sms', no: 16, buyer: 'sms:r1' })
    expect(engine.posts[2]).not.toHaveProperty('phone')
  })

  it('전화번호로 이은 구매자가 유튜브 구매자에 합쳐져 있어도 "이미 찜한 구매자라…" — 그 지금의 구매자의 찜', async () => {
    setup([
      register(15, '핑크프릴', 10000, 'b2'),
      chat('m1', 'UC_hong1234', '홍길동', '안녕하세요', 'b2'),
      sms('x1', 15, { phoneKey: 'phonekey-01022223333', phoneLast4: '3333' }, 'b2'),
      { type: 'buyer.merge', from: 'sms:x1', into: 'UC_hong1234', reason: '같은 사람' },
    ])
    await open()
    type(numberField(), '15')
    type(field('전화번호'), '010-2222-3333')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    const result = await screen.findByRole('region', { name: '넣은 결과' })
    await waitFor(() => expect(result.textContent).toContain('15번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)'))
    // 15번 1등은 지금의 구매자 홍길동(합쳐진 문자 구매자의 찜)
    expect(screen.getByRole('region', { name: '최근 넣은 문자찜' }).textContent).toContain('홍길동')
    fireEvent.click(within(result).getByRole('button', { name: '같은 사람 하나 더' }))
    expect(screen.getByRole('group', { name: '고른 구매자' })).toBeDefined()
    type(numberField(), '15')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    expect(engine.posts.at(-1)).toMatchObject({ type: 'sms', no: 15, buyer: 'sms:x1' })
  })

  it('G-ENG-176 (SA-S06-008): 뒤 4자리만 같은 X·Y가 15번 1등·대기 → Y 번호로 15번 → 응답의 buyer(Y)로 "이미 찜한 구매자라…(지금 대기 1번)", 같은 사람 하나 더 = Y', async () => {
    setup([
      register(15, '핑크프릴', 10000, 'b2'),
      register(16, '청보석', 20000, 'b2'),
      sms('x1', 15, { phoneKey: 'phonekey-01011115678', phoneLast4: '5678', memo: '이씨' }, 'b2'),
      sms('y1', 15, { phoneKey: 'phonekey-01022225678', phoneLast4: '5678', memo: '박씨' }, 'b2'),
    ])
    await open()
    type(numberField(), '15')
    type(field('전화번호'), '010-2222-5678')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    const result = await screen.findByRole('region', { name: '넣은 결과' })
    await waitFor(() => expect(result.textContent).toContain('15번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 대기 1번)'))
    expect(result.getAttribute('data-tone')).toBe('warning')
    fireEvent.click(within(result).getByRole('button', { name: '같은 사람 하나 더' }))
    expect(screen.getByRole('group', { name: '고른 구매자' }).textContent).toContain('문자찜(박씨)')
    type(numberField(), '16')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    expect(engine.posts.at(-1)).toMatchObject({ type: 'sms', no: 16, buyer: 'sms:y1' })
  })

  it('응답의 buyer가 null(정하지 못함)이면 "새 찜이 생기지 않았어요. 지금 상태를 확인해 주세요."이고 같은 사람 하나 더가 없다', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '15', 'b2')])
    await open()
    // 서버 응답에 정한 구매자가 없다 (모르는 지정 구매자 등)
    engine.server.on('POST', /^\/api\/events/, async (call) => {
      engine.posts.push(call.body ?? {})
      return { body: { date: DATE, rehearsal: false, seq: engine.seq, type: 'sms', changed: false, effects: [], phoneLast4: null, buyer: null } }
    })
    type(numberField(), '15')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    const result = await screen.findByRole('region', { name: '넣은 결과' })
    await waitFor(() => expect(result.textContent).toContain('15번 · 새 찜이 생기지 않았어요. 지금 상태를 확인해 주세요.'))
    expect(result.getAttribute('data-tone')).toBe('warning')
    expect(within(result).queryByRole('button', { name: '같은 사람 하나 더' })).toBeNull()
  })

  it('AC-S06b-31: 최근 문자찜의 받은 시각은 날짜와 함께 — 엔진이 R-6으로 정한 날(오전 10시에 넣은 "23:59"는 전날), 분까지면 "10/18 23:59"', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), sms('x1', 15, { received: '23:59' }, 'b2'), sms('x2', 15, { received: '09:58:07' }, 'b2')])
    await open()
    const recent = screen.getByRole('region', { name: '최근 넣은 문자찜' })
    const rows = within(recent).getAllByRole('listitem').map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('10/19 09:58:07')
    expect(rows[1]).toContain('10/18 23:59 ·')
  })

  it('AC-S06b-32: 방송 고르기 창의 고른 방송은 "✓ 고름" 글자와 aria-pressed — 고르지 않은 항목에는 없다', async () => {
    setup()
    await open()
    fireEvent.click(screen.getByRole('button', { name: '방송 바꾸기' }))
    const dialog = await screen.findByRole('dialog', { name: '방송 고르기' })
    const choices = within(dialog).getAllByRole('button').filter((button) => button.textContent?.includes('부'))
    expect(choices.map((button) => [button.getAttribute('aria-pressed'), button.textContent?.includes('✓ 고름')])).toEqual([
      ['true', true],
      ['false', false],
    ])
  })

  it('AC-S06-82: 서버가 메모를 거절하면 그 문장을 메모 칸 아래에 — 칸은 그대로', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2')])
    await open()
    type(numberField(), '15')
    type(field('메모'), '김씨')
    engine.failNext = apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'memo', message: PHONE_SENTENCE }])
    fireEvent.submit(numberField().form as HTMLFormElement)
    const note = await screen.findByText(PHONE_SENTENCE)
    expect(field('메모').getAttribute('aria-describedby')).toBe(note.id)
    expect([numberField().value, field('메모').value]).toEqual(['15', '김씨'])
    expect(screen.queryByRole('region', { name: '넣은 결과' })).toBeNull()
  })

  it('UX-S06-002: 결과 카드는 번호 칸 바로 위, 보내기 버튼·보내는 중·저장 실패는 화면 아래 보내기 막대 안', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2')])
    await open()
    type(numberField(), '15')
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    const result = await screen.findByRole('region', { name: '넣은 결과' })
    // 문서 순서: 결과 카드 → 번호 칸
    expect(result.compareDocumentPosition(numberField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const bar = screen.getByRole('button', { name: '문자찜 넣기' }).closest('.sms-submit-bar') as HTMLElement
    expect(bar).not.toBeNull()
    type(numberField(), '15')
    engine.down = true
    fireEvent.submit(numberField().form as HTMLFormElement)
    expect(within(bar).getByText('보내는 중…')).toBeDefined()
    expect(await within(bar).findByText(/저장하지 못했어요/, {}, { timeout: 6000 })).toBeDefined()
    expect(within(bar).getByRole('button', { name: '다시 보내기' })).toBeDefined()
    engine.down = false
  }, 10_000)

  it('저장하지 못하면 "저장하지 못했어요" → 다시 보내기는 같은 요청 번호 (한 번만 기록)', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2')])
    await open()
    type(numberField(), '15')
    engine.down = true
    fireEvent.submit(numberField().form as HTMLFormElement)
    expect(await screen.findByText(/저장하지 못했어요/, {}, { timeout: 6000 })).toBeDefined()
    expect(numberField().value).toBe('15')
    engine.down = false
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    await flush(20)
    const sent = engine.server.callsTo('POST', /^\/api\/events/).map((call) => call.body?.requestId)
    expect(sent.length).toBeGreaterThan(1)
    expect(new Set(sent).size).toBe(1)
    expect(engine.posts).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('15번 · 문자찜 · 1등'))
  }, 10_000)

  it('받은 시각이 지금보다 늦으면 확인 창(처음 포커스 "고치기") — "고치기"는 보내지 않고 시각 칸으로, "이대로 넣기"는 보낸다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-10-19T20:05:00+09:00'))
    setup([register(15, '핑크프릴', 10000, 'b2')])
    await open()
    type(numberField(), '15')
    type(field('받은 시각'), '20:07')
    fireEvent.submit(numberField().form as HTMLFormElement)
    const dialog = await screen.findByRole('dialog', { name: '받은 시각을 확인해 주세요' })
    expect(dialog.textContent).toContain('받은 시각(오늘 20:07)이 지금보다 늦어요. 이대로 넣을까요?')
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '고치기' })))
    fireEvent.click(within(dialog).getByRole('button', { name: '고치기' }))
    await flush()
    expect(engine.posts).toHaveLength(0)
    expect(document.activeElement).toBe(field('받은 시각'))
    fireEvent.submit(numberField().form as HTMLFormElement)
    fireEvent.click(within(await screen.findByRole('dialog', { name: '받은 시각을 확인해 주세요' })).getByRole('button', { name: '이대로 넣기' }))
    await flush(20)
    expect(engine.posts).toHaveLength(1)
    expect(engine.posts[0]).toMatchObject({ received: '20:07' })
  })
})

describe('최근 넣은 문자찜·찜 취소 (AC-S06-15·14)', () => {
  it('고른 방송의 문자찜 최근 10개(다른 기기 것 포함) — "찜 취소하기"는 사유 창 → 대기 뒤 host.cancel', async () => {
    // 상품이 없는 번호마다 하나씩 → 보류 찜(활성)
    const events: Record<string, unknown>[] = []
    for (let i = 1; i <= 11; i++) events.push(sms(`x${String(i)}`, i, { memo: `손님${String(i)}` }, 'b2'))
    events.push(sms('y1', 15, {}, 'b1'))
    setup(events)
    await open()
    const recent = screen.getByRole('region', { name: '최근 넣은 문자찜' })
    const rows = within(recent).getAllByRole('listitem')
    expect(rows).toHaveLength(10)
    expect(rows[0]?.textContent).toContain('손님11')
    expect(recent.textContent).not.toContain('손님1 ')
    act(() => engine.write(sms('x12', 15, { memo: '새손님' }, 'b2')))
    // 다른 방송(1부)의 문자찜은 보이지 않는다
    expect(recent.textContent).not.toContain('1부')
    await flush(10)
    expect(within(recent).getAllByRole('listitem')[0]?.textContent).toContain('문자찜(새손님)')
    fireEvent.click(within(within(recent).getAllByRole('listitem')[0] as HTMLElement).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: /15번 문자찜\(새손님\) 취소/ })
    fireEvent.click(within(reason).getByRole('button', { name: '1 시청자 요청' }))
    fireEvent.click(within(reason).getByRole('button', { name: '찜 취소하기' }))
    expect(await screen.findByText(/뒤 보내요: 15번 문자찜\(새손님\) 취소/)).toBeDefined()
    await waitFor(() => expect(engine.posts.some((post) => post.type === 'host.cancel')).toBe(true))
    expect(engine.posts.find((post) => post.type === 'host.cancel')).toMatchObject({ b: 'b2', no: 15, reason: '시청자 요청' })
  })
})

/** 쓰기 응답·증분 조회를 붙잡아 둔다 (D-SMS-01 시험) — 풀면 그때 가짜 서버가 답한다 */
function holdFetch() {
  let postGate: { promise: Promise<void>; release: () => void } | null = null
  let changesGate: { promise: Promise<void>; release: () => void } | null = null
  const make = () => {
    let release = () => {}
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    return { promise, release }
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && path.startsWith('/api/events') && postGate !== null) await postGate.promise
    if (method === 'GET' && path.includes('/changes') && changesGate !== null) await changesGate.promise
    return engine.server.fetch(input, init)
  })
  return {
    holdPost: () => (postGate = make()),
    releasePost: () => {
      postGate?.release()
      postGate = null
    },
    holdChanges: () => (changesGate = make()),
    releaseChanges: () => {
      changesGate?.release()
      changesGate = null
    },
  }
}

describe('보내는 동안 잠금·성공 응답 바로 비우기 (D-SMS-01, AC-SMS-01~04)', () => {
  // 받은 시각 '9:58'은 D-089대로 지금과 가까운 쪽(오전·오후)으로 읽힌다 — 벽시계에 기대지 않게 오전 10:05(KST)로 고정한다
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-10-19T10:05:00+09:00'))
  })

  it('AC-SMS-01: 응답 전에는 칸이 읽기 전용, 구매자 지우기·보내기·같은 사람 하나 더·방송 바꾸기를 누를 수 없고 "보내는 중이라 잠시 고칠 수 없어요."', async () => {
    // 받은 시각 "9:58"은 지금과 가까운 쪽(오전·오후)으로 읽는다(D-023) — 시험이 오후에 돌아도 오전 9:58이 되게 지금을 방송 날 오전 10:05로 둔다
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-10-19T10:05:00+09:00'))
    setup([register(15, '핑크프릴', 10000, 'b2'), register(16, '청보석', 20000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '안녕하세요', 'b2')])
    const hold = holdFetch()
    await open()
    // 이전 결과 카드 (같은 사람 하나 더)
    type(numberField(), '16')
    type(field('전화번호'), '010-2222-3333')
    fireEvent.submit(numberField().form as HTMLFormElement)
    const previous = await screen.findByRole('region', { name: '넣은 결과' })
    await waitFor(() => expect(previous.textContent).toContain('16번 · 문자찜 · 1등'))
    type(field('구매자 고르기'), '홍길')
    fireEvent.click(within(screen.getByRole('list', { name: '찾은 구매자' })).getByRole('button'))
    type(numberField(), '15')
    type(field('받은 시각'), '9:58')
    type(field('메모'), '김씨')
    hold.holdPost()
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush()
    for (const name of ['번호', '받은 시각', '전화번호', '메모']) expect(field(name).readOnly).toBe(true)
    expect((screen.getByRole('button', { name: '방송 바꾸기' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '고른 구매자 지우기' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '15번에 문자찜 넣기' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(previous).getByRole('button', { name: '같은 사람 하나 더' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('보내는 중…')).toBeDefined()
    expect(screen.getByText('보내는 중이라 잠시 고칠 수 없어요.')).toBeDefined()
    type(numberField(), '99')
    type(field('메모'), '바뀜')
    expect([numberField().value, field('받은 시각').value, field('메모').value]).toEqual(['15', '9:58', '김씨'])
    // 다시 눌러도 하나만 보낸다
    fireEvent.submit(numberField().form as HTMLFormElement)
    hold.releasePost()
    await flush(20)
    expect(engine.posts).toHaveLength(2)
    expect(engine.posts[1]).toMatchObject({ type: 'sms', no: 15, received: '09:58', memo: '김씨', buyer: 'UC_hong1234' })
    expect(field('번호').readOnly).toBe(false)
    expect(screen.queryByText('보내는 중이라 잠시 고칠 수 없어요.')).toBeNull()
    expect((screen.getByRole('button', { name: '방송 바꾸기' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('AC-SMS-02·03: 따라잡기를 붙잡아도 성공 응답 바로 칸을 비우고 번호 칸으로 — 카드는 "상태 확인 중…", 바로 친 "16"은 따라잡은 뒤에도 남는다', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '15', 'b2')])
    const hold = holdFetch()
    const { container } = await open()
    type(numberField(), '15')
    type(field('전화번호'), '010-1234-5678')
    type(field('메모'), '김씨')
    hold.holdChanges()
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    expect(engine.posts).toHaveLength(1)
    expect([numberField().value, field('받은 시각').value, field('전화번호').value, field('메모').value]).toEqual(['', '', '', ''])
    expect(numberField().readOnly).toBe(false)
    expect(document.activeElement).toBe(numberField())
    expect(screen.getByRole('region', { name: '고른 방송' }).textContent).toContain('2부')
    expect(container.innerHTML).not.toContain('010-1234-5678')
    const result = screen.getByRole('region', { name: '넣은 결과' })
    expect(result.textContent).toBe('15번 · 넣었어요 · 상태 확인 중… · 뒤 4자리 5678같은 사람 하나 더')
    expect(result.textContent).not.toContain('새 찜이 생기지 않았어요')
    expect(within(result).queryByRole('button', { name: '찜 취소하기' })).toBeNull()
    expect((within(result).getByRole('button', { name: '같은 사람 하나 더' }) as HTMLButtonElement).disabled).toBe(false)
    type(numberField(), '16')
    hold.releaseChanges()
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('15번 · 문자찜(김씨) · 대기 1번 · 받은 시각 10/19 10:00:00'))
    expect(within(screen.getByRole('region', { name: '넣은 결과' })).getByRole('button', { name: '찜 취소하기' })).toBeDefined()
    await flush(20)
    expect(numberField().value).toBe('16')
  })

  it('AC-SMS-03: 따라잡기 전에는 찜이 생기지 않은 응답도 "상태 확인 중…" — 따라잡으면 "이미 찜한 구매자라…"', async () => {
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '15', 'b2')])
    const hold = holdFetch()
    await open()
    type(field('구매자 고르기'), '홍길')
    fireEvent.click(within(screen.getByRole('list', { name: '찾은 구매자' })).getByRole('button'))
    type(numberField(), '15')
    hold.holdChanges()
    fireEvent.submit(numberField().form as HTMLFormElement)
    await flush(20)
    const result = screen.getByRole('region', { name: '넣은 결과' })
    expect(result.textContent).toContain('15번 · 넣었어요 · 상태 확인 중…')
    expect(result.textContent).not.toContain('이미 찜한 구매자라')
    expect(screen.queryByRole('group', { name: '고른 구매자' })).toBeNull()
    hold.releaseChanges()
    // 이 쓰기는 기록을 늘리지 않았을 수 있다 — 따라잡기는 응답 seq까지
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)'))
  })

  it('AC-SMS-04: 거절·저장 실패면 잠금이 풀리고 칸(고른 구매자 포함)은 친 그대로 — 다시 보내기는 같은 요청 번호로 하나만', async () => {
    // 받은 시각 "9:58"은 지금과 가까운 쪽(오전·오후)으로 읽는다(D-023) — 시험이 오후에 돌아도 오전 9:58이 되게 지금을 방송 날 오전 10:05로 둔다
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-10-19T10:05:00+09:00'))
    setup([register(15, '핑크프릴', 10000, 'b2'), chat('m1', 'UC_hong1234', '홍길동', '안녕하세요', 'b2')])
    await open()
    type(field('구매자 고르기'), '홍길')
    fireEvent.click(within(screen.getByRole('list', { name: '찾은 구매자' })).getByRole('button'))
    type(numberField(), '15')
    type(field('받은 시각'), '9:58')
    type(field('메모'), '김씨')
    engine.failNext = apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'memo', message: PHONE_SENTENCE }])
    fireEvent.submit(numberField().form as HTMLFormElement)
    expect(await screen.findByText(PHONE_SENTENCE)).toBeDefined()
    expect([numberField().value, field('받은 시각').value, field('메모').value]).toEqual(['15', '9:58', '김씨'])
    expect(screen.getByRole('group', { name: '고른 구매자' }).textContent).toContain('홍길동')
    expect(numberField().readOnly).toBe(false)
    // 네트워크 오류 (다시 시도해도 닿지 않는다)
    engine.down = true
    fireEvent.submit(numberField().form as HTMLFormElement)
    expect(await screen.findByText(/저장하지 못했어요/, {}, { timeout: 6000 })).toBeDefined()
    engine.down = false
    expect([numberField().value, field('받은 시각').value, field('메모').value]).toEqual(['15', '9:58', '김씨'])
    expect(screen.getByRole('group', { name: '고른 구매자' })).toBeDefined()
    expect(numberField().readOnly).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }))
    await flush(20)
    const ids = engine.server.callsTo('POST', /^\/api\/events/).slice(1).map((call) => call.body?.requestId)
    expect(new Set(ids).size).toBe(1)
    expect(engine.posts.filter((post) => post.type === 'sms')).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('region', { name: '넣은 결과' }).textContent).toContain('15번 · 홍길동'))
  }, 10_000)
})
