// QL2 E2E 공용 도우미 (test-e2e) — 품질 2회차 고칠 것 (harness/sprints/QL2/acceptance.md).
// 기대값은 acceptance.md·SPEC v0.1.44·LABEL_RULES v0.2.9의 따옴표 문장에서 정했다(구현을 보고 정하지 않음).
// 공통 전제의 측정 뜻:
// - "보인다(첫 화면)" = 스크롤 0에서 위 끝 ≥ 0, 아래 끝 ≤ (화면 높이 − 아래 메뉴 막대 높이), elementFromPoint가 그 요소나 그 안
// - "글자 잘림 0" = scrollHeight ≤ clientHeight + 1, scrollWidth ≤ clientWidth + 1, 글자 줄 상자(Range.getClientRects)의 위·아래가 그 상자 안
import { expect, type Locator, type Page } from '@playwright/test'
import { menu } from '../menu.ts'

export { ANDROID, PC, PHONE, alerts, baseUrlOf, bigText, broadcastApi, endBroadcastApi, expectBig, expectNoOverflow, freshSeller, newDevice, setLabelsApi } from '../mob1/support.ts'

/** 출력 기기 없음 + 대기 라벨 (D-QL2-09 ①, AC-QL2-40 글자 그대로) */
export const NO_STATION_PILING = "출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 프린터를 연결한 뒤 '이 기기에서 출력'을 눌러 주세요."
/** 판매자 멈춤 (AC-QL2-41) */
export const SELLER_PAUSE_ALERT = "출력 멈춤 · '출력 멈추기'를 눌러 멈췄어요. 눌러서 '다시 시작'을 골라 주세요."
export const backlogPauseAlert = (n: number): string => `출력 멈춤 · 쌓인 라벨 ${String(n)}장이 기다려요. 눌러서 '출력 시작'을 골라 주세요.`
export const DISCONNECT_ALERT = '출력 멈춤 · 프린터 연결이 끊겼어요.'
/** 출력 기기 끊김 항목 (D-MOB1-08) */
export const stationLost = (name: string): string => `출력 기기('${name}')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.`
/** 저절로 다시 잇기 (D-QL2-04, L-11 8) */
export const reconnecting = (n: number): string => `프린터에 다시 잇고 있어요. (${String(n)}/6)`
export const GAVE_UP = "저절로 다시 잇지 못했어요. 아래를 해 본 뒤 '다시 연결'을 눌러 주세요."
/** AI 문장 (D-QL2-05) */
export const YT_EXCLUDED = '유튜브 채팅은 AI에 보내지 않아요. 규칙 제안만 보여 드려요.'
export const ASSIST_NOTICE = '확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 유튜브 채팅은 보내지 않아요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.'
export const OLD_ASSIST_NOTICE = '확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.'
/** 빼기 확인 창 (D-QL2-09 ③) */
export const CANCEL_QUESTION_TAIL = '라벨을 뺄까요? 뺀 라벨은 출력하지 않아요(기록은 남아요).'
/** 보류 찜 창 맨 위 (D-QL2-09 ④) */
export const pendingMeaning = (w: number): string => `보류 찜은 아직 등록하지 않은 번호로 들어온 찜이에요. 찜이 들어오고 ${String(w)}초 안에 그 번호를 등록하면 판정에 들어가고, 늦으면 만료돼요.`

/** 아래 메뉴 막대 높이 (휴대폰 — 없으면 0) */
export async function barHeight(page: Page): Promise<number> {
  const nav = menu(page)
  const box = await nav.boundingBox()
  if (box === null) return 0
  const vh = page.viewportSize()!.height
  // 화면 아래에 붙은 막대만 (PC 위 줄 메뉴는 아래를 가리지 않는다)
  return box.y + box.height >= vh - 1 ? box.height : 0
}

/**
 * 공통 전제의 "보인다(첫 화면)": 스크롤 0에서 위 끝 ≥ 0, 아래 끝 ≤ (화면 높이 − 아래 막대 높이), 가운데 점의 elementFromPoint가 그 요소나 그 안.
 * 실패 문장에 위치를 적는다.
 */
export async function expectFirstScreen(page: Page, target: Locator, where: string): Promise<void> {
  expect(await page.evaluate(() => window.scrollY), `${where}: 스크롤 0`).toBe(0)
  const bar = await barHeight(page)
  const vh = page.viewportSize()!.height
  const r = await target.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const x = b.left + Math.min(b.width / 2, 8)
    const y = b.top + b.height / 2
    const hit = document.elementFromPoint(x, y)
    return { top: b.top, bottom: b.bottom, covered: hit === null || !(hit === el || el.contains(hit)), hit: hit === null ? 'null' : `${hit.tagName}.${hit.className}` }
  })
  const text = `${where}: 위 ${String(Math.round(r.top))} · 아래 ${String(Math.round(r.bottom))} · 막대 위 끝 ${String(Math.round(vh - bar))}`
  expect(r.top, text).toBeGreaterThanOrEqual(0)
  expect(r.bottom, text).toBeLessThanOrEqual(vh - bar + 0.5)
  expect(r.covered, `${text} · 덮음 ${r.hit}`).toBe(false)
}

/** 공통 전제의 "글자 잘림 0" (버튼·펼친 항목) */
export async function expectNoClip(target: Locator, where: string): Promise<void> {
  const r = await target.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const lines = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0).map((x) => ({ top: x.top, bottom: x.bottom }))
    return {
      sh: el.scrollHeight,
      ch: el.clientHeight,
      sw: el.scrollWidth,
      cw: el.clientWidth,
      top: box.top,
      bottom: box.bottom,
      lines,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50),
    }
  })
  const name = `${where} "${r.text}"`
  expect(r.sh, `${name} 위아래 잘림 (scrollHeight ${String(r.sh)} > clientHeight ${String(r.ch)})`).toBeLessThanOrEqual(r.ch + 1)
  expect(r.sw, `${name} 옆 잘림 (scrollWidth ${String(r.sw)} > clientWidth ${String(r.cw)})`).toBeLessThanOrEqual(r.cw + 1)
  for (const line of r.lines) {
    expect(line.top, `${name} 글자 줄 위 끝 ${String(line.top)} < 상자 ${String(r.top)}`).toBeGreaterThanOrEqual(r.top - 0.5)
    expect(line.bottom, `${name} 글자 줄 아래 끝 ${String(line.bottom)} > 상자 ${String(r.bottom)}`).toBeLessThanOrEqual(r.bottom + 0.5)
  }
}

/** 넘침을 자르는 조상으로 잘린 뒤 보이는 부분이 있는가 (접힌 띠에서 한 줄 밖 항목은 재지 않는다) */
export async function isShown(target: Locator): Promise<boolean> {
  return await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    let top = r.top
    let bottom = r.bottom
    let left = r.left
    let right = r.right
    for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect()
        top = Math.max(top, pr.top)
        bottom = Math.min(bottom, pr.bottom)
        left = Math.max(left, pr.left)
        right = Math.min(right, pr.right)
      }
    }
    return bottom - top > 0.5 && right - left > 0.5
  })
}

/** a가 문서 차례에서 b보다 앞인가 */
export async function before(a: Locator, b: Locator): Promise<boolean> {
  const handle = await b.elementHandle()
  return await a.evaluate((x, y) => (x.compareDocumentPosition(y as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, handle)
}

/** 차례대로 문서에 놓였는지 (이름은 실패 문장용) */
export async function expectOrder(items: readonly (readonly [string, Locator])[], where: string): Promise<void> {
  for (let i = 1; i < items.length; i += 1) {
    const [an, a] = items[i - 1]!
    const [bn, b] = items[i]!
    expect(await before(a, b), `${where}: "${an}" → "${bn}" 차례`).toBe(true)
  }
}
