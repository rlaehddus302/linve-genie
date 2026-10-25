// @vitest-environment jsdom
// QL3R1 적대 시험 (test-domain): 이번 회차에서 화면 규칙이 바뀐 순수 함수·작은 화면 조각만 공격한다(나머지는 E2E 몫, D-QL3R1-09).
// 1) 출력 기기 끊김 짧은 문장 (D-QL3R1-04, AC-QL3R1-25·26)
//    - 무작위 StationLeadInput 2,000개: 짧은 문장은 stationLeadText가 deviceLostMessage(이름)일 때만 있고, 그때 참조 모형과 같다
//      ({이름}: Array.from 10낱자까지 그대로, 넘으면 앞 10 + "…"). 반쪽 서로게이트가 생기지 않는다.
//    - 경계: 10낱자(그대로)·11낱자(10 + "…")·20낱자(DEVICE_NAME_MAX)·이모지(서로게이트 쌍)·결합 자모
//    - 알림 띠(AlertStrip): 접힌 동안만 짧은 줄 단추가 있고 누르면 긴 줄과 같은 곳, 펼치면 사라진다. 위험한 이름은 HTML 요소 0개, 글자 그대로.
// 2) 찜 취소·무효 빠른 사유 (D-QL3R1-05, AC-QL3R1-30~32)
//    - openClaimAction: 취소·무효는 submitOnPick, 1등으로 올리기는 아님. 고른 사유가 그대로 이벤트 사유로, 5초 대기(queueHost) 한 번 + 창 모두 닫기
//    - 사유 창 무작위 조작 열(빠른 사유 누르기·창 안 숫자 키·사유 칸에서 숫자 키·글 치기·보내기·Enter) 500개를 참조 모형과 대조:
//      보내는 것은 많아야 한 번, 보낸 사유는 모형과 같다. submitOnPick이 없는 창(차단 등)은 빠른 사유로는 절대 보내지 않는다.
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

const WORDS_MODULE = '../../../apps/web/src/lib/print-words.ts'
const DEVICE_MODULE = '../../../apps/web/src/lib/device.ts'
const ALERT_MODULE = '../../../apps/web/src/components/AlertStrip.tsx'
const DIALOGS_MODULE = '../../../apps/web/src/components/ActionDialogs.tsx'
const ACTIONS_MODULE = '../../../apps/web/src/components/actions.ts'
const UI_WORDS_MODULE = '../../../apps/web/src/lib/words.ts'
const REACT_MODULE = '../../../apps/web/node_modules/react/index.js'
const REACT_DOM_MODULE = '../../../apps/web/node_modules/react-dom/client.js'

interface Device {
  readonly id: string
  readonly name: string
  readonly live: boolean
  readonly releasing: boolean
}
interface StationInput {
  readonly labelsOn: boolean | null
  readonly rehearsal: boolean
  readonly ended: boolean
  readonly mine: boolean
  readonly queue: { readonly device: Device | null; readonly waiting: number; readonly printing: number; readonly paused: null } | null
}
interface WordsModule {
  readonly DEVICE_SHORT_NAME_MAX: number
  deviceLostMessage(name: string): string
  deviceLostShortMessage(name: string): string
  stationLeadText(input: StationInput): string | null
  stationLeadShortText(input: StationInput): string | null
  readonly NO_STATION_PILING: string // QL3R2 D-QL3R2-03
  readonly NO_STATION_SHORT: string // QL3R2 D-QL3R2-03
}
interface DeviceModule {
  readonly DEVICE_NAME_MAX: number
  cleanDeviceName(value: string): string | null
}
interface ReasonSpec {
  readonly title: string
  readonly submitLabel: string
  readonly submitOnPick?: boolean
  readonly onSubmit: (reason: string) => void
}

type Element = unknown
interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element
  useState<T>(initial: T): [T, (next: T) => void]
  act(callback: () => void): void
}
interface Root {
  render(element: Element): void
  unmount(): void
}
interface HostNode {
  innerHTML: string
  value: string
  readonly textContent: string | null
  readonly tagName: string
  querySelector(selector: string): HostNode | null
  querySelectorAll(selector: string): Iterable<HostNode> & { readonly length: number }
  append(node: HostNode): void
  focus(): void
  click(): void
  dispatchEvent(event: unknown): boolean
}
interface DomGlobals {
  readonly document: { body: HostNode; activeElement: HostNode | null; createElement(tag: string): HostNode }
  readonly KeyboardEvent: new (type: string, init: Record<string, unknown>) => unknown
  readonly Event: new (type: string, init: Record<string, unknown>) => unknown
  readonly HTMLInputElement: { readonly prototype: object }
}
const dom = globalThis as unknown as DomGlobals
const document = dom.document

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T

const mounted: Root[] = []
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

async function draw(element: (react: ReactLike) => Element): Promise<{ host: HostNode; react: ReactLike }> {
  const React = await load<ReactLike>(REACT_MODULE)
  const { createRoot } = await load<{ createRoot(node: HostNode): Root }>(REACT_DOM_MODULE)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push(root)
  React.act(() => root.render(element(React)))
  return { host, react: React }
}

const buttons = (host: HostNode): HostNode[] => [...host.querySelectorAll('button')]
const injected = (host: HostNode): number => host.querySelectorAll('script, img, b, svg, iframe, [onerror], [onload]').length

/** 참조 모형: D-QL3R1-04 (1) — {이름}은 10낱자(Array.from) 넘으면 앞 10 + "…" */
const shortName = (name: string): string => {
  const letters = Array.from(name)
  return letters.length > 10 ? `${letters.slice(0, 10).join('')}…` : name
}
const expectedShort = (name: string): string => `라벨이 안 나가요 · '${shortName(name)}' 화면을 켜 주세요`
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

const NASTY = ['<b>PC</b>', '<script>x()</script>', '<img src onerror=a>', '&lt;b&gt;폰', '"><svg onload=x>', '🌵 다육이 폰 🌵', '{{7*7}} ${x}']

describe('TD-QL3R1 출력 기기 끊김 짧은 문장 (D-QL3R1-04)', () => {
  it('상한 상수와 경계: 10낱자는 그대로, 11낱자는 앞 10 + "…", 20낱자·이모지·결합 자모', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    expect(words.DEVICE_SHORT_NAME_MAX).toBe(10)
    expect(words.deviceLostShortMessage('PC')).toBe("라벨이 안 나가요 · 'PC' 화면을 켜 주세요")
    expect(words.deviceLostShortMessage('가나다라마바사아자차')).toBe("라벨이 안 나가요 · '가나다라마바사아자차' 화면을 켜 주세요")
    expect(words.deviceLostShortMessage('가나다라마바사아자차카')).toBe("라벨이 안 나가요 · '가나다라마바사아자차…' 화면을 켜 주세요")
    expect(words.deviceLostShortMessage('12345678901234567890')).toBe("라벨이 안 나가요 · '1234567890…' 화면을 켜 주세요")
    // 이모지 11개(서로게이트 쌍 22 코드 단위) — 낱자로 세어 10개 + "…", 반쪽 글자 없음
    const cacti = '🌵'.repeat(11)
    const out = words.deviceLostShortMessage(cacti)
    expect(out).toBe(`라벨이 안 나가요 · '${'🌵'.repeat(10)}…' 화면을 켜 주세요`)
    expect(loneSurrogate.test(out)).toBe(false)
    // 정확히 10 이모지는 줄이지 않는다(코드 단위 20개여도)
    expect(words.deviceLostShortMessage('🌵'.repeat(10))).toBe(`라벨이 안 나가요 · '${'🌵'.repeat(10)}' 화면을 켜 주세요`)
  })

  const deviceName = fc.oneof(
    fc.constantFrom('PC', '아이폰', '안드로이드 폰', '휴대폰', '휴대폰 2', '매장 노트북 (포장대 옆)', '가나다라마바사아자차', '가나다라마바사아자차카', '🌵'.repeat(11), ...NASTY),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.array(fc.constantFrom('가', '🌵', 'a', ' ', '<', '…', '👍🏻'), { minLength: 1, maxLength: 14 }).map((parts) => parts.join('')),
  )
  const device = fc.record({ id: fc.constantFrom('dev-1', 'dev-2'), name: deviceName, live: fc.boolean(), releasing: fc.boolean() })
  const input = fc.record({
    labelsOn: fc.constantFrom<boolean | null>(true, true, false, null),
    rehearsal: fc.boolean(),
    ended: fc.boolean(),
    mine: fc.boolean(),
    queue: fc.option(
      fc.record({ device: fc.option(device, { nil: null }), waiting: fc.nat({ max: 5 }), printing: fc.nat({ max: 2 }), paused: fc.constant(null) }),
      { nil: null },
    ),
  })

  it('무작위 2,000개: 짧은 문장은 긴 문장이 끊김 문장일 때만, 내용은 참조 모형과 같다', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    fc.assert(
      fc.property(input, (station) => {
        const long = words.stationLeadText(station)
        const short = words.stationLeadShortText(station)
        const lost = station.queue?.device ?? null
        const isLost = lost !== null && long === words.deviceLostMessage(lost.name) && !lost.live
        // QL3R2 D-QL3R2-03: 출력 기기 없음 + 대기 라벨도 짧은 줄 — 긴 문장이 NO_STATION_PILING일 때만, 정확히 그 짧은 문장
        if (long === words.NO_STATION_PILING) {
          expect(short).toBe('라벨이 안 나가요 · 라벨 화면에서 프린터를 연결해 주세요') // QL3R2 D-QL3R2-03
          return
        }
        if (!isLost) {
          expect(short).toBeNull()
          return
        }
        expect(short).toBe(expectedShort(lost.name))
        expect(loneSurrogate.test(short ?? '')).toBe(false)
        // 짧은 문장이 있으면 긴 문장(펼친 띠·PC 쪽)은 BASE 그대로
        expect(long).toBe(words.deviceLostMessage(lost.name))
      }),
      { numRuns: 2000 },
    )
  })

  it('cleanDeviceName을 지난 이름(1~20자)은 늘 "…" 앞까지 원래 이름의 앞부분이다', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    const deviceModule = await load<DeviceModule>(DEVICE_MODULE)
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (raw) => {
        const name = deviceModule.cleanDeviceName(raw)
        if (name === null) return
        const out = words.deviceLostShortMessage(name)
        const inner = out.slice("라벨이 안 나가요 · '".length, -"' 화면을 켜 주세요".length)
        const cut = inner.endsWith('…') && Array.from(name).length > 10
        const kept = cut ? inner.slice(0, -1) : inner
        expect(name.startsWith(kept)).toBe(true)
        expect(Array.from(kept).length).toBeLessThanOrEqual(10)
        expect(cut || kept === name).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it('알림 띠: 접힌 동안만 짧은 줄 단추, 누르면 긴 줄과 같은 곳, 펼치면 사라짐 — 위험한 이름은 글자 그대로', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    const { AlertStrip } = await load<{ AlertStrip: unknown }>(ALERT_MODULE)
    const counts = { conflict: 0, cancelRequest: 0, succession: 0, pending: 1, attention: 0 }
    for (const name of [...NASTY, 'PC', '매장노트북포장대옆두번째']) {
      for (const expanded of [false, true]) {
        const station: StationInput = {
          labelsOn: true,
          rehearsal: false,
          ended: false,
          mine: false,
          queue: { device: { id: 'dev-1', name, live: false, releasing: false }, waiting: 2, printing: 0, paused: null },
        }
        const text = words.stationLeadText(station)
        const shortText = words.stationLeadShortText(station)
        expect(text).not.toBeNull()
        expect(shortText).not.toBeNull()
        let pressed = 0
        const { host, react } = await draw((React) =>
          React.createElement(AlertStrip, {
            leads: [{ key: 'print-station', text, shortText, soft: true, uncounted: true, onClick: () => (pressed += 1) }],
            counts,
            expanded,
            onOpen: () => {},
            onToggle: () => {},
          }),
        )
        expect(injected(host), name).toBe(0)
        const long = buttons(host).find((b) => b.textContent === text)
        const short = buttons(host).find((b) => b.textContent === shortText)
        if (expanded) {
          expect(long, `${name} 긴 줄`).toBeDefined() // QL3R2 D-QL3R2-02: 긴 줄은 펼친 띠·PC에만
          expect(short, `${name} 펼친 띠엔 짧은 줄 없음`).toBeUndefined()
          continue
        }
        expect(long, `${name} 접힌 띠엔 긴 줄 없음`).toBeUndefined() // QL3R2 D-QL3R2-02 (1) 이중 표시 없음
        expect(short, `${name} 접힌 띠의 짧은 줄`).toBeDefined()
        // 짧은 줄은 "알림" 영역 밖(접힌 한 줄 높이·항목 수가 BASE와 같게 — AC-MOB1-13)
        expect(host.querySelector('section[aria-label="알림"]')?.textContent?.includes(shortText ?? '')).toBe(false)
        react.act(() => short?.click())
        expect(pressed, name).toBe(1) // QL3R2 D-QL3R2-02: 접힌 띠에는 짧은 줄 하나뿐
        for (const root of mounted.splice(0)) root.unmount()
        document.body.innerHTML = ''
      }
    }
  })
})

// ── 찜 취소·무효 빠른 사유 ─────────────────────────────────────────────

interface Opened {
  readonly kind: string
  readonly spec: ReasonSpec
}
interface Queued {
  readonly label: string
  readonly event: Readonly<Record<string, unknown>>
  readonly claims?: readonly string[]
}

function fakeApi() {
  const opened: Opened[] = []
  const queued: Queued[] = []
  let closedAll = 0
  const api = {
    b: 'b1',
    data: { broadcasts: new Map() },
    names: { name: () => '밤톨맘' },
    openDialog: (dialog: Opened) => opened.push(dialog),
    queueHost: (input: Queued) => queued.push(input),
    closeAll: () => (closedAll += 1),
    closeTop: () => {},
  }
  return { api, opened, queued, closed: () => closedAll }
}

const claim = {
  id: 'c1',
  broadcast: 'b1',
  no: 1,
  product: 'p1',
  currentBuyer: 'buyer-1',
  variant: null,
  qty: 1,
  options: null,
}

describe('TD-QL3R1 찜 취소·무효 빠른 사유 (D-QL3R1-05)', () => {
  it('openClaimAction: 취소·무효는 고르면 보냄, 1등으로 올리기는 아님 — 보낸 사유가 이벤트 사유, 대기 한 번·창 모두 닫기', async () => {
    const { openClaimAction } = await load<{ openClaimAction(api: unknown, claim: unknown, type: string): void }>(ACTIONS_MODULE)
    for (const [type, submitOnPick, title, label] of [
      ['host.cancel', true, '1번 밤톨맘 취소', '찜 취소하기'],
      ['host.reject', true, '1번 밤톨맘 무효', '무효로 하기'],
      ['host.promote', false, '1번 밤톨맘 1등으로', '1등으로 올리기'],
    ] as const) {
      const { api, opened, queued, closed } = fakeApi()
      openClaimAction(api, claim, type)
      expect(opened).toHaveLength(1)
      const spec = opened[0]?.spec
      expect(opened[0]?.kind).toBe('reason')
      expect(spec?.title).toBe(title)
      expect(spec?.submitLabel).toBe(label)
      expect(spec?.submitOnPick === true, type).toBe(submitOnPick)
      spec?.onSubmit('시청자 요청')
      expect(queued).toHaveLength(1)
      expect(queued[0]?.event).toMatchObject({ type, b: 'b1', no: 1, buyer: 'buyer-1', reason: '시청자 요청' })
      expect(queued[0]?.claims).toEqual(['c1'])
      expect(closed()).toBe(1)
    }
  })

  type Step =
    | { readonly kind: 'pick'; readonly index: number }
    | { readonly kind: 'digit'; readonly key: string }
    | { readonly kind: 'digitInField'; readonly key: string }
    | { readonly kind: 'type'; readonly text: string }
    | { readonly kind: 'submit' }
    | { readonly kind: 'enter' }
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant('pick' as const), index: fc.nat({ max: 3 }) }),
    fc.record({ kind: fc.constant('digit' as const), key: fc.constantFrom('1', '2', '3', '4', '5', '9', '0') }),
    fc.record({ kind: fc.constant('digitInField' as const), key: fc.constantFrom('1', '2', '3', '4') }),
    fc.record({ kind: fc.constant('type' as const), text: fc.constantFrom('', '   ', '1', '직접 적은 사유', ' 손님이 다시 산대요 ', '2 장난') }),
    fc.record({ kind: fc.constant('submit' as const) }),
    fc.record({ kind: fc.constant('enter' as const) }),
  )

  it('사유 창 무작위 조작 500열: 보내기는 많아야 한 번, 사유는 참조 모형과 같다 (고르면 보냄 / 그대로 두 경우)', async () => {
    const { ReasonDialog } = await load<{ ReasonDialog: unknown }>(DIALOGS_MODULE)
    const { QUICK_REASONS } = await load<{ QUICK_REASONS: readonly string[] }>(UI_WORDS_MODULE)
    expect(QUICK_REASONS).toEqual(['시청자 요청', '장난 찜', '번호 착오', '입금 안 함'])
    const valueSetter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(step, { minLength: 1, maxLength: 8 }), async (submitOnPick, steps) => {
        const sent: string[] = []
        // 창을 연 쪽(콘솔)처럼 보내면 창을 닫는다(api.closeAll)
        function Holder(props: { React: ReactLike }) {
          const [open, setOpen] = props.React.useState(true)
          if (!open) return null
          const spec: ReasonSpec = {
            title: '1번 밤톨맘 취소',
            submitLabel: '찜 취소하기',
            ...(submitOnPick ? { submitOnPick: true } : {}),
            onSubmit: (reason) => {
              sent.push(reason)
              setOpen(false)
            },
          }
          return props.React.createElement(ReasonDialog, { spec, onClose: () => setOpen(false) })
        }
        const { host, react } = await draw((React) => React.createElement(Holder, { React }))
        // 참조 모형
        let value = ''
        let expected: string | null = null
        const dialog = (): HostNode | null => host.querySelector('[role="dialog"]')
        const field = (): HostNode | null => host.querySelector('input')
        const submitButton = (): HostNode | undefined => buttons(host).find((b) => b.textContent === '찜 취소하기')
        const keyOn = (target: HostNode, key: string) =>
          react.act(() => {
            target.dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
          })
        for (const action of steps) {
          if (dialog() === null) break
          const done = expected !== null
          expect(done).toBe(false)
          if (action.kind === 'pick') {
            const reason = QUICK_REASONS[action.index] ?? ''
            const pick = buttons(host).find((b) => b.textContent === `${String(action.index + 1)} ${reason}`)
            expect(pick, reason).toBeDefined()
            react.act(() => pick?.click())
            value = reason
            if (submitOnPick) expected = reason
          } else if (action.kind === 'digit') {
            // 창 안, 글 칸 밖(닫기 단추)에서 숫자 키
            const close = buttons(host).find((b) => b.textContent === '닫기')
            close?.focus()
            keyOn(close ?? host, action.key)
            const index = Number(action.key) - 1
            if (index >= 0 && index < QUICK_REASONS.length) {
              value = QUICK_REASONS[index] ?? ''
              if (submitOnPick) expected = value
            }
          } else if (action.kind === 'digitInField') {
            // 사유 칸에서 숫자 키는 글자가 들어가는 키 — 보내지 않는다(이 시험은 keydown만 보내므로 칸 값은 그대로)
            const input = field()
            input?.focus()
            if (input !== null) keyOn(input, action.key)
          } else if (action.kind === 'type') {
            const input = field()
            input?.focus()
            react.act(() => {
              if (input !== null) valueSetter?.call(input, action.text)
              input?.dispatchEvent(new dom.Event('input', { bubbles: true }))
            })
            value = action.text
          } else if (action.kind === 'submit' || action.kind === 'enter') {
            if (action.kind === 'submit') react.act(() => submitButton()?.click())
            else {
              const input = field()
              input?.focus()
              if (input !== null) keyOn(input, 'Enter')
            }
            if (value.trim() !== '') expected = value.trim()
          }
          expect(sent, JSON.stringify({ submitOnPick, steps })).toEqual(expected === null ? [] : [expected])
          if (expected !== null) expect(dialog()).toBeNull()
          else if (sent.length === 0 && (action.kind === 'submit' || action.kind === 'enter')) {
            expect(host.textContent?.includes('사유를 적어 주세요.')).toBe(true)
          }
        }
        // 고르면 보냄이 아닌 창은 빠른 사유·숫자 키만으로는 절대 보내지 않는다 (AC-QL3R1-32)
        if (!submitOnPick && steps.every((s) => s.kind === 'pick' || s.kind === 'digit' || s.kind === 'digitInField')) expect(sent).toEqual([])
        for (const root of mounted.splice(0)) root.unmount()
        document.body.innerHTML = ''
      }),
      { numRuns: 500 },
    )
  })
})
