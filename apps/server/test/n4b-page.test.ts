// N4b AC-N4b-20~25 구매자 확인서 링크 화면 `/r/<토큰>` (서버가 그리는 문서·파일·열 수 없는 링크·합치기·남용 막기·앱과 섞이지 않음)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGAL_NOTICE } from '@livejjim/documents'
import jpeg from 'jpeg-js'
import { afterAll, describe, expect, it } from 'vitest'
import { formatLog } from '../src/log.ts'
import { RECEIPT_LINK_TTL_MS } from '../src/receipt-links.ts'
import { LinkRateLimiter, escapeHtml, kstDateTimeWithDay } from '../src/receipt-page.ts'
import { isServerPath } from '../src/web.ts'
import { WorkPool, createWorkPools } from '../src/work-pool.ts'
import { at, fileNameOf, ok, putShop } from './i2-support.ts'
import { linkApi, linkRows, openLink, readJpeg, sellMany, tokenOf } from './n4b-support.ts'
import { addSeller, client, fakeClock, newWorld, type Seller, type TestServer } from './support.ts'

const DATE = '2026-10-19'
const SHOP = { name: '다육이네', bank: '국민', accountNumber: '123-45-6789', accountHolder: '김다육', accountNote: '입금자명은 닉네임으로 적어 주세요' }
const CLOSED = '이 링크는 열 수 없어요. 판매자에게 새 링크를 받아 주세요.'
const LATER = '잠시 뒤 다시 열어 주세요.'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** 문자 구매자 A(휴대폰 번호 있음): 상품 3개(5,000·6,000·7,000원) 직접 수령 → 최종 18,000원, 5,000원 부분 입금. 다른 구매자 "나비"도 하나 */
async function smsSale(world: TestServer, seller: Seller): Promise<{ b: string; sms: string }> {
  at(world, DATE, '19:59:00')
  const b = await sellMany(world, seller, DATE, [['UC_N', '나비', 1]], { price: 3000 })
  let sms = ''
  for (const [i, price] of [5000, 6000, 7000].entries()) {
    const no = 10 + i
    await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price })
    at(world, DATE, `20:0${String(i + 1)}:00`)
    sms = (await ok(world, seller, { type: 'sms', b, no, received: `20:0${String(i + 1)}`, memo: '김영희', phone: '010-1234-5678' })).body.buyer as string
  }
  at(world, DATE, '21:00:00')
  await ok(world, seller, { type: 'settlement.shippingOverride', buyer: sms, date: DATE, mode: 'PICKUP' }, DATE)
  await ok(world, seller, { type: 'settlement.payment', buyer: sms, date: DATE, amount: 5000, memo: '입금메모홍' }, DATE)
  return { b, sms }
}

async function linkFor(world: TestServer, seller: Seller, buyer: string, date = DATE): Promise<string> {
  const created = await linkApi(world, seller.cookie).create(date, buyer)
  expect(created.status, created.text).toBe(200)
  return tokenOf((created.body.link as { url: string }).url)
}

/** 문서의 보이는 글자 (태그를 뺀 글) */
const visibleText = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

function expectPageHeaders(headers: Headers): void {
  expect(headers.get('cache-control')).toBe('no-store')
  expect(headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
  expect(headers.get('referrer-policy')).toBe('no-referrer')
  expect(headers.get('x-frame-options')).toBe('DENY')
  expect(headers.get('x-content-type-options')).toBe('nosniff')
}

function expectDocumentCsp(headers: Headers): void {
  const csp = headers.get('content-security-policy') ?? ''
  const directives = new Map(csp.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name as string, values.join(' ')]))
  expect(directives.has('script-src')).toBe(false)
  expect(directives.get('default-src')).toBe("'none'")
  expect(directives.get('img-src')).toBe("'self'")
  expect(directives.get('frame-ancestors')).toBe("'none'")
  expect(directives.get('form-action')).toBe("'none'")
  expect(directives.get('base-uri')).toBe("'none'")
}

describe('AC-N4b-20 링크를 열면 그 구매자의 지금 확인서', () => {
  it('로그인 없이 200 HTML(스크립트 없음): 제목·가게·이름·상품 3개·최종 18,000원·부분 입금·남은 13,000원·계좌 글자·안내·끝 시각·고지, 그림·PDF·그림 저장', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller, SHOP)
    const { sms } = await smsSale(world, seller)
    const created = world.clock.now()
    const token = await linkFor(world, seller, sms)
    world.clock.advance(1000)
    const page = await openLink(world, `/r/${token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(page.text.startsWith('<!doctype html>')).toBe(true)
    expect(page.text).not.toMatch(/<script/i)
    expect(page.text).not.toMatch(/\son[a-z]+=/i)
    const text = visibleText(page.text)
    for (const expected of [
      '구매 내역 확인서',
      '다육이네',
      '김영희',
      '상품 3개',
      '품종10',
      '품종11',
      '품종12',
      '최종 결제 금액 18,000원',
      '입금 상태 부분 입금',
      '남은 금액 13,000원',
      '국민 123-45-6789 김다육',
      '입금자명은 닉네임으로 적어 주세요',
      `이 링크는 ${kstDateTimeWithDay(created + RECEIPT_LINK_TTL_MS)}까지 열 수 있어요.`,
      LEGAL_NOTICE,
      'PDF로 받기',
      '그림 저장',
    ]) {
      expect(text, expected).toContain(expected)
    }
    expect(kstDateTimeWithDay(Date.UTC(2026, 10, 4, 11, 31))).toBe('2026-11-04 (수) 20:31')
    // 그림: 같은 링크 아래 JPG(대체 글), 받기 둘
    expect(page.text).toContain(`<img src="/r/${token}/receipt.jpg" alt="구매 내역 확인서 그림">`)
    expect(page.text).toContain(`href="/r/${token}/receipt.pdf"`)
    expect(page.text).toContain(`href="/r/${token}/image.jpg"`)
    const image = await openLink(world, `/r/${token}/receipt.jpg`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
    expect(image.headers.get('content-disposition')?.startsWith('inline;')).toBe(true)
    expect(readJpeg(image.bytes)).toMatchObject({ width: 1080, components: 3 })
    expect(jpeg.decode(image.bytes).width).toBe(1080)
    const save = await openLink(world, `/r/${token}/image.jpg`)
    expect(save.headers.get('content-disposition')?.startsWith('attachment;')).toBe(true)
    expect(fileNameOf(save.headers)).toBe(`확인서-${DATE}-문자찜(김영희).jpg`)
    expect(Buffer.from(save.bytes).equals(Buffer.from(image.bytes))).toBe(true)
    const pdf = await openLink(world, `/r/${token}/receipt.pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-')
    expect(fileNameOf(pdf.headers)).toBe(`확인서-${DATE}-문자찜(김영희).pdf`)
    // 판매자 화면의 같은 시각 JPG와 같은 바이트 (같은 확인서)
    const sellerJpg = await client(world, seller.cookie).raw(`/api/days/${DATE}/receipt.jpg?buyer=${encodeURIComponent(sms)}`, {})
    expect(Buffer.from(await sellerJpg.arrayBuffer()).equals(Buffer.from(image.bytes))).toBe(true)
    for (const response of [page, image, save, pdf]) expectPageHeaders(response.headers)
    // 개인정보: 전화번호 전체·구매자 ID·문자 ref·채널 ID·다른 구매자·판매자 아이디·입금 메모가 문서·머리글 어디에도 없다
    const forbidden = ['010-1234-5678', '01012345678', sms, sms.slice('sms:'.length), 'sms:', 'UC_N', '나비', seller.loginId, seller.sellerId, '입금메모홍']
    for (const response of [page, image, save, pdf]) {
      const headerText = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n')
      for (const secret of forbidden) expect(headerText).not.toContain(secret)
    }
    for (const secret of forbidden) expect(page.text).not.toContain(secret)
  })

  it('지금 상태: 입금을 더 기록하거나 상품을 취소하면 다시 열 때 바뀐 금액·상태 (만든 시각 = 연 시각)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller, SHOP)
    const { b, sms } = await smsSale(world, seller)
    const token = await linkFor(world, seller, sms)
    expect(visibleText((await openLink(world, `/r/${token}`)).text)).toContain('입금 상태 부분 입금')
    await ok(world, seller, { type: 'settlement.payment', buyer: sms, date: DATE, amount: 13000 }, DATE)
    const paid = visibleText((await openLink(world, `/r/${token}`)).text)
    expect(paid).toContain('입금 상태 입금 완료')
    expect(paid).not.toContain('남은 금액')
    await ok(world, seller, { type: 'host.cancel', b, no: 12, buyer: sms, reason: '구매자 요청' })
    const after = visibleText((await openLink(world, `/r/${token}`)).text)
    expect(after).toContain('상품 2개')
    expect(after).toContain('최종 결제 금액 11,000원')
    expect(after).toContain('입금 상태 과입금')
  })

  it('판매자·구매자 글은 이스케이프 — 이름 <img src=x onerror=alert(1)> 이 글자로, 계좌가 없으면 계좌·안내 칸이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller, { name: '<b>가게</b>', bank: '', accountNumber: '', accountHolder: '', accountNote: '' })
    await sellMany(world, seller, DATE, [['UC_X', '<img src=x onerror=alert(1)>', 1]])
    const token = await linkFor(world, seller, 'UC_X')
    const page = await openLink(world, `/r/${token}`)
    expect(page.status).toBe(200)
    expect(page.text).not.toContain('<img src=x')
    expect(page.text).not.toContain('<b>가게')
    expect(page.text).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(page.text).toContain('&lt;b&gt;가게&lt;/b&gt;')
    // <img>는 확인서 그림 하나뿐
    expect(page.text.match(/<img /g)).toHaveLength(1)
    expect(visibleText(page.text)).not.toContain('입금 계좌')
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('AC-N4b-21 머리글·검색·미리 보기', () => {
  it('noindex·og:title 하나·title, CSP 스크립트 없음, GET·HEAD만(다른 메서드 405), 판매자 쿠키가 와도 같은 문서·세션 연장 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    const page = await openLink(world, `/r/${token}`)
    expectPageHeaders(page.headers)
    expectDocumentCsp(page.headers)
    expect(page.text).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(page.text.match(/property="og:/g)).toHaveLength(1)
    expect(page.text).toContain('<meta property="og:title" content="구매 내역 확인서">')
    expect(page.text).not.toMatch(/og:image|og:description|twitter:/)
    expect(page.text).toContain('<title>구매 내역 확인서</title>')
    // HEAD
    const head = await world.server.app.request(`/r/${token}`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect((await head.arrayBuffer()).byteLength).toBe(0)
    // 다른 메서드
    const before = await linkRows(world)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await world.server.app.request(`/r/${token}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })
      expect(response.status, method).toBe(405)
      expectPageHeaders(response.headers)
    }
    expect(await linkRows(world)).toEqual(before)
    // 판매자 세션 쿠키가 와도 같은 문서, Set-Cookie 없음
    const withCookie = await openLink(world, `/r/${token}`, { headers: { Cookie: seller.cookie } })
    expect(withCookie.text).toBe(page.text)
    expect(withCookie.headers.get('set-cookie')).toBeNull()
  })
})

describe('AC-N4b-22 열 수 없는 링크는 한 가지 답', () => {
  it('없는·모양 틀린·기간 지난·끊은·합쳐진·품목 없어진·다른 날짜로 조작한 링크 → 모두 404·같은 바이트 문서, 파일 경로도 같은 문서', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await sellMany(world, seller, DATE, [
      ['UC_A', '가람', 1],
      ['UC_B', '나비', 1],
      ['UC_C', '다솜', 1],
      ['UC_D', '라온', 1],
      ['UC_E', '마루', 1],
    ])
    const expired = await linkFor(world, seller, 'UC_A')
    world.clock.advance(RECEIPT_LINK_TTL_MS)
    const revoked = await linkFor(world, seller, 'UC_B')
    await linkApi(world, seller.cookie).revoke(DATE, 'UC_B')
    const merged = await linkFor(world, seller, 'UC_C')
    await ok(world, seller, { type: 'buyer.merge', from: 'UC_C', into: 'UC_E', reason: '같은 사람' }, DATE)
    const emptied = await linkFor(world, seller, 'UC_D')
    await ok(world, seller, { type: 'host.cancel', b, no: 4, buyer: 'UC_D', reason: '구매자 요청' })
    const moved = await linkFor(world, seller, 'UC_E')
    const pg = world.database.pglite as NonNullable<typeof world.database.pglite>
    await pg.query(`update receipt_links set date = '2026-10-25' where buyer = 'UC_E'`)
    const unknown = 'A'.repeat(43)
    const reference = await openLink(world, `/r/${unknown}`)
    expect(reference.status).toBe(404)
    expect(visibleText(reference.text)).toContain(CLOSED)
    expect(reference.text).not.toMatch(/<script/i)
    expectPageHeaders(reference.headers)
    expectDocumentCsp(reference.headers)
    const cases = [
      `/r/${unknown}`,
      '/r/short',
      `/r/${'A'.repeat(44)}`,
      `/r/${'A'.repeat(42)}=`,
      `/r/${expired}`,
      `/r/${revoked}`,
      `/r/${merged}`,
      `/r/${emptied}`,
      `/r/${moved}`,
      `/r/${expired}/receipt.jpg`,
      `/r/${revoked}/receipt.pdf`,
      `/r/${merged}/image.jpg`,
      `/r/${unknown}/receipt.jpg`,
      `/r/${unknown}/other.txt`,
    ]
    for (const path of cases) {
      const response = await openLink(world, path)
      expect(response.status, path).toBe(404)
      expect(response.headers.get('content-type'), path).toBe('text/html; charset=utf-8')
      expect(Buffer.from(response.bytes).equals(Buffer.from(reference.bytes)), path).toBe(true)
    }
  })

  it('기간: 끝나는 시각 바로 전까지 열리고 끝나는 시각부터 열리지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    world.clock.advance(RECEIPT_LINK_TTL_MS - 1)
    expect((await openLink(world, `/r/${token}`)).status).toBe(200)
    world.clock.advance(1)
    expect((await openLink(world, `/r/${token}`)).status).toBe(404)
  })

  it('소스: 받은 토큰은 SHA-256 해시로만 찾는다 (원문을 DB 값과 견주거나 DB의 암호문을 풀어 견주지 않는다)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/receipt-links.ts', import.meta.url)), 'utf8')
    const open = source.slice(source.indexOf('  async open(token: string)'))
    const body = open.slice(0, open.indexOf('\n  }\n'))
    expect(body).toContain('eq(receiptLinks.tokenHash, receiptTokenHash(token))')
    expect(body).not.toMatch(/openText|tokenEnc|=== token|token ===/)
  })
})

describe('AC-N4b-23 합치기·떼어 내기와 링크', () => {
  it('X를 Y에 합치면 LX는 열 수 없고 LY는 합친 묶음, 떼어 내면 LX는 X 묶음·LY는 Y 묶음만', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [
      ['UC_X', '엑스', 1],
      ['UC_Y', '와이', 2],
    ])
    const lx = await linkFor(world, seller, 'UC_X')
    const ly = await linkFor(world, seller, 'UC_Y')
    expect(visibleText((await openLink(world, `/r/${ly}`)).text)).toContain('상품 2개')
    await ok(world, seller, { type: 'buyer.merge', from: 'UC_X', into: 'UC_Y', reason: '같은 사람' }, DATE)
    expect((await openLink(world, `/r/${lx}`)).status).toBe(404)
    const mergedPage = visibleText((await openLink(world, `/r/${ly}`)).text)
    expect(mergedPage).toContain('상품 3개')
    expect(mergedPage).toContain('품종1')
    await ok(world, seller, { type: 'buyer.unmerge', from: 'UC_X', reason: '다른 사람' }, DATE)
    const xPage = visibleText((await openLink(world, `/r/${lx}`)).text)
    expect(xPage).toContain('상품 1개')
    expect(xPage).toContain('엑스')
    const yPage = visibleText((await openLink(world, `/r/${ly}`)).text)
    expect(yPage).toContain('상품 2개')
    expect(yPage).not.toContain('엑스')
  })
})

describe('AC-N4b-24 남용 막기·로그', () => {
  it('링크 하나에 1분 60번(문서·그림·PDF 합) 넘으면 429 문서, 1분 뒤 다시 열림, 다른 링크는 따로 센다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [
      ['UC_A', '가람', 1],
      ['UC_B', '나비', 1],
    ])
    const token = await linkFor(world, seller, 'UC_A')
    const otherToken = await linkFor(world, seller, 'UC_B')
    expect((await openLink(world, `/r/${token}/receipt.jpg`)).status).toBe(200)
    expect((await openLink(world, `/r/${token}/receipt.pdf`)).status).toBe(200)
    for (let i = 0; i < 58; i++) {
      world.clock.advance(100)
      expect((await openLink(world, `/r/${token}`)).status).toBe(200)
    }
    const limited = await openLink(world, `/r/${token}`)
    expect(limited.status).toBe(429)
    expect(visibleText(limited.text)).toContain(LATER)
    expect(limited.text).not.toMatch(/<script/i)
    expectPageHeaders(limited.headers)
    expectDocumentCsp(limited.headers)
    expect((await openLink(world, `/r/${token}/receipt.jpg`)).status).toBe(429)
    expect((await openLink(world, `/r/${otherToken}`)).status).toBe(200)
    world.clock.advance(60_000)
    expect((await openLink(world, `/r/${token}`)).status).toBe(200)
    // 로그에 토큰·/r/ 뒤 경로·구매자 이름이 없다
    const logs = world.logs.map(formatLog).join('\n')
    for (const secret of [token, otherToken, '/r/', '가람', '나비']) expect(logs).not.toContain(secret)
  })

  it('셈: 이동하는 창, 넘은 요청은 세지 않는다, 표 크기는 상한 안', () => {
    const clock = fakeClock(0)
    const limiter = new LinkRateLimiter(clock, 3, 1000)
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, true, false])
    clock.advance(999)
    expect(limiter.take('a')).toBe(false)
    clock.advance(2)
    expect(limiter.take('a')).toBe(true)
    for (let i = 0; i < 10_050; i++) limiter.take(`k${String(i)}`)
    expect(limiter.size).toBeLessThanOrEqual(10_000)
  })

  it('그림·PDF 만들기는 판매자 파일 작업 한도를 쓴다 — 바쁘면 503 "잠시 뒤 다시 열어 주세요." 문서', async () => {
    const pools = createWorkPools()
    const tight = new WorkPool({ name: 'receipts', size: 1, timeoutMs: 30_000, memoryMb: 512, perOwner: 1, maxQueue: 8 })
    const world = await newWorld({ work: { ...pools, receipts: tight } })
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    const controller = new AbortController()
    const held = tight
      .run(seller.sellerId, 'ledgerXlsx', null, {
        chunks: (async function* () {
          await new Promise((resolve) => controller.signal.addEventListener('abort', resolve))
          yield []
        })(),
      })
      .catch(() => undefined)
    const busy = await openLink(world, `/r/${token}/receipt.jpg`)
    controller.abort()
    await held
    await Promise.all([tight.close(), pools.receipts.close(), pools.documents.close(), pools.sheets.close()])
    expect(busy.status).toBe(503)
    expect(visibleText(busy.text)).toContain(LATER)
    expectPageHeaders(busy.headers)
    // 문서는 그대로 열린다 (그림은 브라우저가 따로 받는다)
    expect((await openLink(world, `/r/${token}`)).status).toBe(200)
  })
})

describe('AC-N4b-25 앱과 섞이지 않음', () => {
  it('/r·/r/는 열 수 없음 문서, 화면을 함께 내는 서버에서도 /r/<토큰>은 index.html이 아니라 링크 문서', async () => {
    const base = mkdtempSync(join(tmpdir(), 'livejjim-n4b-web-'))
    dirs.push(base)
    const webDir = join(base, 'dist')
    mkdirSync(webDir, { recursive: true })
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><head><script src="/assets/app.js"></script></head><body>APP</body></html>')
    const world = await newWorld({ webDir })
    const seller = await addSeller(world)
    await sellMany(world, seller, DATE, [['UC_A', '가람', 1]])
    const token = await linkFor(world, seller, 'UC_A')
    const page = await openLink(world, `/r/${token}`)
    expect(page.status).toBe(200)
    expect(page.text).not.toContain('APP')
    expect(page.text).toContain('구매 내역 확인서')
    for (const path of ['/r', '/r/', `/r/${token}/`, '/r/x/y/z']) {
      const response = await openLink(world, path)
      expect(response.status, path).toBe(404)
      expect(visibleText(response.text), path).toContain(CLOSED)
    }
    // 화면 주소는 그대로 index.html
    expect((await openLink(world, '/broadcasts/b1/receipts')).text).toContain('APP')
    expect([isServerPath('/r'), isServerPath('/r/abc'), isServerPath('/receipts'), isServerPath('/rehearsal')]).toEqual([true, true, false, false])
  })
})
