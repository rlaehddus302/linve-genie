// 앱 안 우체국 화면 (D-UX3-37): 송장번호 짝짓기와 방문접수 화면 자동 채우기 스크립트.
// 스크립트는 우체국 화면과 같은 칸 이름·함수(genAmtForm, setCommOpenerMemAddress, getWishDay·getWishTime, #fncRegFile, setGridRowsToAddressFile)를 가진 시험 화면에서 돌린다.
// [신청]·결제·비밀번호는 건드리지 않고, 보내는 요청은 우체국 [파일(주소) 등록] 창이 보내던 세 요청뿐이어야 한다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EPOST_DESKTOP_AGENT, splitPhone, type EpostKit } from '../src/epost/kit.ts'
import { hasName, invoiceCandidates, matchInvoices } from '../src/epost/match.ts'
import { COUNTER_AGREE_SCRIPT, ROWS_SCRIPT, counterFillScript, visitFillScript } from '../src/epost/scripts.ts'

const receivers = [
  { buyer: 'u1', name: '홍길동', phone: '01012345678' },
  { buyer: 'u2', name: '김다육', phone: '01098765432' },
  { buyer: 'u3', name: '김다육', phone: '01011112222' },
]

describe('송장번호 짝짓기', () => {
  it('등기번호 후보는 숫자 13자리 (사이 `-`·공백 하나는 뺀다), 전화번호·날짜·더 긴 숫자는 아니다', () => {
    expect(invoiceCandidates('등기번호 6070123456789 접수')).toEqual(['6070123456789'])
    expect(invoiceCandidates('6070-1234-56789 / 60701 2345 6790')).toEqual(['6070123456789', '6070123456790'])
    expect(invoiceCandidates('010-1234-5678 2026-11-06 12345678901234')).toEqual([])
  })

  it('이름은 그대로 또는 가운데를 가린 모양(홍*동), 첫 글자는 같아야', () => {
    expect(hasName('받는분 홍길동', '홍길동')).toBe(true)
    expect(hasName('받는분 홍*동', '홍길동')).toBe(true)
    expect(hasName('받는분 *길동', '홍길동')).toBe(false)
    expect(hasName('받는분 홍길순', '홍길동')).toBe(false)
  })

  it('한 줄에 이름이 하나로 정해질 때만 — 같은 이름은 전화번호 뒤 4자리로, 못 맞춘 송장번호는 따로', () => {
    const result = matchInvoices(
      [
        '1 홍*동 서울특별시 중구 6070123456789 접수완료',
        '2 김다육 010-****-2222 6070123456790',
        '3 김다육 6070123456791',
        '합계 6070123456789 6070123456790',
        '4 모르는분 6070123456792',
      ],
      receivers,
    )
    expect(result.matches).toEqual([
      { buyer: 'u1', name: '홍길동', invoice: '6070123456789' },
      { buyer: 'u3', name: '김다육', invoice: '6070123456790' },
      { buyer: 'u2', name: '김다육', invoice: '6070123456791' },
    ])
    expect(result.unmatched).toEqual(['6070123456792'])
  })

  it('전화번호 세 칸', () => {
    expect(splitPhone('01012345678')).toEqual({ mobile: true, parts: ['010', '1234', '5678'] })
    expect(splitPhone('0311234567')).toEqual({ mobile: false, parts: ['031', '123', '4567'] })
    expect(splitPhone('0212345678')).toEqual({ mobile: false, parts: ['02', '1234', '5678'] })
    expect(splitPhone('123')).toBeNull()
  })
})

const kit: EpostKit = {
  date: '2026-11-06',
  sender: { name: '다육이네', phone: '0311234567', zip: '16490', address: '경기도 수원시 팔달구 효원로 1', detail: '1층' },
  receivers: [{ buyer: 'u1', name: '홍길동', phone: '01012345678', zip: '04524', address: '서울특별시 중구 세종대로 110', detail: '101동', memo: '', qty: 1, content: '물품 1개', kg: 5, cm: 80 }],
  file: { name: 'x.xlsx', base64: Buffer.from('PK\u0003\u0004test').toString('base64') },
}

const IMPORT_XML = `<?xml version='1.0' encoding="UTF-8"?><xsync><LData><list><![CDATA[[['gridReName': '홍길동', 'gridReZipcd': '04524', 'gridRePostAddr': '서울특별시 중구 세종대로 110', 'gridReDetailAddr': '101동', 'gridReCell': '010-1234-5678', 'gridLimit_wg': '5', 'gridLimit_vol': '80'], ['gridReName': '김다육', 'gridReZipcd': '6', 'gridRePostAddr': '경상남도 양산시', 'gridReDetailAddr': '.', 'gridReCell': '010-9876-5432', 'gridLimit_wg': '5', 'gridLimit_vol': '80']]]]></list><state>S</state></LData></xsync>`

type Win = Window & Record<string, unknown>

/** 우체국 방문접수 화면처럼 생긴 시험 화면 */
function visitPage(options: { day: string } = { day: '20261107' }) {
  document.body.innerHTML = `
    <form id="genAmtForm">
      <input id="labname" name="custName" />
      <input id="cell1" name="cell1" /><input id="labmobile_num" name="cell2" /><input id="cell3" name="cell3" />
      <input id="labphone1" name="phone1" /><input id="phone2" name="phone2" /><input id="phone3" name="phone3" />
      <input id="labemail" name="email" />
      <input type="radio" name="method" id="method0" value="1" checked /><input type="radio" name="method" id="method1" value="3" />
      <input id="guest_orderpw" type="password" />
      <button id="reqBtn" type="button">신청</button>
    </form>
    <a id="fncRegFile" href="#">파일(주소) 등록</a>`
  const w = window as unknown as Win
  const calls: { address?: unknown[]; grid?: string; alerts: string[]; messages: Record<string, unknown>[]; requested: string[]; reserve: number } = { alerts: [], messages: [], requested: [], reserve: 0 }
  let rowCount = 0
  w['setCommOpenerMemAddress'] = (...args: unknown[]) => {
    calls.address = args
  }
  w['getWishDay'] = () => options.day
  w['getWishTime'] = () => (options.day === '' ? '' : '오전')
  w['dataProvider'] = { getRowCount: () => rowCount }
  w['setGridRowsToAddressFile'] = (json: string) => {
    calls.grid = json
    rowCount = (JSON.parse(json) as unknown[]).length
    return ['총 2건 신청목록에 추가되었습니다.']
  }
  w['$'] = () => ({ dialog: () => undefined })
  w['alert'] = (text: string) => calls.alerts.push(text)
  w['ReactNativeWebView'] = { postMessage: (data: string) => calls.messages.push(JSON.parse(data) as Record<string, unknown>) }
  document.getElementById('reqBtn')!.addEventListener('click', () => calls.reserve++)
  // 화면의 [파일(주소) 등록]: 화면이 자기 확인을 한 뒤 창을 연다
  document.getElementById('fncRegFile')!.addEventListener('click', (event) => {
    event.preventDefault()
    window.open('/general.UseGridAddressFile.parcel?', 'popRegFile')
  })
  w.open = (() => {
    calls.requested.push('popup')
    return null
  }) as typeof window.open
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.requested.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.startsWith('/general.UseGridAddressFile.parcel')) return new Response('<input type="hidden" name="tempCode" value="189982587" />')
      if (url.startsWith('/general.NewUpLoadFileCmdNew.parcel')) return new Response('<script>parent.fileUpload(1)</script>')
      if (url.startsWith('/general.NewCreateFileImportNew.parcel')) return new Response(IMPORT_XML)
      return new Response('', { status: 404 })
    }),
  )
  return calls
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20))
}

afterEach(() => {
  vi.unstubAllGlobals()
  const w = window as unknown as Win
  delete w['__ljEpost']
})

describe('방문접수 화면 자동 채우기', () => {
  it('보내는 분 칸·주소(화면 함수)·메일 미수신 → 날짜가 정해지면 [파일(주소) 등록]을 눌러 창 대신 세 요청 → 목록에 넣는다. [신청]은 누르지 않는다', async () => {
    const calls = visitPage()
    window.eval(visitFillScript(kit))
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value
    expect([value('labname'), value('labphone1'), value('phone2'), value('phone3'), value('cell1')]).toEqual(['다육이네', '031', '123', '4567', ''])
    expect((document.getElementById('method1') as HTMLInputElement).checked).toBe(true)
    expect(calls.address).toEqual(['16490', '경기도 수원시 팔달구 효원로 1', '1층'])
    await until(() => calls.messages.some((message) => message['type'] === 'upload' && message['ok'] !== undefined))
    expect(calls.requested).toEqual([
      'GET /general.UseGridAddressFile.parcel?',
      'POST /general.NewUpLoadFileCmdNew.parcel?tempCode=189982587&isHeader=1&filetype=t3&fkind=xlsx',
      'POST /general.NewCreateFileImportNew.parcel?tempCode=189982587&isHeader=1&filetype=t3&fkind=xlsx',
    ])
    const upload = (vi.mocked(fetch).mock.calls[1]![1]!.body as FormData)
    expect([upload.get('okChk'), upload.get('ext'), upload.get('filetype'), upload.get('tempCode'), upload.get('fkind'), (upload.get('fileName') as File).name]).toEqual(['n', '1', 't3', '189982587', 'xlsx', 'epost-visit.xlsx'])
    expect((JSON.parse(calls.grid!) as { gridReName: string }[]).map((row) => row.gridReName)).toEqual(['홍길동', '김다육'])
    expect(calls.alerts).toEqual(['총 2건 신청목록에 추가되었습니다.'])
    expect(calls.messages).toEqual([{ type: 'fill', ok: true, sender: true }, { type: 'upload', step: 'start' }, { type: 'upload', ok: true, count: 1, rows: 2 }])
    expect(calls.reserve).toBe(0)
    expect((document.getElementById('guest_orderpw') as HTMLInputElement).value).toBe('')

    // 다시 채우기: 보내는 분만 다시, 목록이 있으면 파일은 다시 올리지 않는다
    window.eval(visitFillScript(kit))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(calls.requested).toHaveLength(3)
  })

  it('날짜가 정해지지 않으면 [파일(주소) 등록]을 누르지 않고 알린다 — 판매자가 눌러도 창 대신 올린다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const calls = visitPage({ day: '' })
    window.eval(visitFillScript(kit))
    vi.advanceTimersByTime(20_500)
    vi.useRealTimers()
    expect(calls.messages.at(-1)).toEqual({ type: 'fill', step: 'need-date' })
    expect(calls.requested).toEqual([])
    document.getElementById('fncRegFile')!.click()
    await until(() => calls.grid !== undefined)
    expect(calls.requested[0]).toBe('GET /general.UseGridAddressFile.parcel?')
    expect(calls.requested).not.toContain('popup')
  })

  it('우체국이 파일을 거절하면(state N) 목록에 넣지 않고 알린다, 다른 화면이면 PAGE', async () => {
    const calls = visitPage()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('/general.UseGridAddressFile') ? new Response('name="tempCode" value="1"') : new Response('<xsync><state>N</state></xsync>'))))
    window.eval(visitFillScript(kit))
    await until(() => calls.messages.some((message) => message['ok'] === false))
    expect(calls.grid).toBeUndefined()
    expect(calls.messages.at(-1)).toEqual({ type: 'upload', ok: false, state: 'N' })

    delete (window as unknown as Win)['__ljEpost']
    document.body.innerHTML = '<p>다른 화면</p>'
    window.eval(visitFillScript(kit))
    expect(calls.messages.at(-1)).toEqual({ type: 'fill', ok: false, reason: 'PAGE' })
  })

  it('송장번호 찾기 글 모으기: 숫자 4자리 이상이 든 표·목록 줄만', () => {
    const calls = visitPage()
    document.body.innerHTML = '<table><tr><td>홍길동</td><td>6070123456789</td></tr><tr><td>안내</td></tr></table><ul><li>김다육 6070123456790</li></ul>'
    window.eval(ROWS_SCRIPT)
    expect(calls.messages.at(-1)).toEqual({ type: 'rows', rows: ['홍길동6070123456789', '김다육 6070123456790'] })
  })
})

/** 창구소포 간편사전접수 입력 화면처럼 생긴 시험 화면: [목록 추가](inputReceiver)는 우편번호·전화가 있어야 줄을 더한다 */
function counterPage() {
  const ids = ['tSndNm', 'tSndZipcd', 'tSndAddr1', 'tSndAddr2', 'tSndHTel1', 'tSndHTel2', 'tSndHTel3', 'tSndTel1', 'tSndTel2', 'tSndTel3', 'tReceiverName', 'tReceiverZipcode1', 'tReceiverAddr1', 'tReceiverAddr2', 'tReceiverHTel1', 'tReceiverHTel2', 'tReceiverHTel3', 'tReceiverTel1', 'tReceiverTel2', 'tReceiverTel3']
  document.body.innerHTML = `<form id="subForm">${ids.map((id) => `<input id="${id}" />`).join('')}<input id="reqPassword" type="password" /></form><table id="mainTable"><tr><th>받는 분</th></tr></table>`
  const w = window as unknown as Win
  const calls: { alerts: string[]; messages: Record<string, unknown>[]; added: string[][] } = { alerts: [], messages: [], added: [] }
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value
  w['alert'] = (text: string) => calls.alerts.push(text)
  w['ReactNativeWebView'] = { postMessage: (data: string) => calls.messages.push(JSON.parse(data) as Record<string, unknown>) }
  w['inputReceiver'] = () => {
    if (value('tSndNm') === '' || value('tSndZipcd') === '') return window.alert('보내는 분 이름을 입력해주세요.')
    if (value('tReceiverZipcode1') === '') return window.alert('받는 분  주소는 필수 입력사항입니다.')
    calls.added.push([value('tReceiverName'), value('tReceiverZipcode1'), value('tReceiverAddr1'), value('tReceiverAddr2'), value('tReceiverHTel1') + value('tReceiverHTel2') + value('tReceiverHTel3'), value('tReceiverTel1') + value('tReceiverTel2') + value('tReceiverTel3')])
    const table = document.getElementById('mainTable') as HTMLTableElement
    table.insertRow().insertCell().textContent = value('tReceiverName')
    return false
  }
  return { calls, value }
}

describe('들고 가기(창구소포 간편사전접수) 화면 자동 채우기', () => {
  const counterKit: EpostKit = {
    ...kit,
    receivers: [
      { ...kit.receivers[0]! },
      { buyer: 'u2', name: '김다육', phone: '0551234567', zip: '', address: '경상남도 양산시', detail: '.', memo: '', qty: 1, content: '물품 1개', kg: 5, cm: 80 },
      { buyer: 'u3', name: '이초록', phone: '01011112222', zip: '50603', address: '경상남도 양산시 물금읍', detail: '2층', memo: '', qty: 1, content: '물품 1개', kg: 5, cm: 80 },
    ],
  }

  it('보내는 분 칸 → 받는 분마다 칸을 채우고 화면의 [목록 추가] — 안 들어간 사람은 세기만, 알림창은 띄우지 않고 받는 분 칸은 비운다', () => {
    const { calls, value } = counterPage()
    window.eval(counterFillScript(counterKit))
    expect([value('tSndNm'), value('tSndZipcd'), value('tSndAddr1'), value('tSndAddr2'), value('tSndTel1'), value('tSndTel2'), value('tSndTel3'), value('tSndHTel1')]).toEqual(['다육이네', '16490', '경기도 수원시 팔달구 효원로 1', '1층', '031', '123', '4567', ''])
    expect(calls.added).toEqual([
      ['홍길동', '04524', '서울특별시 중구 세종대로 110', '101동', '01012345678', ''],
      ['이초록', '50603', '경상남도 양산시 물금읍', '2층', '01011112222', ''],
    ])
    expect(calls.alerts).toEqual([])
    expect(calls.messages).toEqual([{ type: 'fill', ok: true, sender: true, added: 2, skipped: 1 }])
    expect([value('tReceiverName'), value('tReceiverZipcode1'), value('tReceiverHTel1')]).toEqual(['', '', ''])
    expect(value('reqPassword')).toBe('')
    // 알림창은 다시 화면 것으로
    window.alert('확인')
    expect(calls.alerts).toEqual(['확인'])

    // 다시 채우기: 목록에 줄이 있으면 받는 분은 다시 넣지 않는다
    window.eval(counterFillScript(counterKit))
    expect(calls.added).toHaveLength(2)
    expect(calls.messages.at(-1)).toEqual({ type: 'fill', ok: true, sender: true, added: 0, skipped: 0, existing: 2 })
  })

  it('동의 화면(입력 칸 없음)이면 PAGE, 보내는 사람이 없으면 받는 분을 넣지 않고 알린다', () => {
    const { calls } = counterPage()
    window.eval(counterFillScript({ ...counterKit, sender: null }))
    expect(calls.added).toEqual([])
    expect(calls.messages).toEqual([{ type: 'fill', ok: true, sender: false }])
    document.body.innerHTML = '<input id="guest_orderpw" />'
    window.eval(counterFillScript(counterKit))
    expect(calls.messages.at(-1)).toEqual({ type: 'fill', ok: false, reason: 'PAGE' })
  })
})

describe('앱 안 우체국 화면은 컴퓨터 사파리처럼 연다 (D-UX3-65)', () => {
  it('우체국 휴대폰 넘김 규칙(pageRedirect.js의 isMobile)에 걸리지 않는 이름', () => {
    const isMobile = /iphone|ipod|android|blackberry|rim|galaxy|android|windows ce|windows mobile|lg|mot|samsung|sonyericsson|htc|sky/i
    expect(isMobile.test(EPOST_DESKTOP_AGENT.toLowerCase())).toBe(false)
    expect(EPOST_DESKTOP_AGENT).toContain('Safari')
  })
})

describe('들고 가기 동의 화면 (D-UX3-40)', () => {
  function agreePage() {
    document.body.innerHTML = '<input type="checkbox" id="allAgree" /><input type="checkbox" id="agree1" /><input type="checkbox" id="agree2" /><input type="password" id="guest_orderpw" /><input type="password" id="guest_orderpw2" />'
    const w = window as unknown as Win
    const calls: { messages: Record<string, unknown>[]; next: number; changes: string[] } = { messages: [], next: 0, changes: [] }
    w['ReactNativeWebView'] = { postMessage: (data: string) => calls.messages.push(JSON.parse(data) as Record<string, unknown>) }
    w['goNextPage'] = () => void calls.next++
    w['__ljAgree'] = undefined
    for (const id of ['allAgree', 'agree1', 'agree2']) document.getElementById(id)!.addEventListener('change', () => calls.changes.push(id))
    return calls
  }
  const box = (id: string) => (document.getElementById(id) as HTMLInputElement)

  it('동의 세 칸을 체크하고(화면 change도), 비밀번호는 넣지 않는다 — 판매자가 4자리를 적으면 확인 칸에 같은 값 → [다음]', () => {
    const calls = agreePage()
    window.eval(COUNTER_AGREE_SCRIPT)
    expect([box('allAgree').checked, box('agree1').checked, box('agree2').checked]).toEqual([true, true, true])
    expect(calls.changes).toEqual(['allAgree', 'agree1', 'agree2'])
    expect([box('guest_orderpw').value, box('guest_orderpw2').value]).toEqual(['', ''])
    expect(calls.messages).toEqual([{ type: 'agree', ok: true }])
    const pw = box('guest_orderpw')
    pw.value = '12'
    pw.dispatchEvent(new Event('input'))
    expect(box('guest_orderpw2').value).toBe('12')
    expect(calls.next).toBe(0)
    pw.value = '12a34'
    pw.dispatchEvent(new Event('input'))
    expect([pw.value, box('guest_orderpw2').value, calls.next]).toEqual(['1234', '1234', 1])
    expect(calls.messages.at(-1)).toEqual({ type: 'agree', step: 'next' })
    // 다시 넣어도 듣는 곳은 하나
    window.eval(COUNTER_AGREE_SCRIPT)
    pw.dispatchEvent(new Event('input'))
    expect(calls.next).toBe(1)
  })

  it('펼쳐진 약관 글 상자는 접어 비밀번호 칸·[다음]이 바로 보이게 한다 (D-UX3-65)', () => {
    agreePage()
    document.body.insertAdjacentHTML('beforeend', '<div class="agree_wrap on" id="w1"></div><div class="agree_wrap on" id="w2"></div>')
    window.eval(COUNTER_AGREE_SCRIPT)
    expect(['w1', 'w2'].map((id) => document.getElementById(id)!.className)).toEqual(['agree_wrap', 'agree_wrap'])
  })

  it('동의 칸이 없으면 PAGE', () => {
    const calls = agreePage()
    document.body.innerHTML = '<p>다른 화면</p>'
    window.eval(COUNTER_AGREE_SCRIPT)
    expect(calls.messages).toEqual([{ type: 'agree', ok: false, reason: 'PAGE' }])
  })

  it('입력 화면: 비어 있는 상세 주소는 "-" (우체국 화면이 빈 상세 주소를 받지 않는다)', () => {
    const { calls, value } = counterPage()
    window.eval(counterFillScript({ ...kit, sender: { ...kit.sender!, detail: '' }, receivers: [{ ...kit.receivers[0]!, detail: ' ' }] }))
    expect(value('tSndAddr2')).toBe('-')
    expect(calls.added).toEqual([['홍길동', '04524', '서울특별시 중구 세종대로 110', '-', '01012345678', '']])
  })
})
