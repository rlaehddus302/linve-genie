// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 방송 시작 라벨 단계 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고 한다 하면 프린터 연결 도와주고
// 연결 확인하고 라벨 디자인 커스텀 한 다음에 테스트 출력한다음에 본방송으로"): 묻기 → 연결·확인 → 꾸미기(서버 초안 미리 보기) → 테스트 "예" → 출력 기기 → 방송.
import { B1_PROFILE } from '@livejjim/printer'
import { defaultTemplate, productDesign, type ProductDesign, type ProductTemplate } from '@livejjim/label'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BleDeviceInfo, PickEntry } from '@livejjim/mobile-ble'
import { describe, expect, it, vi } from 'vitest'
import { pickDevice, setPickEntries } from '../src/native/printer-pick.ts'
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
    const body = call.body as { template: ProductTemplate; resize?: '50x40'; design?: ProductDesign }
    const template = body.resize === undefined && body.design === undefined ? body.template : { ...productDesign(body.resize ?? body.template.size, body.design ?? 'basic'), shopName: body.template.shopName, priceStyle: body.template.priceStyle }
    return { body: { template, width: 400, height: 240, png: PNG, longest: null } }
  })
  world.server.on('PUT', /^\/api\/print\/templates\/product$/, () => ({ body: { version: 3 } }))
  world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
  world.server.on('POST', /^\/api\/print\/device$/, () => ({ body: { queue: {}, waiting: 0, backlog: false } }))
  world.server.on('GET', /^\/api\/print\/test-bitmap\?size=50x30$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
  world.services.labels.start()
  return world
}

describe('D-UX3-19 라이브 시작 라벨 단계', () => {
  // 옛 기대: 단추 [네, 뽑을게요](위)·[안 뽑아요](아래). D-UX4-01·03: 좌우로 [괜찮아요](왼쪽)·[뽑을게요](오른쪽), 설명 세 줄과 라벨 그림.
  // D-LBL-NOPRN-01 (사용자 지시 2026-11-16 "프린터 연결 안 되어 있더라도 기능 보이게 … 프린터 없으면 일단 큐에 넣어라"): 왼쪽은 [프린터 없이] — 라벨 기능을 끄지 않고
  //   (옛 기대: [괜찮아요] → PUT enabled false) 켠 채 라이브로 간다. 설명에 "프린터가 없어도 … 대기열에 쌓였다가" 한 줄이 더해졌다
  it('[프린터 없이]: 라벨 기능을 켠 채(꺼져 있으면 켜고) 바로 라이브로 — 라벨은 대기열에 쌓인다 (D-LBL-NOPRN-01)', async () => {
    const world = labelWorld()
    const onDone = vi.fn()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={onDone} />))
    const page = screen.getByRole('dialog', { name: '라벨' })
    expect(within(page).getByRole('heading', { name: '라벨을 뽑을까요?' })).toBeTruthy()
    expect(page.textContent).toContain('찜이 확정되면 라벨 프린터로 바로 출력해요.\n상품 번호, 가격, 구매자 이름 등을 기록할 수 있어서\n나중에 포장할 때 헷갈리지 않아요.')
    expect(page.textContent).toContain('프린터가 없어도 라벨은 대기열에 쌓였다가 연결하면 뽑혀요.')
    expect(within(page).getByRole('img', { name: '라벨 프린터에서 라벨이 뽑혀 나오는 그림' }).textContent).toContain('-라이브다육-')
    expect(within(page).getAllByRole('button').map((button) => button.getAttribute('aria-label')).slice(-2)).toEqual(['프린터 없이', '뽑을게요'])
    await flush()
    fireEvent.click(within(page).getByRole('button', { name: '프린터 없이' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    // 이미 켜져 있으면 켬/끔을 건드리지 않는다 — 끄는 요청은 없다
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/).map((call) => call.body)).not.toContainEqual({ enabled: false })
    world.services.labels.stop()
  })

  // 옛 기대: 연결 화면에서 [프린터 찾기]를 눌러야 찾았다, 가격 표기 '8,000원', 날짜 스위치 '날짜 — 켜짐'.
  // 새 기대 D-UX4-04·05·07: 연결 화면은 들어오면 바로 찾는다(단추는 [새로고침] 하나), 가격 표기는 앱 예시(30만원)로 '30만원'·'300 천원'·'300,000원', 칸마다 설정 카드의 [찍기] 스위치
  it('[뽑을게요] → 바로 연결 → 꾸미기(크기·가격·항목, 서버 미리 보기) → 저장 → 테스트 "예" → 이 기기를 출력 기기로 → 라이브', async () => {
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

    const design = await screen.findByRole('dialog', { name: '라벨 디자인' })
    // 가게 이름 칸은 저장된 본문(빈 글) — 비우면 가게 설정 이름을 따른다
    fireEvent.click(await within(design).findByRole('radio', { name: '가게 이름' }))
    fireEvent.click(within(design).getByRole('button', { name: '가게 이름 편집' }))
    expect((await screen.findByRole('textbox', { name: '가게 이름' }) as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
    fireEvent.click(within(design).getByRole('tab', { name: '용지' }))
    await waitFor(() => expect(world.server.callsTo('POST', /\/preview$/).length).toBeGreaterThan(0))
    expect(within(design).getByLabelText('라벨 미리 보기')).toBeTruthy()
    fireEvent.click(within(design).getByRole('radio', { name: '50×40mm' }))
    await waitFor(() => expect(within(design).getByRole('radio', { name: '50×40mm' }).getAttribute('aria-checked')).toBe('true'))
    expect(world.server.callsTo('POST', /\/preview$/).at(-1)?.body).toMatchObject({ resize: '50x40' })
    fireEvent.click(within(design).getByRole('tab', { name: '항목' }))
    fireEvent.click(within(design).getByRole('radio', { name: '가격' }))
    expect(within(within(design).getByRole('radiogroup', { name: '가격 표기' })).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['30만원', '300 천원', '300,000원'])
    fireEvent.click(within(design).getByRole('radio', { name: '300,000원' }))
    fireEvent.click(within(design).getByRole('radio', { name: '날짜' }))
    fireEvent.click(within(within(design).getByRole('group', { name: '날짜 설정' })).getByRole('switch', { name: '찍기 — 켜짐' }))
    fireEvent.click(within(design).getByRole('button', { name: '저장하고 다음' }))
    await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(1))
    const saved = world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)[0]?.body as { template: { size: string; priceStyle: string; items: { date: { visible: boolean } } }; version: number }
    expect(saved.version).toBe(2)
    expect(saved.template).toMatchObject({ size: '50x40', priceStyle: 'WON', items: { date: { visible: false } } })

    fireEvent.click(await screen.findByRole('button', { name: '이 기기에서 출력' }))
    expect(world.server.callsTo('GET', /test-bitmap/)).toHaveLength(0)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[0]?.body).toMatchObject({ name: '내 휴대폰' })
    world.services.labels.stop()
  })

  // 새 기대 D-UX4-11 (사용자 지시 2026-11-05 "테스트 라벨은 선택적으로 뽑기로"): 테스트 화면 [건너뛰기](왼쪽)·[테스트 인쇄](오른쪽)
  it('방송 시작에는 테스트 화면을 열지 않고 기기를 지정한다', async () => {
    const world = labelWorld()
    const onDone = vi.fn()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={onDone} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '뽑을게요' }))
    const connect = await screen.findByRole('dialog', { name: '프린터 연결' })
    await waitFor(() => expect(within(connect).getByText('연결됐어요')).toBeTruthy())
    fireEvent.click(within(connect).getByRole('button', { name: '다음' }))
    const design = await screen.findByRole('dialog', { name: '라벨 디자인' })
    await within(design).findByRole('group', { name: '번호 설정' })
    fireEvent.click(within(design).getByRole('button', { name: '저장하고 다음' }))
    fireEvent.click(await screen.findByRole('button', { name: '이 기기에서 출력' }))
    expect(screen.queryByRole('dialog', { name: '테스트 인쇄' })).toBeNull()
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[0]?.body).toMatchObject({ name: '내 휴대폰' })
    expect(world.server.callsTo('GET', /test-bitmap/)).toHaveLength(0)
    expect(world.ble.printed).toHaveLength(0)
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
    const design = await screen.findByRole('dialog', { name: '라벨 디자인' })
    await within(design).findByRole('group', { name: '번호 설정' })
    return { world, design }
  }

  // 옛 기대 D-UX4-04: 단추는 [새로고침] 하나, 설명 '블루투스가 켜져 있어야 해요.', 그림 '프린터 전원이 켜지고 블루투스로 이어지는 그림'.
  // 새 기대 D-UX4-10 (사용자 지시 2026-11-05 "새로고침은 어차피 주기적으로 하니까 없애자", "'휴대폰' 블루투스"): 단추 없음, 휴대폰·프린터 그림
  it('연결 화면: 단추 없음(저절로 다시 찾음), 휴대폰·프린터 그림, 찾는 동안 주변 프린터 칸', async () => {
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
    expect(connect.textContent).toContain('프린터 전원을 켜고 휴대폰 가까이 두세요.\n휴대폰 블루투스가 켜져 있어야 해요.')
    // D-UX4-112: 옛 기대 "서로 이어지는 그림" → "서로 연결되는 그림"
    expect(within(connect).getByRole('img', { name: '휴대폰 블루투스와 프린터 전원이 켜지고 서로 연결되는 그림' })).toBeTruthy()
    expect(within(connect).getByRole('group', { name: '주변 프린터' })).toBeTruthy()
    expect(within(connect).queryByRole('button', { name: '다시 연결' })).toBeNull()
    expect(within(connect).queryByRole('button', { name: '다른 프린터 찾기' })).toBeNull()
    expect(within(connect).queryByRole('button', { name: '새로고침' })).toBeNull()
    expect(within(connect).queryByRole('button', { name: '다음' })).toBeNull()
    // 그만둔 고르기는 잘못 알림으로 보이지 않는다
    expect(within(connect).queryByRole('alert')).toBeNull()
    world.services.labels.stop()
  })

  it('줄을 고르면 다음 화면으로 넘어가지 않고 그 줄에 "연결하는 중…" → "연결됐어요", 이어진 뒤에야 [다음] (D-UX4-10)', async () => {
    const world = labelWorld()
    setPickEntries((devices) => devices.map((device): PickEntry => ({ device, title: device.name ?? '', model: 'NIIMBOT', signal: null, experimental: false, detail: 'NIIMBOT' })))
    let found: ((devices: readonly BleDeviceInfo[]) => void) | null = null
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const realConnect = world.ble.connect.bind(world.ble)
    // 찾기 → 고르기 → (잠깐 잇는 중) → 이어짐
    vi.spyOn(world.ble, 'connect').mockImplementation(async (method) => {
      world.ble.setState('CONNECTING')
      const device = await pickDevice({ onDevices: (cb) => {
        found = cb
        return () => {
          found = null
        }
      } } as Parameters<typeof pickDevice>[0])
      if (device === null) {
        world.ble.setState('DISCONNECTED')
        return { ok: false as const, error: { code: 'NOT_SELECTED' as const, message: '프린터를 고르지 않았어요.' } }
      }
      await gate
      return realConnect(method)
    })
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={() => {}} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '뽑을게요' }))
    const connect = await screen.findByRole('dialog', { name: '프린터 연결' })
    await waitFor(() => expect(found).not.toBeNull())
    act(() => found?.([{ id: 'd1', name: 'B1-1234' } as BleDeviceInfo, { id: 'd2', name: 'B1-5678' } as BleDeviceInfo]))
    fireEvent.click(within(connect).getByRole('button', { name: 'B1-1234 — NIIMBOT' }))
    // 같은 화면: 그림·고른 줄이 그대로, 그 줄에 잇는 중
    await waitFor(() => expect(within(connect).getByText('연결하는 중…')).toBeTruthy())
    expect(screen.getByRole('dialog', { name: '프린터 연결' })).toBe(connect)
    // D-UX4-112: 옛 기대 "서로 이어지는 그림" → "서로 연결되는 그림"
    expect(within(connect).getByRole('img', { name: '휴대폰 블루투스와 프린터 전원이 켜지고 서로 연결되는 그림' })).toBeTruthy()
    expect(within(connect).getByText('B1-1234')).toBeTruthy()
    expect(within(connect).queryByRole('button', { name: '다음' })).toBeNull()
    await act(async () => {
      release()
      await flush()
    })
    await waitFor(() => expect(within(connect).getByText('연결됐어요')).toBeTruthy())
    expect(within(connect).getByText('B1-1234')).toBeTruthy()
    fireEvent.click(within(connect).getByRole('button', { name: '다음' }))
    await screen.findByRole('dialog', { name: '라벨 디자인' })
    world.services.labels.stop()
  })

  it('고정 화면의 제목·템플릿과 실제 인쇄 미리보기에서 바로 항목을 선택한다 (D-LABEL-UI-02)', async () => {
    const { world, design } = await openDesign()
    expect(within(design).getByRole('heading', { name: '라벨 디자인' })).toBeTruthy()
    expect(within(design).getByRole('button', { name: '템플릿' })).toBeTruthy()
    const box = within(design).getByRole('button', { name: '라벨의 품종' })
    expect(box.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(design).getByRole('tab', { name: '용지' }))
    const sizes = within(within(design).getByRole('radiogroup', { name: '라벨 크기' })).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))
    expect(sizes).toEqual(['50×20mm', '50×30mm', '50×40mm'])
    expect(within(design).queryByRole('group', { name: '번호 설정' })).toBeNull()
    fireEvent.click(box)
    expect(box.getAttribute('aria-pressed')).toBe('true')
    expect(within(design).getByRole('tab', {name: '항목'}).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(design).getByRole('radio', { name: '날짜' }))
    fireEvent.click(within(within(design).getByRole('group', { name: '날짜 설정' })).getByRole('switch', { name: '찍기 — 켜짐' }))
    expect(within(design).queryByRole('button', { name: '라벨의 날짜' })).toBeNull()
    world.services.labels.stop()
  })

  it('칸마다 글자 크기를 바꿔 저장한다 (번호는 늘 찍힘)', async () => {
    const { world, design } = await openDesign()
    const number = within(design).getByRole('group', { name: '번호 설정' })
    expect(within(number).queryByRole('switch')).toBeNull()
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

it('저장된 자유 배치를 열고 표형을 선택하면 저장할 때만 반영한다', async () => {
  const world = labelWorld()
  render(world.wrap(<LabelSetupScreen only="design" onBack={() => {}} onDone={() => {}} />))
  await screen.findByRole('group', { name: '번호 설정' })
  fireEvent.click(screen.getByRole('button', { name: '템플릿' }))
  fireEvent.click(await screen.findByRole('radio', { name: '표형' }))
  await waitFor(() => expect(world.server.callsTo('POST', /\/preview$/).some((c) => (c.body as {design?: string}).design === 'table')).toBe(true))
  await waitFor(() => expect(screen.getByRole('button', {name:'저장'}).matches(':disabled, [aria-disabled="true"]')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '템플릿' }))
  expect((await screen.findByRole('radio', {name:'표형'})).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('button', {name:'판 닫기'}))
  expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)[0]?.body).toMatchObject({ template: { design: 'table' }, version: 2 }))
  world.services.labels.stop()
})

it('문구 추가의 첫 위치는 오른쪽 위이며 여러 문구의 내용·위치를 고치고 삭제할 수 있다', async () => {
  const world = labelWorld()
  render(world.wrap(<LabelSetupScreen only="design" onBack={() => {}} onDone={() => {}} />))
  fireEvent.click(await screen.findByRole('tab', { name: '문구' }))
  const add = await screen.findByRole('button', { name: '문구 추가' })
  fireEvent.click(add)
  fireEvent.change(screen.getByRole('textbox', { name: '문구 1' }), { target: { value: '향남꽃선비 라방' } })
  fireEvent.click(screen.getByRole('button', { name: '완료' }))
  expect(within(screen.getByRole('radiogroup', { name: '문구 1 위치' })).getByRole('radio', { name: '오른쪽 위' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(add)
  fireEvent.change(screen.getByRole('textbox', { name: '문구 2' }), { target: { value: '감사합니다' } })
  fireEvent.click(screen.getByRole('button', { name: '완료' }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: '문구 2 위치' })).getByRole('radio', { name: '왼쪽 아래' }))
  fireEvent.click(add)
  fireEvent.click(screen.getByRole('button', { name: '완료' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '이전 문구' }))
  expect(screen.getByRole('button', { name: '문구 1 편집' }).textContent).toContain('향남꽃선비 라방')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)[0]?.body).toMatchObject({
    template: { captions: [{ text: '향남꽃선비 라방', position: 'topRight' }, { text: '감사합니다', position: 'bottomLeft' }] },
  }))
  world.services.labels.stop()
})
