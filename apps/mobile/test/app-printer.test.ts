// 앱 프린터 (APP-03, L-11 8·15): 블루투스·시험용 두 방법을 한 어댑터처럼 — 방법 바꾸면 앞 방법을 끊고, 기억은 섞이지 않는다
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createReconnectingAdapter } from '@livejjim/mobile-ble'
import { createFakePrinter } from '@livejjim/printer'
import { AppPrinter } from '../src/native/app-printer.ts'

const make = () => {
  let made = 0
  const printer = new AppPrinter({
    device: createReconnectingAdapter(createFakePrinter()),
    createTest: () => {
      made += 1
      return createReconnectingAdapter(createFakePrinter())
    },
  })
  return { printer, made: () => made }
}

describe('AppPrinter', () => {
  it('처음에는 블루투스 방법이고 시험용 프린터는 만들지 않는다', () => {
    const { printer, made } = make()
    expect(printer.target).toBe('bluetooth')
    expect(made()).toBe(0)
  })

  it('시험용으로 바꾸면 그때 한 번 만들고, 앞 방법은 끊는다', async () => {
    const { printer, made } = make()
    expect((await printer.connect('bluetooth')).ok).toBe(true)
    expect(printer.state).toBe('CONNECTED')
    await printer.selectTarget('test')
    expect(made()).toBe(1)
    expect(printer.state).toBe('DISCONNECTED')
    await printer.selectTarget('bluetooth')
    expect(printer.state).toBe('DISCONNECTED')
    await printer.selectTarget('test')
    expect(made()).toBe(1)
  })

  it('블루투스 기억을 되살려도 시험용 기억과 섞이지 않는다', async () => {
    const { printer } = make()
    await printer.selectTarget('test')
    printer.restoreDeviceMemory({ method: 'bluetooth', deviceId: 'AA:BB' })
    expect(printer.remembered).toBeNull()
    await printer.selectTarget('bluetooth')
    expect(printer.remembered).toEqual({ method: 'bluetooth', deviceId: 'AA:BB' })
  })

  it('지금 고른 방법의 상태 바뀜만 알린다', async () => {
    const { printer } = make()
    const states: string[] = []
    printer.onStateChange((s) => states.push(s))
    await printer.connect('bluetooth')
    expect(states).toContain('CONNECTED')
  })
})
