// AC-S00-22: 형식 계약 위반 = 읽기 오류. 범주마다 픽스처 하나 이상 (fixtures/read-errors/).
// 허용 목록과 상관없이 실패하고, 메시지에 파일·위치(문서 번호·시나리오 ID·events[n])·이유가 나온다.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatReport } from './report.ts'
import { run, scenario } from './test-helpers.ts'

const DIR = new URL('./fixtures/read-errors/', import.meta.url)
const read = (name: string): string => readFileSync(new URL(name, DIR), 'utf8')

interface Expected {
  /** 문서 번호 (파일 전체 오류면 생략) */
  readonly doc?: number
  readonly label?: string
  /** [경로, 메시지 일부] — 문서의 모든 지적과 정확히 같아야 한다 */
  readonly issues: readonly (readonly [string | undefined, string])[]
}

const CASES: Readonly<Record<string, { category: string; loaded?: number; errors: readonly Expected[] }>> = {
  '01-document-kind.yaml': {
    category: '1. suite도 id도 없는 문서, 모르는 suite 이름',
    errors: [
      { doc: 1, issues: [[undefined, 'suite도 id도 없는 문서']] },
      { doc: 2, label: 'chatt', issues: [['suite', '모르는 suite 이름 "chatt"']] },
      { doc: 3, issues: [[undefined, 'suite와 id가 함께 있다']] },
    ],
  },
  '02-case-format.yaml': {
    category: '2. 사례에 in·out 외의 키, suite별 out 형식 위반',
    errors: [
      {
        doc: 1,
        label: 'chat',
        issues: [
          ['cases[0].note', "모르는 사례 키 'note'"],
          ['cases[1].in', '문자열이어야 한다'],
          ['cases[2].out.claim', "모르는 chat out 키 'claim'"],
          ['cases[3].out.claims', '1 이상 정수 목록'],
          ['cases[4]', "필수 사례 키 'out'"],
        ],
      },
      {
        doc: 2,
        label: 'quick-input',
        issues: [
          ['cases[0].out', "필수 quick-input 성공 out 키 'price'"],
          ['cases[1].out.price', "모르는 quick-input 실패 out 키 'price'"],
          ['cases[2].out.error', 'PRICE_MISSING / NUMBER_MISSING'],
        ],
      },
      {
        doc: 3,
        label: 'amount',
        issues: [
          ['cases[0].out', '0 이상 정수(원) 또는 null'],
          ['cases[1].out', '0 이상 정수(원) 또는 null'],
        ],
      },
      {
        doc: 4,
        label: 'korean-number',
        issues: [
          ['settings.unit', "suite 'korean-number'에 없는 설정 키 'unit'"],
          ['cases[0].out', '1 이상 정수 또는 null'],
        ],
      },
    ],
  },
  '03-scenario-keys.yaml': {
    category: '3. 시나리오 필수 키 없음, ID 형식 오류·중복',
    loaded: 1,
    errors: [
      { doc: 1, label: 'G-ENG-901', issues: [[undefined, "필수 키 'refs'가 없다"]] },
      { doc: 2, label: 'G-ENG-01', issues: [['id', '시나리오 ID 형식 오류']] },
      { doc: 3, label: 'G-ENG-903', issues: [['note', "모르는 키 'note'"]] },
      { doc: 5, label: 'G-ENG-904', issues: [['id', '시나리오 ID 중복 (처음: fixtures/03-scenario-keys.yaml 문서 4)']] },
      // S04(D-070): broadcasts는 빈 목록도 된다(서버처럼 broadcast.start로 선언) — 계약 변경으로 'broadcasts 1개 이상' 지적을 뺐다(약화 아님)
      { doc: 6, label: 'G-ENG-906', issues: [['refs', '1개 이상']] },
    ],
  },
  '04-event-type.yaml': {
    category: '4. 모르는 이벤트 종류',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0].type', '모르는 이벤트 종류 "chat.message"'],
          ['events[1]', '이벤트 종류(type)가 없다'],
        ],
      },
    ],
  },
  '05-event-fields.yaml': {
    category: '5. 이벤트 필수 필드 없음, 모르는 필드, 값 형식 오류',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0]', "필수 필드 'price'가 없다"],
          ['events[1].stok', "모르는 필드 'stok'"],
          ['events[2].no', '1 이상 정수'],
          ['events[2].price', '0 이상 정수'],
          ['events[3].text', '문자열이어야 한다'],
          ['events[3].owner', 'true 또는 false'],
          ['events[4].ch', "'sms:'로 시작할 수 없다"],
          ['events[5].msg', '시나리오에 없는 채팅 메시지 ID "m9"'],
          ['events[6].buyer', "ref 's9'인 문자찜이 없다"],
          ['events[7]', 'mode FIXED에는 amount가 필요하다'],
          ['events[8].amount', 'amount는 mode FIXED일 때만'],
          ['events[9].reason', '빈 문자열이 아닌'],
        ],
      },
    ],
  },
  '05-event-fields-host.yaml': {
    category: '5. (S02 어휘) host.assign replace·replaceTo 짝, host.reopen·host.dismissCancel 필드',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0]', "replace와 replaceTo는 함께 쓴다 ('replace'만 있다)"],
          ['events[1]', "replace와 replaceTo는 함께 쓴다 ('replaceTo'만 있다)"],
          ['events[2].replaceTo', 'WAITLIST / CANCEL 중 하나'],
          ['events[3]', "필수 필드 'reason'가 없다"],
          ['events[4]', "필수 필드 'reason'가 없다"],
          ['events[5].buyer', "모르는 필드 'buyer'"],
          ['events[6]', "필수 필드 'buyer'가 없다"],
          ['events[7].reason', '빈 문자열이 아닌'],
          ['events[8].replace', "ref 's9'인 문자찜이 없다"],
        ],
      },
    ],
  },
  '05-event-fields-settlement.yaml': {
    category: '5. (S03 어휘) settlement.shippingOverride mode DEFAULT에 amount',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[1].amount', 'amount는 mode FIXED일 때만'],
          ['events[2].mode', 'PICKUP / COMBINED / FIXED / DEFAULT 중 하나'],
        ],
      },
    ],
  },
  '06-undeclared-broadcast.yaml': {
    category: '6. 선언하지 않은 방송',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0].b', '선언하지 않은 방송 "b9"'],
          ['expect.products.b9/15', "선언하지 않은 방송 'b9'"],
          ['expect.buyers.UC_A.byBroadcast.b9', "선언하지 않은 방송 'b9'"],
        ],
      },
    ],
  },
  '07-time-format.yaml': {
    category: '7. at·publishedAt·received·date 형식 오류, 오프셋 없는 ISO',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0].at', '시각 형식 오류 "20:00"'],
          ['events[1].at', '오프셋 없는 ISO'],
          ['events[2].at', '없는 시각 "24:00:00"'],
          ['events[3].at', '시각 형식 오류 "20:00:03.1234"'],
          ['events[4].at', '시각 형식 오류 "2026-10-18T20:00:04+9:00"'],
          ['events[5].at', 'at은 문자열이어야 한다'],
          ['events[6].publishedAt', '시각 형식 오류 "8:00:00"'],
          ['events[7].received', '수신 시각 형식 오류 "8:01"'],
          ['events[8].received', '수신 시각 형식 오류 "20:01:05.5"'],
          ['events[9].date', '날짜 형식 오류 "2026-13-01"'],
        ],
      },
      { doc: 2, label: 'G-ENG-902', issues: [['broadcasts[0].date', '날짜 형식 오류 "2026-02-29"']] },
    ],
  },
  '08-at-reverse.yaml': {
    category: '8. at 역행',
    errors: [{ doc: 1, label: 'G-ENG-901', issues: [['events[2].at', 'at 역행: events[1]보다 이르다']] }],
  },
  '09-mixed-dates-short-at.yaml': {
    category: '9. 날짜가 섞인 시나리오에서 방송 없는 이벤트의 짧은 at',
    loaded: 1,
    errors: [{ doc: 1, label: 'G-ENG-901', issues: [['events[1].at', '날짜가 다른 방송이 섞인 시나리오에서 방송(b) 없는 이벤트의 짧은 at']] }],
  },
  // S03b(D-067): 같은 ref는 재전송 사본이라 읽기 오류가 아니다 — "ref 중복" 픽스처를 계약 변경으로 "ref 형식"으로 교체했다(약화 아님)
  '10-sms-ref-format.yaml': {
    category: '10. sms ref 형식 위반 (영문·숫자·_·- 1~64자)',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[3].ref', '(값: "")'],
          ['events[4].ref', '(값: "김영희")'],
          ['events[5].ref', '(값: "s 1")'],
          ['events[6].ref', '(값: "s:1")'],
          ['events[7].ref', '(값: "010-1234-5678 ")'],
          ['events[8].ref', '1~64자'],
          ['events[9].ref', '(값: 15)'],
        ],
      },
    ],
  },
  '11-settings.yaml': {
    category: '11. 모르는 설정 키나 값',
    errors: [
      { doc: 1, label: 'G-ENG-901', issues: [['settings.waitlist.maxx', "모르는 설정 키 'waitlist.maxx'"]] },
      { doc: 2, label: 'G-ENG-902', issues: [['settings.cancel.buyerChat', 'OFF / REQUEST / AUTO 중 하나']] },
      // S04(D-071): 무료배송 기준에도 상한이 생겨 문구가 바뀌었다
      { doc: 3, label: 'G-ENG-903', issues: [['settings.shipping.freeThreshold', '0 이상 100000000 이하 정수 또는 null']] },
      { doc: 4, label: 'G-ENG-904', issues: [['settings.claim.ignoreOwner', 'true 또는 false']] },
      { doc: 5, label: 'chat', issues: [['settings.parseMode', 'STRICT / LOOSE 중 하나']] },
      // S04(D-071): 설정값 범위 — 최댓값 + 1, 최솟값 - 1, 정수가 아닌 수
      {
        doc: 6,
        label: 'G-ENG-905',
        issues: [
          ['settings.claim.maxNumber', '1 이상 9999 이하 정수여야 한다 (값: 10000)'],
          ['settings.claim.preOpenWindowSec', '0 이상 300 이하 정수여야 한다 (값: 301)'],
          ['settings.waitlist.max', '0 이상 100 이하 정수여야 한다 (값: -1)'],
          ['settings.shipping.baseFee', '0 이상 1000000 이하 정수여야 한다 (값: 1000001)'],
          ['settings.shipping.freeThreshold', '0 이상 100000000 이하 정수 또는 null이어야 한다 (값: 100000001)'],
          ['settings.thanks.batchWindowSec', '0 이상 600 이하 정수여야 한다 (값: 0.5 (YAML 실수 표기))'],
        ],
      },
      { doc: 7, label: 'chat', issues: [['settings.maxNumber', '1 이상 9999 이하 정수여야 한다 (값: 0)']] },
    ],
  },
  '12-expect-keys.yaml': {
    category: '12. 모르는 expect 키 (최상위·하위, 중간 검사 포함)',
    errors: [
      { doc: 1, label: 'G-ENG-901', issues: [['expect.prodcuts', "모르는 expect 키 'prodcuts'"]] },
      { doc: 2, label: 'G-ENG-902', issues: [['expect.products.b1/15.winer', "모르는 상품 expect 키 'winer'"]] },
      {
        doc: 3,
        label: 'G-ENG-903',
        issues: [
          ['events[0].expect.buyers.UC_A.total', "모르는 구매자 expect 키 'total'"],
          ['events[1].at', "모르는 중간 검사 키 'at'"],
        ],
      },
      {
        doc: 4,
        label: 'G-ENG-904',
        issues: [
          ['expect.settlements.UC_A@2026-10-18.totl', "모르는 정산 expect 키 'totl'"],
          ['expect.effects[0].buyr', "모르는 키 'buyr'"],
          ['expect.claims[0].why', "모르는 키 'why'"],
        ],
      },
    ],
  },
  '13-enums.yaml': {
    category: '13. 열거값 오류',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0].status', 'OPEN / READY 중 하나'],
          ['expect.products.b1/15.status', '(값: "SOLDOUT")'],
          ['expect.settlements.UC_A@2026-10-18.payment', '(값: "DONE")'],
          ['expect.effects[0].kind', '(값: "PRINT_LABEL")'],
          ['expect.effects[0].target', '(값: "CHAT")'],
          ['expect.effectCounts.PRINT_LABEL', '(값: "PRINT_LABEL")'],
          ['expect.claims[0].reason', '(값: "SOLDOUT")'],
        ],
      },
    ],
  },
  '14-key-format.yaml': {
    category: '14. 상품 키·정산 키 형식 오류',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['expect.products.b1-15', "상품 키 형식 오류 'b1-15'"],
          ['expect.products.b1/015', "상품 키 형식 오류 'b1/015'"],
          ['expect.buyers.UC_A.items[0]', "상품 키 형식 오류 'b1/0'"],
          ['expect.settlements.UC_A@2026-1-1', '날짜 형식 오류'],
          ['expect.settlements.UC_A', "정산 키 형식 오류 'UC_A'"],
          ['expect.claims[0].product', "선언하지 않은 방송 'b2'"],
          ['expect.pending.b1/15[0]', "ref 'zz'인 문자찜이 없다"],
        ],
      },
    ],
  },
  '15-yaml-syntax.yaml': {
    category: '15. YAML 문법 오류',
    errors: [{ issues: [[undefined, 'YAML 오류']] }],
  },
  '15-yaml-duplicate-key.yaml': {
    category: '15. YAML 문법 오류 (중복 키)',
    errors: [{ issues: [[undefined, 'unique']] }],
  },
  '15-yaml-tag.yaml': {
    category: '15. YAML 문법 오류 (core schema 밖의 태그)',
    errors: [{ issues: [[undefined, '명시적 태그']] }],
  },
  '16-buyer-phone-last4.yaml': {
    category: '16. 구매자 뒤 4자리(phoneLast4)가 숫자 4자리 문자열·null이 아님 (S03b)',
    errors: [
      { doc: 1, label: 'G-ENG-901', issues: [['events[1].expect.buyers.sms:s1.phoneLast4', '(값: 5678)']] },
      {
        doc: 2,
        label: 'G-ENG-902',
        issues: [
          ['expect.buyers.sms:s1.phoneLast4', '(값: 0)'],
          ['expect.buyers.sms:s2.phoneLast4', '(값: "567")'],
          ['expect.buyers.sms:s3.phoneLast4', '(값: "５６７８")'],
        ],
      },
    ],
  },
  '17-broadcast.yaml': {
    category: '17. 방송 시작·종료 — 선언 전 방송 사용(이벤트·중간 검사), broadcast.start 필드·설정 범위, broadcasts.<b> 키 (S04)',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[0].b', '선언하지 않은 방송 "b2"'],
          ['events[1].b', '선언하지 않은 방송 "b2"'],
          ['events[2].expect.broadcasts.b2', "선언하지 않은 방송 'b2'"],
          ['events[2].expect.products.b2/15', "선언하지 않은 방송 'b2'"],
        ],
      },
      {
        doc: 2,
        label: 'G-ENG-902',
        issues: [
          ['events[0].b', '방송 ID는 공백'],
          ['events[1].date', '날짜 형식 오류 "2026-10-32"'],
          ['events[2]', "필수 필드 'title'가 없다"],
          ['events[3].settings.waitlist.maxx', "모르는 설정 키 'waitlist.maxx'"],
          ['events[3].settings.waitlist.max', '0 이상 100 이하 정수여야 한다 (값: 101)'],
          ['events[3].settings.shipping.freeThreshold', '0 이상 100000000 이하 정수 또는 null이어야 한다 (값: -1)'],
          ['events[3].settings.claim.parseMode', 'STRICT / LOOSE 중 하나'],
          ['events[4].settings', '맵이어야 한다'],
          ['events[5].at2', "모르는 필드 'at2'"],
        ],
      },
      {
        doc: 3,
        label: 'G-ENG-903',
        issues: [
          ['expect.broadcasts.b1.endd', "모르는 방송 expect 키 'endd'"],
          ['expect.broadcasts.b1.date', '날짜 형식 오류 "2026-1-1"'],
          ['expect.broadcasts.b1.title', '문자열이어야 한다 (값: 1)'],
          ['expect.broadcasts.b1.ended', 'true 또는 false여야 한다 (값: "아니오")'],
          ['expect.broadcasts.b9', "선언하지 않은 방송 'b9'"],
        ],
      },
    ],
  },
  '18-sms-phone-shaped.yaml': {
    category: '18. sms ref·memo에 휴대폰 번호가 들어 있음 (S04, D-073)',
    errors: [
      {
        doc: 1,
        label: 'G-ENG-901',
        issues: [
          ['events[2].ref', '휴대폰 번호가 들어 있다 — 번호는 phone에만 적는다 (값: "01012345678")'],
          ['events[3].ref', '(값: "s01012345678")'],
          ['events[4].memo', '(값: "김영희 010 1234 5678")'],
          ['events[5].memo', '(값: "０１０-１２３４-５６７８")'],
          ['events[7].memo', '(값: "3시 010-1234-5678")'],
          ['events[8].memo', '(값: "010-1234-5678 2개")'],
          ['events[9].memo', '(값: "+82 10-1234-5678")'],
          ['events[10].ref', '(값: "r-010-1234-5678-2")'],
        ],
      },
    ],
  },
}

describe('형식 계약 위반 = 읽기 오류 (AC-S00-22)', () => {
  it('fixtures/read-errors의 모든 파일에 기대값이 있다 (범주 1~18)', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.yaml'))
    expect(files.sort()).toEqual(Object.keys(CASES).sort())
    const categories = new Set(Object.values(CASES).map((c) => Number(c.category.split('.')[0])))
    expect([...categories].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  for (const [file, { category, loaded = 0, errors }] of Object.entries(CASES)) {
    it(`${category} — ${file}`, () => {
      const report = run([{ path: `fixtures/${file}`, text: read(file) }])
      expect(report.ok).toBe(false)
      expect(report.totals.readError).toBe(errors.length)
      expect(report.totals.scenarios + report.totals.parserCases).toBe(loaded)
      expect(report.readErrors).toHaveLength(errors.length)
      errors.forEach((want, i) => {
        const got = report.readErrors[i]
        expect(got?.file).toBe(`fixtures/${file}`)
        expect(got?.docIndex).toBe(want.doc)
        expect(got?.label).toBe(want.label)
        expect(got?.issues.map((issue) => issue.path)).toEqual(want.issues.map(([path]) => path))
        want.issues.forEach(([, message], j) => expect(got?.issues[j]?.message).toContain(message))
        for (const issue of got?.issues ?? []) expect(issue.line).toBeTypeOf('number')
      })
      // 보고에 파일·문서 번호·ID·경로·줄이 나온다
      const text = formatReport(report)
      for (const want of errors) {
        const head = [`fixtures/${file}`, ...(want.doc === undefined ? [] : [`문서 ${want.doc}`]), ...(want.label === undefined ? [] : [want.label])]
        expect(text).toContain(`✗ 읽기 오류 · ${head.join(' · ')}`)
      }
    })
  }

  it('줄 번호는 문제가 있는 줄을 가리킨다', () => {
    const text = read('05-event-fields.yaml')
    const lineOf = (needle: string): number => text.split('\n').findIndex((line) => line.includes(needle)) + 1
    const report = run([{ path: 'f.yaml', text }])
    const issues = report.readErrors[0]?.issues ?? []
    expect(issues.find((i) => i.path === 'events[1].stok')?.line).toBe(lineOf('stok: 2'))
    expect(issues.find((i) => i.path === 'events[5].msg')?.line).toBe(lineOf('msg: m9'))
  })

  it('한 파일의 오류가 다른 파일 결과를 가리지 않는다 — 나머지 파일·문서는 계속 처리', () => {
    const good = scenario({ id: 'G-ENG-950', expect: { products: {} } })
    const files = [
      ...Object.keys(CASES).map((file) => ({ path: `fixtures/${file}`, text: read(file) })),
      { path: 'fixtures/zz-good.yaml', text: good },
    ]
    const report = run(files, { fake: { snapshot: () => ({ buyerKeys: {}, broadcasts: {}, products: {}, buyers: {}, settlements: {}, effects: [], claims: [], pending: {}, cancelRequests: [] }) } })
    const expectedErrors = Object.values(CASES).reduce((sum, c) => sum + c.errors.length, 0)
    expect(report.totals.readError).toBe(expectedErrors)
    // 03의 정상 문서(G-ENG-904)·09의 정상 문서(G-ENG-902)·좋은 파일이 모두 실행된다
    expect(report.items.map((item) => (item.kind === 'scenario' ? `${item.file}:${item.id}:${item.status}` : ''))).toEqual([
      'fixtures/03-scenario-keys.yaml:G-ENG-904:pass',
      'fixtures/09-mixed-dates-short-at.yaml:G-ENG-902:pass',
      'fixtures/zz-good.yaml:G-ENG-950:pass',
    ])
    expect(report.ok).toBe(false)
  })

  it('허용 목록에 있는 시나리오라도 읽기 오류면 실패 (목록의 패턴은 읽기 오류 문서의 ID와도 맞는다)', () => {
    const text = [scenario({ id: 'G-ENG-901' }), scenario({ id: 'G-ENG-902', expect: { prodcuts: {} } })].join('---\n')
    const report = run(text, { allowlist: 'scenarios: ["G-ENG-90*"]\n' })
    expect(report.readErrors.map((e) => e.label)).toEqual(['G-ENG-902'])
    expect(report.totals.readError).toBe(1)
    expect(report.totals.notImplementedAllowed).toBe(1)
    expect(report.ok).toBe(false)
  })
})
