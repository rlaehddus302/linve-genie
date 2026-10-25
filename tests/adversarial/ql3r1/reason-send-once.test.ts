// @vitest-environment jsdom
// QL3R1 적대 시험 (test-domain, 3회차): 위험 nit "보내기는 많아야 한 번 적대 시험은 구조상 늘 통과한다" 확인.
// 앞 시험(quick-reason-station-short.test.ts)은 보내면 창을 닫고, 창이 닫히면 남은 조작을 멈춘다. 같은 처리기 안에서 두 번 부르는
// 잘못은 잡지만(변이로 확인), 닫힌 뒤의 두 번째 누름·숫자 키 반복(repeat)·closeAll 빠짐은 시도조차 안 한다 — 지적이 절반 맞다.
// 이 파일은 그 빈틈을 두 쪽에서 막는다(변이 3개로 확인: onPicked 두 번 부르기, repeat 막기 지우기, closeAll 지우기 → 모두 실패).
// 1) 창을 닫지 않는 받는 쪽: 조작 하나마다 보낸 수가 0 또는 1이고 참조 모형과 같다(조작 하나가 두 번 보내면 실패).
//    숫자 키를 누르고 있어 반복된 입력(repeat)은 아무것도 하지 않는다(D-QL3R2-06 (2)).
// 2) 실제 openClaimAction + ConsolePage처럼 창 묶음을 state로 들고 closeAll이 비우는 받는 쪽:
//    빠른 사유를 누른 뒤 닫힌 창의 옛 단추를 다시 누르거나(휴대폰 두 번 누름) 숫자 키를 더 눌러도 5초 대기(queueHost)는 한 번뿐이다.
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

const DIALOGS_MODULE = '../../../apps/web/src/components/ActionDialogs.tsx'
const ACTIONS_MODULE = '../../../apps/web/src/components/actions.ts'
const UI_WORDS_MODULE = '../../../apps/web/src/lib/words.ts'
const REACT_MODULE = '../../../apps/web/node_modules/react/index.js'
const REACT_DOM_MODULE = '../../../apps/web/node_modules/react-dom/client.js'

interface ReasonSpec {
  readonly title: string
  readonly submitLabel: string
  readonly submitOnPick?: boolean
  readonly onSubmit: (reason: string) => void
}
type Element = unknown
interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element
  useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void]
  act(callback: () => void): void
}
interface Root {
  render(element: Element): void
  unmount(): void
}
interface HostNode {
  value: string
  innerHTML: string
  readonly textContent: string | null
  querySelector(selector: string): HostNode | null
  querySelectorAll(selector: string): Iterable<HostNode> & { readonly length: number }
  append(node: HostNode): void
  focus(): void
  click(): void
  dispatchEvent(event: unknown): boolean
}
interface DomGlobals {
  readonly document: { body: HostNode; createElement(tag: string): HostNode }
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
const keyOn = (react: ReactLike, target: HostNode, key: string, repeat = false) =>
  react.act(() => {
    target.dispatchEvent(new dom.KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }))
  })

type Step =
  | { readonly kind: 'pick'; readonly index: number }
  | { readonly kind: 'digit'; readonly key: string; readonly repeat: boolean }
  | { readonly kind: 'digitInField'; readonly key: string }
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'submit' }
  | { readonly kind: 'enter' }
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('pick' as const), index: fc.nat({ max: 3 }) }),
  fc.record({ kind: fc.constant('digit' as const), key: fc.constantFrom('1', '2', '3', '4', '5', '9'), repeat: fc.boolean() }),
  fc.record({ kind: fc.constant('digitInField' as const), key: fc.constantFrom('1', '2', '3', '4') }),
  fc.record({ kind: fc.constant('type' as const), text: fc.constantFrom('', '   ', '직접 적은 사유', ' 손님이 다시 산대요 ', '2 장난') }),
  fc.record({ kind: fc.constant('submit' as const) }),
  fc.record({ kind: fc.constant('enter' as const) }),
)

describe('TD-QL3R1 사유 창 보내기 한 번 (위험 nit 확인 — 창을 닫지 않아도)', () => {
  it('창을 닫지 않는 받는 쪽, 무작위 조작 400열: 조작 하나마다 보낸 수는 참조 모형과 같고(0 또는 1) 사유도 같다', async () => {
    const { ReasonDialog } = await load<{ ReasonDialog: unknown }>(DIALOGS_MODULE)
    const { QUICK_REASONS } = await load<{ QUICK_REASONS: readonly string[] }>(UI_WORDS_MODULE)
    const valueSetter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(step, { minLength: 1, maxLength: 12 }), async (submitOnPick, steps) => {
        const sent: string[] = []
        const spec: ReasonSpec = {
          title: '1번 밤톨맘 취소',
          submitLabel: '찜 취소하기',
          ...(submitOnPick ? { submitOnPick: true } : {}),
          // 닫지 않는다 — 조작 하나가 두 번 보내면 여기 두 개가 쌓인다
          onSubmit: (reason) => sent.push(reason),
        }
        const { host, react } = await draw((React) => React.createElement(ReasonDialog, { spec, onClose: () => {} }))
        const field = (): HostNode | null => host.querySelector('input')
        const expected: string[] = []
        let value = ''
        for (const action of steps) {
          const before = sent.length
          if (action.kind === 'pick') {
            const reason = QUICK_REASONS[action.index] ?? ''
            const pick = buttons(host).find((b) => b.textContent === `${String(action.index + 1)} ${reason}`)
            expect(pick, reason).toBeDefined()
            react.act(() => pick?.click())
            value = reason
            if (submitOnPick) expected.push(reason)
          } else if (action.kind === 'digit') {
            const close = buttons(host).find((b) => b.textContent === '닫기')
            close?.focus()
            keyOn(react, close ?? host, action.key, action.repeat)
            const index = Number(action.key) - 1
            if (!action.repeat && index >= 0 && index < QUICK_REASONS.length) {
              value = QUICK_REASONS[index] ?? ''
              if (submitOnPick) expected.push(value)
            }
          } else if (action.kind === 'digitInField') {
            const input = field()
            input?.focus()
            if (input !== null) keyOn(react, input, action.key)
          } else if (action.kind === 'type') {
            const input = field()
            input?.focus()
            react.act(() => {
              if (input !== null) valueSetter?.call(input, action.text)
              input?.dispatchEvent(new dom.Event('input', { bubbles: true }))
            })
            value = action.text
          } else {
            if (action.kind === 'submit') react.act(() => buttons(host).find((b) => b.textContent === '찜 취소하기')?.click())
            else {
              const input = field()
              input?.focus()
              if (input !== null) keyOn(react, input, 'Enter')
            }
            if (value.trim() !== '') expected.push(value.trim())
          }
          const label = JSON.stringify({ submitOnPick, steps, action })
          expect(sent.length - before, label).toBeLessThanOrEqual(1)
          expect(sent, label).toEqual(expected)
        }
        for (const root of mounted.splice(0)) root.unmount()
        document.body.innerHTML = ''
      }),
      { numRuns: 400 },
    )
  })

  it('실제 openClaimAction + closeAll로 비우는 창 묶음: 빠른 사유 뒤 옛 단추 다시 누르기·숫자 키·Enter를 해도 5초 대기는 한 번', async () => {
    const { ReasonDialog } = await load<{ ReasonDialog: unknown }>(DIALOGS_MODULE)
    const { openClaimAction } = await load<{ openClaimAction(api: unknown, claim: unknown, type: string): void }>(ACTIONS_MODULE)
    const { QUICK_REASONS } = await load<{ QUICK_REASONS: readonly string[] }>(UI_WORDS_MODULE)
    const claim = { id: 'c1', broadcast: 'b1', no: 1, product: 'p1', currentBuyer: 'buyer-1', variant: null, qty: 1, options: null }
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('host.cancel', 'host.reject'),
        fc.nat({ max: 3 }),
        fc.array(fc.oneof(fc.record({ again: fc.nat({ max: 3 }) }), fc.record({ key: fc.constantFrom('1', '2', '3', '4', 'Enter') })), { minLength: 1, maxLength: 6 }),
        async (type, first, after) => {
          const queued: { readonly event: Readonly<Record<string, unknown>> }[] = []
          let open: ((dialog: { kind: string; spec: ReasonSpec }) => void) | null = null
          let clear: (() => void) | null = null
          const api = {
            b: 'b1',
            data: { broadcasts: new Map() },
            names: { name: () => '밤톨맘' },
            openDialog: (dialog: { kind: string; spec: ReasonSpec }) => open?.(dialog),
            queueHost: (input: { readonly event: Readonly<Record<string, unknown>> }) => queued.push(input),
            closeAll: () => clear?.(),
            closeTop: () => clear?.(),
          }
          // ConsolePage처럼: 창 묶음은 state, closeAll은 비운다(apps/web/src/components/ConsolePage.tsx closeAll)
          function DialogHost(props: { React: ReactLike }) {
            const [dialogs, setDialogs] = props.React.useState<readonly { kind: string; spec: ReasonSpec }[]>([])
            open = (dialog) => setDialogs((stack) => [...stack, dialog])
            clear = () => setDialogs([])
            const top = dialogs.at(-1)
            return top === undefined ? null : props.React.createElement(ReasonDialog, { spec: top.spec, onClose: () => setDialogs([]) })
          }
          const { host, react } = await draw((React) => React.createElement(DialogHost, { React }))
          react.act(() => openClaimAction(api, claim, type))
          expect(host.querySelector('[role="dialog"]')).not.toBeNull()
          // 옛 단추·옛 칸을 쥐고 있는다 (휴대폰에서 두 번째 누름이 닿는 곳)
          const stale = buttons(host)
          const staleInput = host.querySelector('input')
          const staleDialog = host.querySelector('[role="dialog"]')
          const pick = (index: number) => stale.find((b) => b.textContent === `${String(index + 1)} ${QUICK_REASONS[index] ?? ''}`)
          react.act(() => pick(first)?.click())
          expect(queued).toHaveLength(1)
          expect(queued[0]?.event).toMatchObject({ type, reason: QUICK_REASONS[first] })
          expect(host.querySelector('[role="dialog"]')).toBeNull()
          for (const more of after) {
            if ('again' in more) react.act(() => pick(more.again)?.click())
            else if (more.key === 'Enter') {
              if (staleInput !== null) keyOn(react, staleInput, 'Enter')
            } else {
              keyOn(react, staleDialog ?? host, more.key)
              keyOn(react, document.body, more.key)
            }
          }
          expect(queued, JSON.stringify({ type, first, after })).toHaveLength(1)
          expect(host.querySelector('[role="dialog"]')).toBeNull()
          for (const root of mounted.splice(0)) root.unmount()
          document.body.innerHTML = ''
        },
      ),
      { numRuns: 200 },
    )
  })
})
