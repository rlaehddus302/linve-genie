// N4b E2E 공용 도우미 (test-e2e). I2 도우미(실제 범위·입금·파일 읽기) 위에 영수증 보내기 화면·링크·ZIP 읽기를 더한다.
// 선택자는 역할·이름 기반 — harness/sprints/N4b/dev-notes.md "E2E가 잡기 쉬운 이름"과 acceptance.md의 따옴표 문장.
import { inflateRawSync } from 'node:zlib'
import { expect, type Browser, type Page } from '@playwright/test'
import { postJson, realDay, resetShop } from '../i2/support.ts'

export * from '../i2/support.ts'

export const CLOSED_TEXT = '이 링크는 열 수 없어요. 판매자에게 새 링크를 받아 주세요.'
export const TAX_NOTE = '본 문서는 거래 확인용이며 세금계산서·현금영수증 등 세법상 적격증빙이 아닙니다'
export const SHOP = { name: '다육이네', bank: '국민', accountNumber: '123-45-6789', accountHolder: '김다육', accountNote: '입금자명은 닉네임으로 적어 주세요' }

/** 가게 이름·계좌를 시험 값으로 (끝나면 resetShop) */
export async function setShop(page: Page, shop: Partial<typeof SHOP> = {}): Promise<void> {
  const res = await page.request.put('/api/shop', { data: { ...SHOP, ...shop }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
}

export { resetShop }

export async function endBroadcast(page: Page, b: string): Promise<void> {
  const res = await postJson(page, `/api/broadcasts/${encodeURIComponent(b)}/end`, { requestId: crypto.randomUUID() })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** 클립보드·공유 가짜: writeText는 __clip에 쌓는다. 공유는 __shared에 쌓는다(글 공유만 받는다) */
export const CLIPBOARD_FAKE = () => {
  const w = window as unknown as { __clip: string[]; __shared: unknown[] }
  w.__clip = []
  w.__shared = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { w.__clip.push(text); return Promise.resolve() } } })
}

export async function clipboard(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as unknown as { __clip: string[] }).__clip)
}

export function linkOf(text: string): string {
  const m = /(https?:\/\/\S+\/r\/[A-Za-z0-9_-]{43})$/.exec(text)
  if (m === null) throw new Error(`링크가 없다: ${text}`)
  return m[1]!
}

/** 두 구매자(문자 휴대폰 구매자 + 메모 구매자)가 1등인 실제 방송을 만들고 끝낸다 */
export async function endedDay(page: Page, opts: { title?: string; memo?: string; phone?: string } = {}) {
  const { uniqueDate } = await import('../i2/support.ts')
  const date = uniqueDate()
  const phone = opts.phone ?? '010-7123-4567'
  const memo = opts.memo ?? '가람이'
  const { b, buyers } = await realDay(page, {
    date,
    title: opts.title ?? '화요일 저녁',
    products: [{ no: 1, name: '핑크프릴', price: 10000 }, { no: 2, name: '라울', price: 8000 }, { no: 3, name: '블루엘프', price: 5000 }],
    claims: [{ no: 1, phone }, { no: 2, phone }, { no: 3, memo }],
  })
  await endBroadcast(page, b)
  return { date, b, phone, memo, phoneBuyer: buyers.get(phone)!, memoBuyer: buyers.get(memo)! }
}

export function receiptsPath(b: string): string {
  return `/broadcasts/${encodeURIComponent(b)}/receipts`
}

export function buyerRow(page: Page, name: string | RegExp) {
  return page.getByRole('list', { name: '구매자' }).getByRole('group', { name, exact: true })
}

export function allRegion(page: Page) {
  return page.getByRole('region', { name: '한 번에 하기' })
}

/** 로그인하지 않은 휴대폰 크기 새 문맥 */
export async function anonymousPhone(browser: Browser, like: Page): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(like.url()).origin })
  return await context.newPage()
}

export interface ZipEntry { name: string; flags: number; method: number; data: Buffer }

/** ZIP 중앙 목록 읽기 (저장 0·deflate 8) */
export function readZip(bytes: Buffer): ZipEntry[] {
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP 끝 기록 없음')
  const count = bytes.readUInt16LE(eocd + 10)
  let at = bytes.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50)
    const flags = bytes.readUInt16LE(at + 8)
    const method = bytes.readUInt16LE(at + 10)
    const size = bytes.readUInt32LE(at + 20)
    const nameLen = bytes.readUInt16LE(at + 28)
    const extraLen = bytes.readUInt16LE(at + 30)
    const commentLen = bytes.readUInt16LE(at + 32)
    const local = bytes.readUInt32LE(at + 42)
    const name = bytes.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const localName = bytes.readUInt16LE(local + 26)
    const localExtra = bytes.readUInt16LE(local + 28)
    const start = local + 30 + localName + localExtra
    const raw = bytes.subarray(start, start + size)
    out.push({ name, flags, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 기본(baseline) JPEG인가: FFD8…FFD9, SOF0 있음·SOF2 없음 */
export function isBaselineJpeg(bytes: Buffer): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false
  return bytes.includes(Buffer.from([0xff, 0xc0])) && !bytes.includes(Buffer.from([0xff, 0xc2]))
}
