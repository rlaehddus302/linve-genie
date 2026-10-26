// MOB2 적대 시험 (test-domain) — 수정 라운드 4 개발 고침 확인 (D-MOB2-17 · D-MOB2-18 · D-MOB2-15 ②, RA-MOB2-07)
// 1) RA-MOB2-07: 합치기 미리 보기의 중복 찜 낱말도 다른 화면과 같은 판단. 실제 엔진 previewMerge가 낸 중복(보류 찜)을
//    mergeWords(…, now)로 바꾼 글이 claimWord(data, claim, now)와 같고, 시간 지남 ⇔ isPendingTimedOut(처음 받은 시각 seen 기준)인지
//    무작위 seen·지금으로 본다. now를 주지 않으면(옛 부름) 시간이 지나도 "보류" — 이 차이가 고침이 뜻하는 바다.
// 2) D-MOB2-18 (SA-MOB2-07): WriteError의 autoResend는 다시 보낼 수 있는 실패의 첫 문장만 바꾼다 — "눌러 주세요" 없음,
//    "다시 보내기" 단추·자세히는 그대로. 저절로 보내지 않는 실패(다시 보낼 수 없는 오류)는 autoResend를 줘도 글자 하나 다르지 않다.
// 3) D-MOB2-17 (TE-MOB2-007): 출력 기기 없음 짧은 줄은 결정 문장 그대로, stationLeadShortText가 그 문장을 낸다. 끊김 문장은 그대로.
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(pending-window-property.test.ts와 같은 까닭).
import {
  applyEvent,
  initEngine,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  previewMerge,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { withIsoTimes } from '../../../apps/server/src/time.ts'

const DERIVE_MODULE = '../../../apps/web/src/lib/derive.ts'
const SCOPE_MODULE = '../../../apps/web/src/lib/scope-data.ts'
const BUYERS_MODULE = '../../../apps/web/src/lib/buyers.ts'
const PRINT_MODULE = '../../../apps/web/src/lib/print-words.ts'
const FORMS_MODULE = '../../../apps/web/src/components/forms.tsx'
const CLIENT_MODULE = '../../../apps/web/src/api/client.ts'
const REACT_MODULE = '../../../apps/web/node_modules/react/index.js'
const SERVER_MODULE = '../../../apps/web/node_modules/react-dom/server.node.js'

const load = async <T>(path: string): Promise<T> => (await import(/* @vite-ignore */ path)) as T

interface Data {
  readonly claims: ReadonlyMap<string, { id: string; status: string; at: string }>
  readonly seen?: { get(id: string): number | undefined }
}
interface Derive {
  isPendingTimedOut(data: unknown, claim: unknown, now: number): boolean
  claimWord(data: unknown, claim: unknown, now?: number): string
  PENDING_TIMED_OUT_WORD: string
}
interface Buyers {
  mergeWords(data: unknown, names: { name(id: string): string }, preview: unknown, label: (b: string, no: number) => string, now?: number): { duplicates: { claim: string; text: string }[] }
}

const B = { id: 'b1', date: '2026-10-18', title: '1부' } as const
/** 2026-10-18 20:00:00 KST */
const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)

function fullView(state: EngineState): unknown {
  return withIsoTimes({
    date: B.date,
    rehearsal: false,
    seq: 0,
    attention: [],
    depositLinks: [],
    broadcasts: listBroadcasts(state),
    products: listProducts(state),
    claims: listClaims(state),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state),
  })
}

/** 아직 없는 31번에 두 손님이 보류 찜(가 먼저) — 나를 가에 합치면 나의 보류 찜이 중복으로 정리된다 */
function twoPending(windowSec: number, gap: number): EngineState {
  let state = initEngine({ broadcasts: [B], settings: { 'claim.preOpenWindowSec': windowSec } })
  let seq = 0
  const apply = (event: Record<string, unknown>): void => {
    state = applyEvent(state, { ...event, seq: ++seq } as unknown as EngineEvent).state
  }
  apply({ type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '가', text: '31', at: T0 })
  apply({ type: 'chat', b: 'b1', id: 'm2', ch: 'UC_B', nick: '나', text: '31', at: T0 + gap })
  return state
}

describe('RA-MOB2-07 합치기 미리 보기의 중복 찜 낱말은 다른 화면과 같은 지금 시각 판단', () => {
  it('속성: 실제 previewMerge 중복(보류 찜) — mergeWords(now) 글 = claimWord(now), 시간 지남 ⇔ isPendingTimedOut (seen 기준, 시드 고정)', async () => {
    const d = await load<Derive>(DERIVE_MODULE)
    const s = await load<{ fromFull(view: unknown): Data }>(SCOPE_MODULE)
    const b = await load<Buyers>(BUYERS_MODULE)
    const names = { name: (id: string) => (id === 'UC_A' ? '가' : id === 'UC_B' ? '나' : id) }
    const label = (_b: string, no: number) => `${String(no)}번`
    let timedOutSeen = 0
    let liveSeen = 0
    fc.assert(
      fc.property(
        fc.constantFrom(1, 30, 45, 300),
        fc.integer({ min: 1, max: 5_000 }),
        // 처음 받은 때의 늦음: 바로·조금·새로고침
        fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3_000 }), fc.integer({ min: 0, max: 600_000 })),
        // 지금 = seen + 지난 시간 (경계 W초 앞뒤 포함)
        fc.oneof(fc.integer({ min: 0, max: 600_000 }), fc.constantFrom(0, 1, 999, 1_000)),
        (w, gap, lag, extra) => {
          const state = twoPending(w, gap)
          const preview = previewMerge(state, 'UC_B', 'UC_A')
          expect(preview.blocked).toBeNull()
          expect(preview.duplicates.map((x) => x.status)).toEqual(['PENDING'])
          const base = s.fromFull(fullView(state))
          const dupId = preview.duplicates[0]?.claim ?? ''
          const claim = base.claims.get(dupId)
          if (claim === undefined) throw new Error('중복 찜이 화면 자료에 없다')
          const seen = Date.parse(claim.at) + lag
          const data: Data = { ...base, seen: { get: (id: string) => (id === dupId ? seen : Date.parse(base.claims.get(id)?.at ?? '')) } }
          // 경계 근처를 일부러 섞는다: W초 정각 ± 1ms
          const now = extra < 2_000 ? seen + w * 1000 + extra - 1_000 : seen + extra
          const words = b.mergeWords(data, names, preview, label, now)
          const timedOut = d.isPendingTimedOut(data, claim, now)
          const word = d.claimWord(data, claim, now)
          expect(word === d.PENDING_TIMED_OUT_WORD).toBe(timedOut)
          expect(words.duplicates).toEqual([{ claim: dupId, text: `31번: 나의 ${word} 찜이 중복으로 정리돼요` }])
          if (timedOut) timedOutSeen++
          else liveSeen++
        },
      ),
      { seed: 2026_1026_4, numRuns: 300 },
    )
    // 두 쪽 모두 실제로 지나갔는지 (한쪽만 돌면 이 속성은 아무것도 보지 않은 것)
    expect(timedOutSeen).toBeGreaterThan(20)
    expect(liveSeen).toBeGreaterThan(20)
  })

  it('고정: 시간이 지난 보류 찜은 "보류 · 시간 지남" — now 없는 옛 부름은 "보류"로 남아 다른 화면과 어긋났다', async () => {
    const d = await load<Derive>(DERIVE_MODULE)
    const s = await load<{ fromFull(view: unknown): Data }>(SCOPE_MODULE)
    const b = await load<Buyers>(BUYERS_MODULE)
    const state = twoPending(30, 1_000)
    const preview = previewMerge(state, 'UC_B', 'UC_A')
    const base = s.fromFull(fullView(state))
    const at = T0 + 1_000
    const data: Data = { ...base, seen: { get: (id: string) => Date.parse(base.claims.get(id)?.at ?? '') } }
    const names = { name: (id: string) => (id === 'UC_B' ? '나' : '가') }
    const label = (_b: string, no: number) => `${String(no)}번`
    // 30초 + 1ms 뒤: 시간 지남
    expect(b.mergeWords(data, names, preview, label, at + 30_001).duplicates[0]?.text).toBe(`31번: 나의 ${d.PENDING_TIMED_OUT_WORD} 찜이 중복으로 정리돼요`)
    // 아직 30초 안: 보류
    expect(b.mergeWords(data, names, preview, label, at + 1_000).duplicates[0]?.text).toBe('31번: 나의 보류 찜이 중복으로 정리돼요')
  })
})

interface ApiErrorCtor {
  ApiError: new (input: { status: number; code: string; message: string; network?: boolean }) => { retryable: boolean }
}
interface Forms {
  WriteError: unknown
  autoResendFailWords(error: unknown): string
}
interface ReactLike {
  createElement(type: unknown, props: Record<string, unknown>): unknown
}

describe('D-MOB2-18 (SA-MOB2-07) 저절로 다시 보낼 실패의 문장', () => {
  const OLD_NET = '저장하지 못했어요. 인터넷 연결을 확인하고 "다시 보내기"를 눌러 주세요.'
  const OLD_SAVE = '저장하지 못했어요. "다시 보내기"를 눌러 주세요.'

  async function render() {
    const React = await load<ReactLike>(REACT_MODULE)
    const server = await load<{ renderToStaticMarkup(el: unknown): string }>(SERVER_MODULE)
    const forms = await load<Forms>(FORMS_MODULE)
    const { ApiError } = await load<ApiErrorCtor>(CLIENT_MODULE)
    const html = (error: unknown, autoResend: boolean | undefined, retry = true): string =>
      server.renderToStaticMarkup(
        React.createElement(forms.WriteError, { error, ...(retry ? { onRetry: () => {} } : {}), ...(autoResend === undefined ? {} : { autoResend }) }),
      )
    const text = (markup: string): string => markup.replace(/<[^>]+>/g, '|').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    const firstP = (markup: string): string => /<p>(.*?)<\/p>/.exec(markup)?.[1]?.replace(/&quot;/g, '"').replace(/<!-- -->/g, '') ?? ''
    return { ApiError, forms, html, text, firstP }
  }

  it('네트워크 실패·저장 실패 × autoResend: 첫 문장이 결정 문장, "눌러 주세요" 0개, "다시 보내기" 단추·자세히 그대로', async () => {
    const { ApiError, forms, html, text, firstP } = await render()
    const net = new ApiError({ status: 0, code: 'NETWORK', message: '연결 없음', network: true })
    const save = new ApiError({ status: 500, code: 'SAVE_FAILED', message: '다시 시도해 주세요' })
    expect(net.retryable && save.retryable).toBe(true)
    for (const [error, want, old] of [
      [net, '저장하지 못했어요. 인터넷 연결을 확인해 주세요.', OLD_NET],
      [save, '저장하지 못했어요.', OLD_SAVE],
    ] as const) {
      const on = html(error, true)
      expect(firstP(on)).toBe(want)
      expect(forms.autoResendFailWords(error)).toBe(want)
      expect(text(on)).not.toContain('눌러 주세요')
      expect(text(on)).not.toContain('다시 시도해 주세요')
      expect(on).toMatch(/<button[^>]*>다시 보내기<\/button>/)
      expect(on).toContain('<summary>자세히</summary>')
      expect(on).toContain('role="alert"')
      // 안내가 함께 보이지 않으면(기본·false) 옛 문장 그대로 — 다른 화면·칸을 바꾼 문자찜
      expect(firstP(html(error, false))).toBe(old)
      expect(firstP(html(error, undefined))).toBe(old)
      // 단추 말고 바뀐 것은 첫 문장 하나뿐
      expect(on.replace(/<p>.*?<\/p>/, '')).toBe(html(error, false).replace(/<p>.*?<\/p>/, ''))
    }
  })

  it('저절로 보내지 않는 실패(AC-MOB2-44)는 autoResend를 줘도 글자 하나 다르지 않다', async () => {
    const { ApiError, html } = await render()
    for (const error of [
      new ApiError({ status: 409, code: 'CONFLICT', message: '이미 바뀌었어요.' }),
      new ApiError({ status: 422, code: 'PROCESSING_FAILED', message: '번호가 없어요.' }),
      new ApiError({ status: 400, code: 'INVALID_REQUEST', message: '칸을 확인해 주세요.' }),
    ]) {
      expect(error.retryable).toBe(false)
      expect(html(error, true)).toBe(html(error, false))
      expect(html(error, true, false)).toBe(html(error, false, false))
    }
  })
})

interface Print {
  NO_STATION_SHORT: string
  NO_STATION_PILING: string
  stationLeadShortText(input: Record<string, unknown>): string | null
  deviceLostShortMessage(name: string): string
}

describe('D-MOB2-17 (TE-MOB2-007) 출력 기기 없음 짧은 줄', () => {
  it('결정 문장 그대로이고 할 일("프린터를 연결해 주세요")이 보인다 — 펼친 띠 문장은 그대로', async () => {
    const p = await load<Print>(PRINT_MODULE)
    expect(p.NO_STATION_SHORT).toBe('라벨이 안 나가요 · 프린터를 연결해 주세요')
    expect(p.NO_STATION_SHORT).not.toContain('라벨 화면에서')
    expect(p.NO_STATION_PILING).not.toBe(p.NO_STATION_SHORT)
    const base = { labelsOn: true, rehearsal: false, ended: false, mine: false }
    expect(p.stationLeadShortText({ ...base, queue: { device: null, waiting: 3 } })).toBe(p.NO_STATION_SHORT)
    expect(p.stationLeadShortText({ ...base, queue: { device: null, waiting: 0 } })).toBeNull()
    // 끊김 문장은 기기 이름이 들어가 길이가 바뀌므로 그대로(D-QL3R1-04) — 이 고침이 건드리지 않았다
    expect(p.stationLeadShortText({ ...base, queue: { device: { name: '포장대 아이폰', live: false }, waiting: 3 } })).toBe(p.deviceLostShortMessage('포장대 아이폰'))
  })
})
