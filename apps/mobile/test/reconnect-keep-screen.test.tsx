// 방송 중 계속 다시 잇기의 화면과 앱 프린터 (F2·F2-2, D-RETRO-42·43):
// - 출력 상태 화면: 방송 중에는 "(n/6)" 대신 "연결될 때까지 계속 … (n번째)". 방송이 없으면 지금 문장 그대로.
// - 앱 프린터: 계속 잇기 허락을 블루투스·시험용 프린터 두 어댑터에 넘기고, 연결 사실은 블루투스 프린터일 때만 준다.
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AUTO_RECONNECT_POLICY, createReconnectingAdapter } from '@livejjim/mobile-ble'
import { createFakePrinter } from '@livejjim/printer'
import type { LinkFacts } from '../src/lib/print-cause.ts'
import { keepReconnectingMessage } from '../src/lib/print-words.ts'
import { autoReconnectingMessage } from '../src/lib/words.ts'
import { AppPrinter } from '../src/native/app-printer.ts'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const queue = { rev: 2, device: { id: 'app-test', name: '내 휴대폰', live: true, printerConnected: false, releasing: false, profileId: null }, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false }, waiting: 1, printing: 0, discard: 0, labelsEnabled: true, labelSizes: ['50x30'] }

describe('출력 상태 화면의 다시 잇는 문장', () => {
  async function open(live: boolean) {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue, jobs: [], discard: [], live } }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('이 휴대폰이 라벨을 받아 출력해요') /* D-PRNUX-01 — 옛: '이 기기가 출력 기기예요 · 내 휴대폰' */).toBeTruthy())
    const auto = async (state: typeof world.ble.autoReconnect) => {
      await act(async () => {
        world.ble.autoReconnect = state
        world.ble.changed()
        await flush()
      })
    }
    return { world, auto }
  }

  it('방송 중: 6번을 넘겨도 그치지 않고 몇 번째인지 보인다 — 쉬운 말, 총 횟수 없음', async () => {
    const { world, auto } = await open(true)
    expect(world.ble.keepReconnecting).toBe(true)
    await auto({ kind: 'trying', attempt: 9, total: null })
    expect(screen.getByText(keepReconnectingMessage(9))).toBeTruthy()
    expect(screen.queryByText(/\/6\)/)).toBeNull()
    world.services.labels.stop()
  })

  it('방송이 없을 때: 지금 문장 그대로 (n/6)', async () => {
    const { world, auto } = await open(false)
    expect(world.ble.keepReconnecting).toBe(false)
    await auto({ kind: 'trying', attempt: 3, total: 6 })
    expect(screen.getByText(autoReconnectingMessage(3, 6))).toBeTruthy()
    expect(screen.queryByText(/계속 해 봐요/)).toBeNull()
    world.services.labels.stop()
  })
})

describe('AppPrinter: 계속 잇기 · 연결 사실', () => {
  const facts: LinkFacts = { radio: 'on', app: 'active', leftAt: null, lost: null }
  const make = (read: (() => Promise<LinkFacts>) | null = async () => facts) => {
    const fake = createFakePrinter({ methods: ['bluetooth'] })
    const device = createReconnectingAdapter(fake, AUTO_RECONNECT_POLICY)
    const tests: { fake: ReturnType<typeof createFakePrinter>; adapter: ReturnType<typeof createReconnectingAdapter> }[] = []
    const printer = new AppPrinter({
      device,
      createTest: () => {
        const testFake = createFakePrinter({ methods: ['bluetooth'] })
        const adapter = createReconnectingAdapter(testFake, AUTO_RECONNECT_POLICY)
        tests.push({ fake: testFake, adapter })
        return adapter
      },
      ...(read === null ? {} : { facts: read }),
    })
    return { printer, fake, device, tests }
  }

  it('계속 잇기는 블루투스 프린터와 (나중에 만든) 시험용 프린터에 같이 넘어간다 — 끊기면 총 횟수 없이 잇는다', async () => {
    const { printer, fake, device, tests } = make()
    printer.setAutoReconnect(true)
    await printer.connect('bluetooth')
    // 방송이 없을 때: 6번까지
    fake.simulateDisconnect()
    expect(printer.autoReconnect).toEqual({ kind: 'trying', attempt: 1, total: 6 })
    // 방송이 열렸다: 총 횟수가 없어진다
    printer.setKeepReconnecting(true)
    expect(printer.autoReconnect).toEqual({ kind: 'trying', attempt: 1, total: null })
    // 시험용 프린터로 바꿔도(그때 만든다) 같은 값이 넘어가 있다
    await printer.selectTarget('test')
    expect(tests).toHaveLength(1)
    await printer.connect('bluetooth')
    tests[0]?.fake.simulateDisconnect()
    expect(printer.autoReconnect).toEqual({ kind: 'trying', attempt: 1, total: null })
    printer.setKeepReconnecting(false)
    expect(printer.autoReconnect).toEqual({ kind: 'trying', attempt: 1, total: 6 })
    device.dispose()
    tests[0]?.adapter.dispose()
  })

  it('연결 사실은 블루투스 프린터일 때만 — 시험용 프린터·읽기 실패·없음은 모름', async () => {
    const { printer } = make()
    expect(await printer.linkFacts()).toEqual(facts)
    await printer.selectTarget('test')
    expect(await printer.linkFacts()).toBeNull()
    expect(await make(null).printer.linkFacts()).toBeNull()
    expect(await make(async () => { throw new Error('x') }).printer.linkFacts()).toBeNull()
  })
})
