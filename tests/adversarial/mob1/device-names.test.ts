// @vitest-environment jsdom
// MOB1 적대 시험 (test-domain): 기기 이름 (AC-MOB1-89, D-MOB1-08·13, AC-MOB1-12~14·24).
// - 문장 이스케이프: 기기 이름(다듬은 뒤 1~20자)에 `<script>`·`<img onerror>`·`&lt;`·RTL 글자 → 출력 기기 끊김 문장이 든 화면 조각
//   (콘솔 알림 띠 AlertStrip, 포장 접수 결과 PackingPrintResult — 웹 컴포넌트를 jsdom에 그려서)에 HTML로 해석된 요소 0개, 글자 그대로.
// - 기본 기기 이름: 무작위 사용자 에이전트 1,000개 × 출력 기기 이름(같음·다름·없음) → 결과는 늘 네 기본 이름 또는 그 뒤 " 2",
//   길이 1~20자, cleanDeviceName 결과와 같다. 같은 이름(다듬으면 같은 이름 포함)이면 " 2", 아니면 기본 이름 그대로.
//
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(s05/console-store-race.test.ts와 같은 까닭). React도 웹 앱의 것을 쓴다(같은 사본).
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

const DEVICE_MODULE = '../../../apps/web/src/lib/device.ts'
const WORDS_MODULE = '../../../apps/web/src/lib/print-words.ts'
const ALERT_MODULE = '../../../apps/web/src/components/AlertStrip.tsx'
const PACKING_MODULE = '../../../apps/web/src/components/PackingPrint.tsx'
const PRINT_CONTEXT_MODULE = '../../../apps/web/src/components/print-context.tsx'
const REACT_MODULE = '../../../apps/web/node_modules/react/index.js'
const REACT_DOM_MODULE = '../../../apps/web/node_modules/react-dom/client.js'

interface DeviceModule {
  readonly DEFAULT_DEVICE_NAMES: { readonly iphone: string; readonly android: string; readonly phone: string; readonly pc: string }
  readonly DEVICE_NAME_MAX: number
  defaultDeviceName(input: { userAgent: string; narrow: boolean; otherStation: string | null }): string
  cleanDeviceName(value: string): string | null
}
interface WordsModule {
  deviceLostMessage(name: string): string
  stationLeadText(input: { labelsOn: boolean | null; rehearsal: boolean; ended: boolean; mine: boolean; queue: unknown }): string | null
}
type Element = unknown
interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element
  act(callback: () => void): void
}
interface Root {
  render(element: Element): void
  unmount(): void
}

const load = async <T,>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T

/** 다듬은 뒤 1~20자가 되는 위험한 이름 */
const NASTY = [
  '<script>x()</script>',
  '<img src onerror=a>',
  '<b>폰</b>',
  '&lt;b&gt;폰&lt;/b&gt;',
  '&amp;&#60;',
  '\u202e폰 이드로드안',
  '\u202bسلام فون',
  '"><svg onload=x>',
  "'); alert(1); ('",
  '<iframe src=//e>',
  '{{7*7}} ${x}',
  '🌵 다육이 폰 🌵',
]

// React 19 act 환경 표시 (경고 없이 act로 그린다)
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 루트 타입 검사는 DOM 타입 없이 돈다 — 쓰는 만큼만 적는다
interface HostNode {
  innerHTML: string
  readonly textContent: string | null
  querySelectorAll(selector: string): Iterable<HostNode> & { readonly length: number }
  append(node: HostNode): void
}
const document = (globalThis as unknown as { document: { body: HostNode; createElement(tag: string): HostNode } }).document
type HTMLElement = HostNode

const mounted: Root[] = []
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

async function draw(element: (react: ReactLike) => Element): Promise<HTMLElement> {
  const React = await load<ReactLike>(REACT_MODULE)
  const { createRoot } = await load<{ createRoot(node: HTMLElement): Root }>(REACT_DOM_MODULE)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push(root)
  React.act(() => root.render(element(React)))
  return host
}

/** 컴포넌트가 스스로 그리는 태그 말고 이름에서 나온 요소가 있는가 */
const injected = (host: HTMLElement): number => host.querySelectorAll('script, img, b, svg, iframe, [onerror], [onload]').length

describe('AC-MOB1-89 기기 이름 문장 이스케이프', () => {
  it('위험한 이름 12개 모두 cleanDeviceName을 지나고(1~20자), 끊김 문장에 글자 그대로 들어간다', async () => {
    const device = await load<DeviceModule>(DEVICE_MODULE)
    const words = await load<WordsModule>(WORDS_MODULE)
    for (const raw of NASTY) {
      const name = device.cleanDeviceName(raw)
      expect(name, raw).not.toBeNull()
      const text = words.deviceLostMessage(name ?? '')
      expect(text.startsWith(`출력 기기('${name ?? ''}')가 연결되어 있지 않아요.`), raw).toBe(true)
    }
  })

  it('콘솔 알림 띠(AlertStrip) 맨 앞 항목: HTML 요소 0개, 버튼 글이 문장 그대로', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    const device = await load<DeviceModule>(DEVICE_MODULE)
    const { AlertStrip } = await load<{ AlertStrip: unknown }>(ALERT_MODULE)
    const counts = { conflict: 0, cancelRequest: 0, succession: 0, pending: 0, attention: 0 }
    for (const raw of NASTY) {
      const name = device.cleanDeviceName(raw) ?? ''
      const text = words.stationLeadText({
        labelsOn: true,
        rehearsal: false,
        ended: false,
        mine: false,
        queue: { device: { id: 'other-device-1', name, live: false, releasing: false }, waiting: 2, printing: 0, paused: null },
      })
      expect(text, raw).toBe(words.deviceLostMessage(name))
      const host = await draw((React) =>
        React.createElement(AlertStrip, { leads: [{ key: 'print-station', text, soft: true, uncounted: true, onClick: () => {} }], counts, onOpen: () => {}, onToggle: () => {} }),
      )
      expect(injected(host), raw).toBe(0)
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text)
      expect(button, raw).toBeDefined()
      expect(host.innerHTML.includes(name) && /[<>&]/.test(name), raw).toBe(false)
    }
  })

  it('포장 접수 결과(PackingPrintResult): 끊긴 출력 기기 이름이 HTML 요소 0개, 안내 문장 그대로', async () => {
    const words = await load<WordsModule>(WORDS_MODULE)
    const device = await load<DeviceModule>(DEVICE_MODULE)
    const { PackingPrintResult } = await load<{ PackingPrintResult: unknown }>(PACKING_MODULE)
    const { PrintContext } = await load<{ PrintContext: unknown }>(PRINT_CONTEXT_MODULE)
    for (const raw of NASTY) {
      const name = device.cleanDeviceName(raw) ?? ''
      const snapshot = { phase: 'ready', error: null, config: null, templates: null, connection: 'open', overview: { queue: { device: { id: 'other-device-1', name, live: false, releasing: false }, waiting: 1, printing: 0, paused: null } } }
      const store = { subscribe: () => () => {}, getSnapshot: () => snapshot }
      const print = { busy: false, done: '포장 라벨 1장 출력을 접수했어요.', error: null, ready: true, send: async () => {} }
      const host = await draw((React) =>
        React.createElement(
          (PrintContext as { Provider: unknown }).Provider,
          { value: { store, station: { isMine: () => false } } },
          React.createElement(PackingPrintResult, { print }),
        ),
      )
      expect(injected(host), raw).toBe(0)
      const note = [...host.querySelectorAll('p')].find((p) => p.textContent === words.deviceLostMessage(name))
      expect(note, raw).toBeDefined()
    }
  })
})

describe('AC-MOB1-89 기본 기기 이름 (D-MOB1-13)', () => {
  const agents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
    'KAKAOTALK 10.8.0 (iPhone)',
    'NAVER(inapp; search; 2000; 12.7.3; Android)',
    '',
  ]
  const agent = fc.oneof(
    fc.constantFrom(...agents),
    fc.string({ maxLength: 80 }),
    fc.tuple(fc.string({ maxLength: 20 }), fc.constantFrom('iPhone', 'ipad', 'ANDROID', 'Mobile', 'mobi', 'Windows', 'iPod'), fc.string({ maxLength: 20 })).map(([a, b, c]) => `${a}${b}${c}`),
  )

  it('무작위 사용자 에이전트 1,000개 × 출력 기기 이름(같음·다르게 적은 같음·다름·없음)', async () => {
    const device = await load<DeviceModule>(DEVICE_MODULE)
    const names = Object.values(device.DEFAULT_DEVICE_NAMES)
    expect(names.sort()).toEqual(['PC', '아이폰', '안드로이드 폰', '휴대폰'].sort())
    const allowed = new Set([...names, ...names.map((n) => `${n} 2`)])
    const baseOf = (ua: string, narrow: boolean): string =>
      // QL2 D-QL2-07·LABEL_RULES L-309: iPhone·iPad·iPod(대소문자 구분) → 아이폰. touchPoints를 넘기지 않아 0이므로 Macintosh 조건은 결과가 같다
      /iPhone|iPad|iPod/.test(ua) ? '아이폰' : /Android/i.test(ua) ? '안드로이드 폰' : /Mobile/i.test(ua) || narrow ? '휴대폰' : 'PC'
    const other = fc.oneof(
      fc.constant<'same' | 'padded' | 'none' | 'second'>('same'),
      fc.constant<'same' | 'padded' | 'none' | 'second'>('padded'),
      fc.constant<'same' | 'padded' | 'none' | 'second'>('none'),
      fc.constant<'same' | 'padded' | 'none' | 'second'>('second'),
      fc.string({ maxLength: 25 }),
    )
    fc.assert(
      fc.property(agent, fc.boolean(), other, (ua, narrow, kind) => {
        const base = baseOf(ua, narrow)
        const station =
          kind === 'same' ? base : kind === 'padded' ? `  \u200b${base}\u200b ` : kind === 'none' ? null : kind === 'second' ? `${base} 2` : kind
        const out = device.defaultDeviceName({ userAgent: ua, narrow, otherStation: station })
        expect(allowed.has(out), out).toBe(true)
        const length = [...out].length
        expect(length >= 1 && length <= device.DEVICE_NAME_MAX).toBe(true)
        expect(device.cleanDeviceName(out)).toBe(out)
        const clash = station !== null && device.cleanDeviceName(station) === base
        expect(out).toBe(clash ? `${base} 2` : base)
        // 출력 기기와 같은 이름으로 보이지 않는다
        if (station !== null) expect(out).not.toBe(device.cleanDeviceName(station))
      }),
      { numRuns: 1000, seed: 20261025 },
    )
  })
})
