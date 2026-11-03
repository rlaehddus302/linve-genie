// 방송 시작 라벨 단계 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고 한다 하면 프린터 연결 도와주고
// 연결 확인하고 라벨 디자인 커스텀 한 다음에 테스트 출력한다음에 본방송으로"): 묻기 → 연결·확인 → 꾸미기(서버 초안 미리 보기) → 테스트 "예" → 출력 기기 → 방송.
import { B1_PROFILE } from '@livejjim/printer'
import { defaultTemplate, type ProductTemplate } from '@livejjim/label'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LabelSetupScreen } from '../src/screens/LabelSetupScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const PNG = 'iVBORw0KGgo='

function labelWorld(labelsEnabled = true) {
  const world = makeWorld()
  world.ble.profile = B1_PROFILE
  const queue = { rev: 1, device: null, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled, labelSizes: ['50x30', '50x20', '50x40'] }
  world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue, jobs: [], discard: [] } }))
  world.server.on('PUT', /^\/api\/settings\/labels$/, () => ({ body: { enabled: true } }))
  world.server.on('GET', /^\/api\/print\/templates$/, () => ({ body: { product: { template: { ...defaultTemplate('product'), shopName: '초록다육' }, version: 2, storedShopName: '' }, packing: { template: defaultTemplate('packing'), version: 0, storedShopName: '' } } }))
  world.server.on('POST', /^\/api\/print\/templates\/product\/preview$/, (call) => {
    const body = call.body as { template: ProductTemplate; resize?: '50x40' }
    const template = body.resize === undefined ? body.template : { ...defaultTemplate('product', body.resize), shopName: body.template.shopName, priceStyle: body.template.priceStyle }
    return { body: { template, width: 400, height: 240, png: PNG, longest: null } }
  })
  world.server.on('PUT', /^\/api\/print\/templates\/product$/, () => ({ body: { version: 3 } }))
  world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
  world.server.on('POST', /^\/api\/print\/device$/, () => ({ body: { queue: {}, waiting: 0, backlog: false } }))
  world.server.on('GET', /^\/api\/print\/test-bitmap\?size=50x30$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
  world.services.labels.start()
  return world
}

describe('D-UX3-19 방송 시작 라벨 단계', () => {
  // 옛 기대: 단추 [네, 뽑을게요](위)·[안 뽑아요](아래). 새 기대 D-UX4-01·03: 좌우로 [괜찮아요](왼쪽)·[뽑을게요](오른쪽), 설명 세 줄과 라벨 그림
  it('[괜찮아요]: 라벨 기능을 끄고 바로 방송으로 (D-UX4-03)', async () => {
    const world = labelWorld()
    const onDone = vi.fn()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={onDone} />))
    const page = screen.getByRole('dialog', { name: '라벨' })
    expect(within(page).getByRole('heading', { name: '라벨을 뽑을까요?' })).toBeTruthy()
    expect(page.textContent).toContain('찜이 확정되면 라벨 프린터로 바로 출력해요.\n상품 번호, 가격, 구매자 이름 등을 기록할 수 있어서\n나중에 포장할 때 헷갈리지 않아요.')
    expect(within(page).getByRole('img', { name: '라벨 프린터에서 라벨이 뽑혀 나오는 그림' }).textContent).toContain('-라이브다육-')
    expect(within(page).getAllByRole('button').map((button) => button.getAttribute('aria-label')).slice(-2)).toEqual(['괜찮아요', '뽑을게요'])
    await flush()
    fireEvent.click(within(page).getByRole('button', { name: '괜찮아요' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: false })
    world.services.labels.stop()
  })

  // 옛 기대: 연결 화면에서 [프린터 찾기]를 눌러야 찾았다, 가격 표기 '8,000원', 날짜 스위치 '날짜 — 켜짐'.
  // 새 기대 D-UX4-04·05: 연결 화면은 들어오면 바로 찾는다(단추는 [새로고침] 하나), 가격 표기는 앱 예시(30만원)로 '300,000원', 칸마다 설정 카드의 [찍기] 스위치
  it('[뽑을게요] → 바로 연결 → 꾸미기(크기·가격·항목, 서버 미리 보기) → 저장 → 테스트 "예" → 이 기기를 출력 기기로 → 방송', async () => {
    const world = labelWorld()
    const onDone = vi.fn()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={onDone} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '뽑을게요' }))
    // 이미 켜져 있으면 켬/끔을 건드리지 않는다
    const connect = await screen.findByRole('dialog', { name: '프린터 연결' })
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(0)
    expect(within(connect).getByRole('heading', { name: '라벨 프린터를 연결해 주세요' })).toBeTruthy()
    // 누르지 않아도 바로 찾아 잇는다
    await waitFor(() => expect(within(connect).getByText('연결됐어요')).toBeTruthy())
    expect(within(connect).getByText('NIIMBOT B1')).toBeTruthy()
    expect(within(connect).queryByText(/실험/)).toBeNull()
    fireEvent.click(within(connect).getByRole('button', { name: '다음' }))

    const design = await screen.findByRole('dialog', { name: '라벨 꾸미기' })
    // 가게 이름 칸은 저장된 본문(빈 글) — 비우면 가게 설정 이름을 따른다
    expect((await within(design).findByRole('textbox', { name: '가게 이름' }) as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(world.server.callsTo('POST', /\/preview$/).length).toBeGreaterThan(0))
    expect(within(design).getByLabelText('라벨 미리 보기')).toBeTruthy()
    fireEvent.click(within(design).getByRole('radio', { name: '50×40mm' }))
    await waitFor(() => expect(within(design).getByRole('radio', { name: '50×40mm' }).getAttribute('aria-checked')).toBe('true'))
    expect(world.server.callsTo('POST', /\/preview$/).at(-1)?.body).toMatchObject({ resize: '50x40' })
    fireEvent.click(within(design).getByRole('radio', { name: '300,000원' }))
    fireEvent.click(within(within(design).getByRole('group', { name: '날짜 설정' })).getByRole('switch', { name: '찍기 — 켜짐' }))
    fireEvent.click(within(design).getByRole('button', { name: '저장하고 다음' }))
    await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(1))
    const saved = world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)[0]?.body as { template: { size: string; priceStyle: string; items: { date: { visible: boolean } } }; version: number }
    expect(saved.version).toBe(2)
    expect(saved.template).toMatchObject({ size: '50x40', priceStyle: 'WON', items: { date: { visible: false } } })

    const test = await screen.findByRole('dialog', { name: '테스트 인쇄' })
    fireEvent.click(within(test).getByRole('button', { name: '테스트 인쇄' }))
    await within(test).findByText('테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?')
    fireEvent.click(within(test).getByRole('button', { name: '예' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[0]?.body).toMatchObject({ name: '내 휴대폰' })
    world.services.labels.stop()
  })

  it('라벨 기능이 꺼져 있으면 [뽑을게요]가 켠다', async () => {
    const world = labelWorld(false)
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={() => {}} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '뽑을게요' }))
    await screen.findByRole('dialog', { name: '프린터 연결' })
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: true })
    world.services.labels.stop()
  })
})

describe('D-UX4-04·05 연결 화면과 라벨 꾸미기', () => {
  /** 묻기 → 연결(바로 이어짐) → 꾸미기 화면까지 */
  async function openDesign() {
    const world = labelWorld()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={() => {}} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '뽑을게요' }))
    const connect = await screen.findByRole('dialog', { name: '프린터 연결' })
    await waitFor(() => expect(within(connect).getByText('연결됐어요')).toBeTruthy())
    fireEvent.click(within(connect).getByRole('button', { name: '다음' }))
    const design = await screen.findByRole('dialog', { name: '라벨 꾸미기' })
    await within(design).findByRole('group', { name: '번호 설정' })
    return { world, design }
  }

  it('연결 화면: 단추는 [새로고침] 하나, 전원·블루투스 그림, 찾는 동안 주변 프린터 칸', async () => {
    const world = labelWorld()
    // 고르기 창을 닫은 것처럼 (찾기를 그만둠)
    const notSelected = { ok: false as const, error: { code: 'NOT_SELECTED' as const, message: '프린터를 고르지 않았어요.' } }
    vi.spyOn(world.ble, 'connect').mockResolvedValue(notSelected)
    vi.spyOn(world.ble, 'reconnect').mockResolvedValue(notSelected)
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={() => {}} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '뽑을게요' }))
    const connect = await screen.findByRole('dialog', { name: '프린터 연결' })
    await flush()
    expect(connect.textContent).toContain('프린터 전원을 켜고 휴대폰 가까이 두세요.\n블루투스가 켜져 있어야 해요.')
    expect(within(connect).getByRole('img', { name: '프린터 전원이 켜지고 블루투스로 이어지는 그림' })).toBeTruthy()
    expect(within(connect).getByRole('group', { name: '주변 프린터' })).toBeTruthy()
    expect(within(connect).queryByRole('button', { name: '다시 연결' })).toBeNull()
    expect(within(connect).queryByRole('button', { name: '다른 프린터 찾기' })).toBeNull()
    expect(within(connect).getByRole('button', { name: '새로고침' })).toBeTruthy()
    // 그만둔 고르기는 잘못 알림으로 보이지 않는다
    expect(within(connect).queryByRole('alert')).toBeNull()
    world.services.labels.stop()
  })

  it('제목·견본 줄 없음·라벨 크기는 작은 것부터 셋씩·칸을 누르면 고르고 그 설정 카드가 표시된다', async () => {
    const { world, design } = await openDesign()
    expect(within(design).getByRole('heading', { name: '출력될 라벨을 꾸며 주세요' })).toBeTruthy()
    expect(design.textContent).not.toContain('견본')
    const sizes = within(within(design).getByRole('radiogroup', { name: '라벨 크기' })).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))
    expect(sizes).toEqual(['50×20mm', '50×30mm', '50×40mm'])
    const box = within(design).getByRole('button', { name: '라벨의 품종' })
    expect(box.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(box)
    expect(within(design).getByRole('button', { name: '라벨의 품종' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(design).getByText('품종 — 끌어서 옮기고, 동그라미를 끌어 크기를 바꿔요.')).toBeTruthy()
    // 꺼 둔 칸은 라벨 위에 누를 자리가 없다
    fireEvent.click(within(within(design).getByRole('group', { name: '날짜 설정' })).getByRole('switch', { name: '찍기 — 켜짐' }))
    expect(within(design).queryByRole('button', { name: '라벨의 날짜' })).toBeNull()
    world.services.labels.stop()
  })

  it('칸마다 글자 크기를 바꿔 저장한다 (번호는 늘 찍힘)', async () => {
    const { world, design } = await openDesign()
    const number = within(design).getByRole('group', { name: '번호 설정' })
    expect(within(number).queryByRole('switch')).toBeNull()
    expect(number.textContent).toContain('늘 찍혀요.')
    const before = defaultTemplate('product').items.number.fontSize
    fireEvent.click(within(number).getByRole('button', { name: '번호 글자 크게' }))
    expect(within(number).getByLabelText(`번호 글자 크기 ${String(before + 2)}`)).toBeTruthy()
    fireEvent.click(within(design).getByRole('button', { name: '저장하고 다음' }))
    await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(1))
    const saved = world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)[0]?.body as { template: ProductTemplate }
    expect(saved.template.items.number.fontSize).toBe(before + 2)
    world.services.labels.stop()
  })
})
