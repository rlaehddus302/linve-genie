// @vitest-environment jsdom
// QL3R1 적대 시험 (test-domain, 4회차): 휴대폰 되돌리기 항목 두 칸 한 줄 고침(D-QL3R1-12, AC-QL3R1-63, 개발 커밋 8e5241c4) 확인.
// 휴대폰 CSS는 `.undo-item`을 [글 칸 minmax(0,1fr)] + [단추 칸 auto]의 grid로 만들고, 단추가 둘 이상(`:has(> .button ~ .button)`)이면
// 예전처럼 줄바꿈한다. 이 모양은 DOM 구조에 기댄다 — 다음 중 하나라도 깨지면 화면이 다시 두 줄이 되거나 단추가 글 칸에 끼는데,
// CSS 단위 시험(styles.node.test)은 선언만 보고 E2E는 등록·찜 취소 두 종류만 보므로 여기서 모든 종류를 무작위로 공격한다.
//  (1) 항목(li)의 직속 자식 = [글 묶음 .undo-text 하나 또는 상태 문장 하나] + 단추들. 직속 글자 노드 0(익명 grid 칸이 생기면 칸이 늘어남).
//  (2) 단추는 li의 직속 자식이다(`.undo-item > .button`·`:has(> .button ~ .button)`가 잡아야 한다). 글 묶음 안에 단추 0.
//  (3) 문장(role=status/alert)의 글·단추 이름(aria-label)·단추 차례·누르면 하는 일은 고치기 전과 같다(D-QL3R1-12 "그대로").
//  (4) 채팅에서 온 이름이 든 label(HTML 태그·이모지·긴 낱말)은 글로만 들어간다(절대 규칙 7).
//  (5) "남은 시간 n초"는 글 묶음 안, 문장 바로 뒤에 띄어 있다(붙으면 낱말 사이 줄바꿈 자리가 사라진다).
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'

const UNDO_BAR_MODULE = '../../../apps/web/src/components/UndoBar.tsx'
const REACT_MODULE = '../../../apps/web/node_modules/react/index.js'
const REACT_DOM_MODULE = '../../../apps/web/node_modules/react-dom/client.js'

type Element = unknown
interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element
  act(callback: () => void): void
}
interface Root {
  render(element: Element): void
  unmount(): void
}
interface HostNode {
  innerHTML: string
  readonly nodeType: number
  readonly tagName: string
  readonly className: string
  readonly textContent: string | null
  readonly childNodes: ArrayLike<HostNode>
  readonly children: ArrayLike<HostNode>
  readonly parentElement: HostNode | null
  getAttribute(name: string): string | null
  querySelector(selector: string): HostNode | null
  querySelectorAll(selector: string): Iterable<HostNode> & { readonly length: number }
  append(node: HostNode): void
  click(): void
}
const document = (globalThis as unknown as { document: { body: HostNode; createElement(tag: string): HostNode } }).document
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T
const NOT_APPLIED = '적용되지 않았어요. 지금 상태를 확인해 주세요.'

const mounted: Root[] = []
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

// ── 시험 항목 ─────────────────────────────────────────────
interface Problem {
  readonly message: string
  readonly hint?: string
}
interface ErrorShape {
  readonly retryable: boolean
  readonly transient: boolean
  readonly code: string
  readonly message: string
  readonly problems: readonly Problem[]
}
type Spec =
  | { readonly kind: 'registration'; readonly status: 'open' | 'undoing' | 'undone' | 'blocked' | 'failed' | 'expired'; readonly no: number; readonly message: string | null }
  | {
      readonly kind: 'action'
      readonly status: 'waiting' | 'sending' | 'retrying' | 'done' | 'notApplied' | 'cancelled' | 'failed'
      readonly label: string
      readonly paused: boolean
      readonly error: ErrorShape | null
      readonly reopenLabel: string | null
    }

// 실제 시청자 닉네임·상품 이름처럼: 한글, 이모지, 전각, HTML 태그, 띄어쓰기 없는 긴 낱말
const word = fc.constantFrom('홍길동', '밤톨맘', '다육🌵사랑', '＜전각＞', '<b>굵게</b>', '<img src=x onerror=alert(1)>', '가'.repeat(40), 'O’Neil & "따옴"', '탭\t이름')
const label = fc.tuple(fc.integer({ min: 1, max: 999 }), word, fc.constantFrom('취소', '보류 풀기', '1등 바꾸기')).map(([n, w, what]) => `${String(n)}번 ${w} ${what}`)
const errorShape: fc.Arbitrary<ErrorShape> = fc.record({
  retryable: fc.boolean(),
  transient: fc.boolean(),
  code: fc.constantFrom('SAVE_FAILED', 'CONFLICT', 'VALIDATION'),
  message: fc.constantFrom('이미 바뀌었어요.', '사유를 적어 주세요.', '<script>x</script>'),
  problems: fc.array(fc.record({ message: word, hint: fc.option(word, { nil: undefined }) }, { requiredKeys: ['message'] }), { maxLength: 2 }),
})
const spec: fc.Arbitrary<Spec> = fc.oneof(
  fc.record({
    kind: fc.constant('registration' as const),
    status: fc.constantFrom('open' as const, 'undoing' as const, 'undone' as const, 'blocked' as const, 'failed' as const, 'expired' as const),
    no: fc.integer({ min: 1, max: 9999 }),
    message: fc.option(word, { nil: null }),
  }),
  fc.record({
    kind: fc.constant('action' as const),
    status: fc.constantFrom('waiting' as const, 'sending' as const, 'retrying' as const, 'done' as const, 'notApplied' as const, 'cancelled' as const, 'failed' as const),
    label,
    paused: fc.boolean(),
    error: fc.option(errorShape, { nil: null }),
    reopenLabel: fc.option(fc.constant('사유 고치기'), { nil: null }),
  }),
)

const NOW = Date.now()
function toItem(s: Spec, id: number): Record<string, unknown> {
  const base = { id, createdAt: NOW, deadline: NOW + 60_000 }
  if (s.kind === 'registration') return { ...base, kind: 'registration', no: s.no, product: `${String(s.no)}번`, status: s.status, message: s.message }
  return {
    ...base,
    kind: 'action',
    requestId: `r${String(id)}`,
    label: s.label,
    status: s.status,
    error: s.error,
    result: null,
    claims: [],
    products: [],
    meta: null,
    reopenLabel: s.reopenLabel,
    pausedLeft: s.paused ? 3000 : null,
  }
}

// ── 참조 모형: 고치기 전(6b1f2629) UndoBar의 문장·단추를 그대로 옮긴 것 ──────────
interface ButtonModel {
  readonly text: string
  readonly name: string | null
  readonly call: 'undo' | 'dismiss' | 'reopen' | 'resend'
}
interface LineModel {
  readonly role: 'status' | 'alert'
  readonly sentence: string
  readonly countdown: boolean
  readonly buttons: readonly ButtonModel[]
}
const secondsWord = (ms: number): string => {
  const seconds = Math.round(ms / 100) / 10
  return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)}초`
}
function model(s: Spec, delayMs: number): LineModel {
  const ok: ButtonModel = { text: '확인', name: null, call: 'dismiss' }
  if (s.kind === 'registration') {
    if (s.status === 'open') return { role: 'status', sentence: `${String(s.no)}번을 등록했어요`, countdown: true, buttons: [{ text: '되돌리기', name: `${String(s.no)}번 등록 되돌리기`, call: 'undo' }] }
    if (s.status === 'undoing') return { role: 'status', sentence: `${String(s.no)}번 등록을 되돌리는 중…`, countdown: false, buttons: [] }
    return { role: 'status', sentence: s.message ?? '', countdown: false, buttons: [ok] }
  }
  switch (s.status) {
    case 'waiting':
      return { role: 'status', sentence: `${secondsWord(delayMs)} 뒤 보내요: ${s.label}`, countdown: true, buttons: [{ text: '되돌리기', name: `${s.label} 되돌리기`, call: 'undo' }] }
    case 'sending':
    case 'retrying':
      return { role: 'status', sentence: `보내는 중…: ${s.label}`, countdown: false, buttons: [] }
    case 'done':
      return { role: 'status', sentence: `보냈어요: ${s.label}`, countdown: false, buttons: [] }
    case 'notApplied':
      return { role: 'status', sentence: `${s.label} — ${NOT_APPLIED}`, countdown: false, buttons: [ok] }
    case 'cancelled':
      return { role: 'status', sentence: `보내지 않았어요: ${s.label}`, countdown: false, buttons: [] }
    case 'failed': {
      const e = s.error
      const head = e?.retryable === true ? `저장하지 못했어요. ${e.code === 'SAVE_FAILED' ? '' : e.message}` : (e?.message ?? '보내지 못했어요.')
      const tail = (e?.problems ?? []).map((p) => ` ${p.message}${p.hint !== undefined ? ` ${p.hint}` : ''}`).join('')
      const buttons: ButtonModel[] = []
      if (s.reopenLabel !== null) buttons.push({ text: s.reopenLabel, name: `${s.label} ${s.reopenLabel}`, call: 'reopen' })
      if (e?.transient === true) buttons.push({ text: '다시 보내기', name: null, call: 'resend' })
      buttons.push(ok)
      return { role: 'alert', sentence: `${s.label} — ${head}${tail}`, countdown: false, buttons }
    }
  }
}

async function draw(specs: readonly Spec[], delayMs: number) {
  const React = await load<ReactLike>(REACT_MODULE)
  const { createRoot } = await load<{ createRoot(node: HostNode): Root }>(REACT_DOM_MODULE)
  const { UndoBar } = await load<{ UndoBar: unknown }>(UNDO_BAR_MODULE)
  const calls: string[] = []
  const queue = {
    delayMs,
    undo: (id: number) => calls.push(`undo:${String(id)}`),
    dismiss: (id: number) => calls.push(`dismiss:${String(id)}`),
    reopen: (id: number) => calls.push(`reopen:${String(id)}`),
    resend: (id: number) => calls.push(`resend:${String(id)}`),
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push(root)
  const items = specs.map((s, i) => toItem(s, i + 1))
  React.act(() => root.render(React.createElement(UndoBar, { items, queue })))
  return { host, calls, React }
}

const TEXT = 3
const directButtons = (li: HostNode): HostNode[] => [...Array.from(li.children)].filter((c) => c.tagName === 'BUTTON')

function checkLine(li: HostNode, m: LineModel, id: number, calls: string[], React: ReactLike) {
  // (1) 직속 글자 노드 0 — 있으면 휴대폰 grid에서 익명 칸이 하나 더 생긴다
  const strayText = Array.from(li.childNodes).filter((n) => n.nodeType === TEXT && (n.textContent ?? '') !== '')
  expect(strayText.map((n) => n.textContent), '항목 직속 글자 노드').toEqual([])
  const kids = Array.from(li.children)
  // (2) 단추는 모두 li 직속, 그 앞의 첫 자식 하나만 글 칸
  const buttons = directButtons(li)
  expect(li.querySelectorAll('button').length, '단추가 글 묶음 안에 들어감').toBe(buttons.length)
  expect(kids.length, '직속 자식 = 글 칸 1 + 단추').toBe(1 + m.buttons.length)
  expect(kids.slice(1).every((k) => k.tagName === 'BUTTON'), '단추가 글 칸보다 뒤').toBe(true)
  const first = kids[0]
  expect(first).toBeDefined()
  if (first === undefined) return
  expect(first.tagName).not.toBe('BUTTON')
  // 단추가 있으면 글 칸은 .undo-text 하나 (휴대폰에서 minmax(0,1fr) 칸이 되는 것)
  if (m.buttons.length > 0) expect(first.className, '단추 있는 항목의 글 칸').toBe('undo-text')
  expect(li.querySelectorAll('.undo-text').length).toBe(m.buttons.length > 0 ? 1 : 0)
  // (3) 문장 글 그대로, role 하나
  const sentences = [...li.querySelectorAll('[role="status"], [role="alert"]')]
  expect(sentences.length, '문장 하나').toBe(1)
  const sentence = sentences[0]
  expect(sentence?.getAttribute('role')).toBe(m.role)
  expect(sentence?.textContent).toBe(m.sentence)
  // (4) 글로만: 채팅 이름의 태그가 요소가 되지 않는다
  expect(li.querySelectorAll('b, img, script').length, '이름 속 태그가 요소로').toBe(0)
  // (5) 남은 시간은 글 묶음 안, 문장 바로 뒤, 띄어 있음
  const countdown = li.querySelector('.countdown')
  if (m.countdown) {
    expect(countdown, '남은 시간').not.toBeNull()
    expect(countdown?.parentElement?.className, '남은 시간이 글 묶음 밖').toBe('undo-text')
    expect(countdown?.textContent ?? '').toMatch(/^남은 시간 \d+초$/)
    expect(first.textContent ?? '').toBe(`${m.sentence} ${countdown?.textContent ?? ''}`)
  } else {
    expect(countdown).toBeNull()
  }
  // 단추 글·이름·차례·누르면 하는 일
  expect(buttons.map((b) => b.textContent)).toEqual(m.buttons.map((b) => b.text))
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(m.buttons.map((b) => b.name))
  buttons.forEach((b, i) => {
    const before = calls.length
    React.act(() => b.click())
    expect(calls.slice(before)).toEqual([`${m.buttons[i]?.call ?? '?'}:${String(id)}`])
  })
  // 휴대폰에서 줄바꿈 모양(:has(> .button ~ .button))은 직속 단추가 둘 이상일 때만 — 하나뿐인 항목은 두 칸 한 줄
  expect(buttons.length >= 2).toBe(m.buttons.length >= 2)
}

describe('TD-QL3R1 휴대폰 되돌리기 두 칸 한 줄 — DOM 구조·문장 그대로 (D-QL3R1-12, AC-QL3R1-63)', () => {
  it('고정 예: 등록 "20번을 등록했어요"·찜 취소 대기 "5초 뒤 보내요: 15번 홍길동 취소" — 글 칸 하나 + 단추 하나, 남은 시간 띄어 붙음', async () => {
    const specs: Spec[] = [
      { kind: 'registration', status: 'open', no: 20, message: null },
      { kind: 'action', status: 'waiting', label: '15번 홍길동 취소', paused: false, error: null, reopenLabel: null },
    ]
    const { host, calls, React } = await draw(specs, 5000)
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('보내기 전 조치')
    const lis = [...host.querySelectorAll('li.undo-item')]
    expect(lis.length).toBe(2)
    specs.forEach((s, i) => {
      const li = lis[i]
      if (li !== undefined) checkLine(li, model(s, 5000), i + 1, calls, React)
    })
    expect(lis[0]?.querySelector('.undo-text')?.textContent).toMatch(/^20번을 등록했어요 남은 시간 \d+초$/)
    expect(lis[1]?.querySelector('.undo-text')?.textContent).toMatch(/^5초 뒤 보내요: 15번 홍길동 취소 남은 시간 \d+초$/)
    // 멈춘 시계(떠날지 묻는 중)는 남은 시간 그대로
    const paused = await draw([{ kind: 'action', status: 'waiting', label: '1번 밤톨맘 취소', paused: true, error: null, reopenLabel: null }], 5000)
    expect(paused.host.querySelector('.countdown')?.textContent).toBe('남은 시간 3초')
  })

  it('무작위 항목 묶음 300번: 모든 종류에서 (1)~(5)가 참조 모형(고치기 전 문장·단추)과 같다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(spec, { minLength: 1, maxLength: 5 }), fc.constantFrom(5000, 3000, 300, 1500), async (specs, delayMs) => {
        const { host, calls, React } = await draw(specs, delayMs)
        const lis = [...host.querySelectorAll('li.undo-item')]
        expect(lis.length).toBe(specs.length)
        specs.forEach((s, i) => {
          const li = lis[i]
          expect(li).toBeDefined()
          if (li !== undefined) checkLine(li, model(s, delayMs), i + 1, calls, React)
        })
        for (const root of mounted.splice(0)) root.unmount()
        document.body.innerHTML = ''
      }),
      { numRuns: 300 },
    )
  })

  it('항목 0개면 띠 자체가 없다(빈 칸이 고정 영역 높이를 먹지 않음)', async () => {
    const { host } = await draw([], 5000)
    expect(host.querySelector('section')).toBeNull()
    expect(host.childNodes.length).toBe(0)
  })
})
