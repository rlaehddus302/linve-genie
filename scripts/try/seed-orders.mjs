// 연습 서버에 주문 탭 보기용 자료 넣기 (D-UX4-124, 사용자 지시 2026-11-11 "아무 데이터도 없어서 … 볼 수가 없어. 임의로 데이터를 넣어봐").
// 켜 둔 연습 서버(pnpm try — 이 컴퓨터 127.0.0.1만)에만 쓴다. 운영 서버 주소는 받지 않는다.
//   node scripts/try/seed-orders.mjs --password <연습 비밀번호> [--port 7700] [--date 2026-11-11]
//   (비밀번호를 안 주면 /private/tmp/claude-501/try.log 같은 연습 창 기록에서 찾지 않는다 — LIVEGENIE_TRY_PASSWORD 환경 변수로도 받는다)
// 날짜 하나에 손님 8명을 단계마다 다른 상태로 넣는다:
//   정보 못 받음 2 · 확인서 안 보냄 1 · 입금 기다림 1 · 부분 입금 1 · 더 받음(돌려줄 돈) 1 · 다 끝남 2(택배 1·직접 수령 1)
// 그리고 앞 날짜 하나에는 다 끝난 손님 2명(→ "모두 끝났어요"·[포장하러 가기]).
import { randomUUID } from 'node:crypto'

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}
const port = Number(arg('port', '7700'))
const password = arg('password', process.env['LIVEGENIE_TRY_PASSWORD'] ?? '')
if (password === '') {
  console.error('연습 비밀번호를 --password 로 주세요 (pnpm try 창에 보여요).')
  process.exit(1)
}
const origin = `http://localhost:${String(port)}`
const kstNow = () => new Date(Date.now() + 9 * 3600_000)
const today = kstNow().toISOString().slice(0, 10)
const date = arg('date', today)
const earlier = arg('done-date', new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))

let cookie = ''
async function call(method, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie === '' ? {} : { Cookie: cookie }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const json = text === '' ? {} : JSON.parse(text)
  if (!response.ok) throw new Error(`${method} ${path} → ${String(response.status)} ${text.slice(0, 300)}`)
  return { json, response }
}
const rid = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
// 라이브(b)가 있는 입력은 날짜를 따로 적지 않는다 — 정산 입력만 ?date=
const event = (day, body) => call('POST', body.b === undefined ? `/api/events?date=${day}` : '/api/events', { requestId: rid('ev'), ...body })

const login = await call('POST', '/api/login', { loginId: 'practice', password })
cookie = (login.response.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/).map((part) => part.split(';')[0].trim()).join('; ')

await call('PUT', '/api/shop', { name: '연습 가게', bank: '농협', accountNumber: '302-1234-5678-90', accountHolder: '연습판매자', accountNote: '입금자명은 닉네임으로 적어 주세요' })

const address = (name, phone) => ({ name, phone, address: '경상남도 양산시 물금읍 범어로 12', detail: '101동 1001호', zip: '50615', memo: '' })
const hms = () => kstNow().toISOString().slice(11, 19)

/** 날짜 하나: 라이브 → 상품 → 문자찜 손님마다 상태 */
async function day(day, title, buyers) {
  const created = await call('POST', '/api/broadcasts', { requestId: rid('bc'), date: day, title })
  const b = created.json.broadcast.id
  const products = [
    ['핑크프릴', 12000],
    ['라울', 15000],
    ['금황', 8000],
    ['환엽롱기', 20000],
    ['블루엘프', 9000],
    ['홍옥', 6000],
    ['을녀심', 11000],
    ['레티지아', 7000],
    ['프리티', 13000],
    ['코노피튬', 18000],
  ]
  let no = 0
  for (const [name, price] of products) await event(day, { type: 'product.register', b, no: ++no, name, price, stock: 5 })
  for (const buyer of buyers) {
    let first = null
    for (const item of buyer.items) {
      const claimed = await event(day, { type: 'sms', b, no: item, received: hms(), phone: buyer.phone, memo: buyer.nick })
      first ??= claimed.json.buyer
    }
    const id = first
    if (buyer.pickup === true) await event(day, { type: 'settlement.shippingOverride', buyer: id, date: day, mode: 'PICKUP' })
    if (buyer.address === true) await call('PUT', `/api/parcels/days/${day}/address`, { requestId: rid('pa'), buyer: id, address: address(buyer.nick, buyer.phone) })
    if (buyer.receipt === true) await call('POST', `/api/days/${day}/receipt-links`, { requestId: rid('rl'), buyer: id })
    if (buyer.pay !== undefined) {
      const settled = await call('GET', `/api/days/${day}`)
      const settlements = settled.json.settlements ?? []
      const mine = settlements.find((s) => s.buyer === id)
      const total = mine?.total ?? 0
      const amount = buyer.pay === 'full' ? total : buyer.pay === 'over' ? total + 5000 : Math.floor(total / 2)
      await event(day, { type: 'settlement.payment', buyer: id, date: day, amountText: String(amount), memo: '연습 입금' })
    }
    console.log(`${day} ${buyer.nick}: ${buyer.note}`)
  }
}

await day(earlier, '지난 라이브 (다 끝남)', [
  { nick: '새벽이슬', phone: '010-2000-0001', items: [1], address: true, receipt: true, pay: 'full', note: '다 끝남' },
  { nick: '꽃밭지기', phone: '010-2000-0002', items: [2, 3], address: true, receipt: true, pay: 'full', note: '다 끝남' },
])
await day(date, '오늘 다육 라이브', [
  { nick: '다육맘', phone: '010-1000-0001', items: [1, 2], note: '정보 받기 (배송지 없음·확인서 전·미입금)' },
  { nick: '초록손', phone: '010-1000-0002', items: [3], pay: 'full', note: '정보 받기 (입금은 끝)' },
  { nick: '나래', phone: '010-1000-0003', items: [4], address: true, note: '확인서 보내기 (배송지 있음)' },
  { nick: '선인장', phone: '010-1000-0004', items: [5, 6], address: true, receipt: true, note: '입금 기다림' },
  { nick: '물방울', phone: '010-1000-0005', items: [7, 8], address: true, receipt: true, pay: 'half', note: '부분 입금 (남은 금액)' },
  { nick: '햇살', phone: '010-1000-0006', items: [9], address: true, receipt: true, pay: 'over', note: '더 받음 (돌려줄 돈)' },
  { nick: '구름', phone: '010-1000-0007', items: [10], address: true, receipt: true, pay: 'full', note: '다 끝남 (택배)' },
  { nick: '바람', phone: '010-1000-0008', items: [2], pickup: true, receipt: true, pay: 'full', note: '다 끝남 (직접 수령)' },
])
console.log(`넣었어요. 주문 탭에서 ${date}(할 일 있음)과 ${earlier}(다 끝남)을 골라 보세요.`)
