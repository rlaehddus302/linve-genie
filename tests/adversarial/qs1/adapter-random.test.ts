// QS1 적대 시험 (test-domain): B1 어댑터의 세 길(연결 방법 연결·"다시 연결"·기억한 기기로만 잇기)에 블루투스·USB, 끊김·뽑기·다시 꽂기,
// getDevices·getPorts 있음/없음/예외, 새로고침(새 어댑터 + 기억 값)을 아무렇게나 섞는 속성 시험 (AC-QS1-01~05·30, D-QS1-01).
// 지키는 것: 기억한 기기로만 잇기는 requestDevice·requestPort를 한 번도 부르지 않는다 · 같은 때 연결 시도는 하나 ·
// 기억 값에는 연결 방법과 기기 ID·USB 번호만 · 오류 상세는 쉬운 말 고정 문장뿐.
import {
  RETRIED_TIMEOUT_DETAIL,
  TIMEOUT_DETAIL,
  combineNiimbotFakes,
  createB1Adapter,
  createFakeNiimbotBluetooth,
  createFakeNiimbotSerial,
  type NiimbotClientLike,
  type PrinterEnvironment,
  type PrinterResult,
  type RememberedPrinter,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ManualTimer, flush } from './station-helpers.ts'

type Op =
  | { readonly k: 'connect' | 'reconnect'; readonly m: 'bluetooth' | 'serial'; readonly wait: boolean }
  | { readonly k: 'remembered'; readonly wait: boolean }
  | { readonly k: 'disconnect' }
  | { readonly k: 'drop' }
  | { readonly k: 'unplug' | 'plug' }
  | { readonly k: 'getDevices'; readonly mode: boolean | 'throws' }
  | { readonly k: 'getPorts'; readonly mode: boolean | 'throws' }
  | { readonly k: 'power'; readonly on: boolean }
  | { readonly k: 'unanswered'; readonly n: number }
  | { readonly k: 'reload' }
  | { readonly k: 'advance'; readonly ms: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constantFrom('connect' as const, 'reconnect' as const), m: fc.constantFrom('bluetooth' as const, 'serial' as const), wait: fc.boolean() }),
  { weight: 2, arbitrary: fc.record({ k: fc.constant('remembered' as const), wait: fc.boolean() }) },
  fc.constant({ k: 'disconnect' as const }),
  fc.constant({ k: 'drop' as const }),
  fc.constantFrom({ k: 'unplug' as const }, { k: 'plug' as const }),
  fc.record({ k: fc.constant('getDevices' as const), mode: fc.constantFrom(true, false, 'throws' as const) }),
  fc.record({ k: fc.constant('getPorts' as const), mode: fc.constantFrom(true, false, 'throws' as const) }),
  fc.record({ k: fc.constant('power' as const), on: fc.boolean() }),
  fc.record({ k: fc.constant('unanswered' as const), n: fc.integer({ min: 0, max: 2 }) }),
  fc.constant({ k: 'reload' as const }),
  fc.record({ k: fc.constant('advance' as const), ms: fc.constantFrom(0, 500, 1000, 1500, 3000) }),
)

const okDetail = (detail: string | undefined) => detail === undefined || detail === TIMEOUT_DETAIL || detail === RETRIED_TIMEOUT_DETAIL || detail.startsWith('모델: ')

describe('B1 어댑터 세 길 속성 시험 (AC-QS1-30 (1)(2))', () => {
  it('기억한 기기로만 잇기는 고르기 창을 부르지 않고, 연결 시도는 같은 때 하나, 기억 값은 방법·ID·번호만', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 40 }), async (ops) => {
        const timer = new ManualTimer()
        const bt = createFakeNiimbotBluetooth({ timer, negotiationTimeoutMs: 1000 })
        const usb = createFakeNiimbotSerial({})
        const fakes = combineNiimbotFakes(bt, usb)
        const violations: string[] = []
        /** 고르기 창이 떠도 되는 판매자 동작(연결 방법·다시 연결)이 진행 중인 수 */
        let pickerAllowed = 0
        /**
         * 같은 때 연결 시도 수 — 페이지(어댑터)마다 센다. 새로고침(reload)은 옛 페이지의 자바스크립트를 통째로 없애므로 옛 어댑터가 하던 시도는
         * 진짜 브라우저에선 남지 않는다. 이 흉내에선 옛 시도가 시계를 따라 계속 돌 뿐이라 새 페이지의 시도와 겹쳐 세면 거짓 위반이 된다
         * (seed 1094365619 반례: 대답 없는 협상 1번 → 연결 → 새로고침 → 연결). AC-QS1-30 (1)은 한 페이지 안의 시도다(D-QS1-01 (3) 새로고침 뒤는 새 어댑터).
         */
        let generation = 0
        const active = new Map<number, number>()
        const real = fakes.environment
        const env: PrinterEnvironment = {
          bluetooth: {
            requestDevice: (o: unknown) => {
              if (pickerAllowed === 0) violations.push('기억한 기기로만 잇기에서 requestDevice')
              return (real.bluetooth?.requestDevice as (o: unknown) => Promise<unknown>)(o)
            },
            getAvailability: () => Promise.resolve(true),
            get getDevices() {
              return real.bluetooth?.getDevices
            },
          },
          serial: {
            requestPort: () => {
              if (pickerAllowed === 0) violations.push('기억한 기기로만 잇기에서 requestPort')
              return (real.serial?.requestPort as () => Promise<unknown>).call(real.serial)
            },
            get getPorts() {
              const f = real.serial?.getPorts
              return f === undefined ? undefined : () => f.call(real.serial)
            },
          },
        }
        const wrap = (client: NiimbotClientLike, page: number): NiimbotClientLike => ({
          async connect(options) {
            active.set(page, (active.get(page) ?? 0) + 1)
            if ((active.get(page) ?? 0) > 1) violations.push('같은 때 연결 시도 둘')
            try {
              return await client.connect(options)
            } finally {
              active.set(page, (active.get(page) ?? 0) - 1)
            }
          },
          disconnect: () => client.disconnect(),
          isConnected: () => client.isConnected(),
          getModelMetadata: () => client.getModelMetadata(),
          on: (e, l) => client.on(e, l),
          off: (e, l) => client.off(e, l),
          get protocol() {
            return client.protocol
          },
        })
        let stored: RememberedPrinter | null = null
        const make = (): RememberingPrinterAdapter => {
          const page = ++generation
          const a = createB1Adapter({ environment: () => env, createClient: (m) => wrap(fakes.createClient(m), page), timer })
          a.restoreRemembered(stored)
          a.onRememberedChange((v) => {
            stored = v
          })
          return a
        }
        let adapter = make()
        const pending: Promise<unknown>[] = []
        const check = (result: PrinterResult) => {
          if (!result.ok && !okDetail(result.error.detail)) violations.push(`상세 ${String(result.error.detail)}`)
        }
        for (const op of ops) {
          switch (op.k) {
            case 'connect':
            case 'reconnect': {
              pickerAllowed++
              const p = (op.k === 'connect' ? adapter.connect(op.m) : adapter.reconnect(op.m)).then(check).finally(() => {
                pickerAllowed--
              })
              pending.push(p)
              if (op.wait) {
                let done = false
                void p.finally(() => (done = true))
                for (let i = 0; i < 10 && !done; i++) await timer.advance(500)
              }
              break
            }
            case 'remembered': {
              // 판매자 동작이 진행 중이면 같은 시도를 함께 기다릴 수 있으니(그 시도는 고르기 창을 띄울 수 있다) 아무것도 진행 중이지 않을 때만 센다
              if (pickerAllowed > 0) break
              const p = adapter.connectRemembered().then(check)
              pending.push(p)
              if (op.wait) {
                let done = false
                void p.finally(() => (done = true))
                for (let i = 0; i < 10 && !done; i++) await timer.advance(500)
              }
              break
            }
            case 'disconnect':
              await adapter.disconnect()
              break
            case 'drop':
              bt.disconnect()
              break
            case 'unplug':
              usb.unplug(0)
              break
            case 'plug':
              usb.plug(0)
              break
            case 'getDevices':
              bt.setGetDevices(op.mode)
              break
            case 'getPorts':
              usb.setGetPorts(op.mode)
              break
            case 'power':
              bt.setPowered(op.on)
              break
            case 'unanswered':
              bt.setUnansweredNegotiations(op.n)
              break
            case 'reload':
              await adapter.disconnect()
              adapter = make()
              break
            case 'advance':
              await timer.advance(op.ms)
              break
          }
          await flush(1)
          // 기억 값: 방법·ID·번호만
          if (stored !== null) {
            const keys = Object.keys(stored).sort().join(',')
            if (keys !== 'deviceId,method' && keys !== 'method,usbProductId,usbVendorId') violations.push(`기억 값 칸 ${keys}`)
            if (JSON.stringify(stored).includes('B1-FAKE')) violations.push('기억 값에 기기 이름')
          }
        }
        await adapter.disconnect()
        for (let i = 0; i < 20; i++) await timer.advance(1000)
        await Promise.allSettled(pending)
        expect(violations).toEqual([])
      }),
      {
        numRuns: 80,
        // 고정 반례(전체 verify seed 1094365619): 새로고침 앞뒤 시도를 한 페이지 것처럼 세던 거짓 위반 — 늘 함께 돈다
        examples: [[[{ k: 'unanswered', n: 1 }, { k: 'connect', m: 'bluetooth', wait: false }, { k: 'reload' }, { k: 'connect', m: 'bluetooth', wait: false }, { k: 'unanswered', n: 0 }]]],
      },
    )
  })
})
