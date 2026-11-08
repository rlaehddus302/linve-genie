// @vitest-environment-options {"url":"https://service.epost.go.kr/front.commonpostplus.ParcelRetrieveAcceptPlus.postal"}
// EP1 실제 인터넷우체국 창구(다량)소포 신청서 (D-EP1-11·D-EP1-12): 2026-11-08 Chrome에서 비회원 약관 단계 뒤 신청서를 열어 확인한 칸 id·title·표 머리글과
// 내용품·배송 요청 고르기의 화면 스크립트 동작을 그대로 옮긴 모양에, 서버가 내려 주는 힌트(EPOST_FORM_HINTS)로 앱 스크립트를 돌린다.
// 숨은 준등기 내용품(semiCode — title "내용품코드")·결제 카드 칸·사이트 검색 칸이 함께 있다. 같은 스크립트를 실제 화면에 넣었을 때의 결과와 같아야 한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EpostFillView } from '@livejjim/web/src/api/parcel-types.ts'
import { EPOST_FORM_HINTS, EPOST_HOSTS, epostFill } from '../../server/src/parcel/epost-window.ts'
import { addScript, commitScript, fillScript, passwordScript, popupShimScript, readAgentMessage, type AgentMessage } from '../src/lib/epost-agent.ts'

const VIEW = {
  date: '2026-11-08',
  buyer: 'UC_1',
  fill: epostFill(
    { name: '홍길동', phone: '01012345678', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', zip: '04524', memo: '문 앞에' },
    { name: '다육이네', phone: '0311234567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' },
    2,
  ),
  row: {} as EpostFillView['row'],
  pages: { apply: 'https://service.epost.go.kr/a', history: 'https://www.epost.go.kr/h', guestHistory: 'https://service.epost.go.kr/g' },
  hosts: EPOST_HOSTS,
  form: EPOST_FORM_HINTS,
} as EpostFillView

async function run(script: string, wait = 50): Promise<AgentMessage[]> {
  const sent: AgentMessage[] = []
  ;(window as unknown as { ReactNativeWebView: { postMessage: (data: string) => void } }).ReactNativeWebView = {
    postMessage: (data) => {
      const message = readAgentMessage(data)
      if (message !== null) sent.push(message)
    },
  }
  new Function(script)()
  await new Promise((resolve) => setTimeout(resolve, wait))
  return sent
}

const value = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement).value

const REAL_FORM = `
<input type="text" name="query" title="검색어를 입력하세요" placeholder="검색어를 입력하세요">
<div class="Common_info"><div class="sub_title"><span>01</span><span>보내는 분</span></div>
<table>
  <tr><th>* 이름</th><td><input type="text" name="tSndNm" id="tSndNm" title="성명"></td></tr>
  <tr><th>* 주소</th><td><input type="text" name="tSndZipcd" id="tSndZipcd" readonly maxlength="7" title="우편번호"><a href="#">주소찾기</a>
    <input type="text" name="tSndAddr1" id="tSndAddr1" readonly maxlength="100" title="주소입력 앞자리"><input type="text" name="tSndAddr2" id="tSndAddr2" maxlength="60" title="주소입력 뒷자리"></td></tr>
  <tr><th>* 연락처</th><td>휴대전화 <input type="text" name="tSndHTel1" id="tSndHTel1" maxlength="4" title="보내는분 휴대전화 앞자리"><input type="text" name="tSndHTel2" id="tSndHTel2" maxlength="4" title="보내는분 휴대전화 중간자리"><input type="text" name="tSndHTel3" id="tSndHTel3" maxlength="4" title="보내는분 휴대전화 뒷자리">
    일반전화 <input type="text" name="tSndTel1" id="tSndTel1" maxlength="4" title="보내는분 일반전화 지역번호"><input type="text" name="tSndTel2" id="tSndTel2" maxlength="4" title="보내는분 일반전화 앞자리"><input type="text" name="tSndTel3" id="tSndTel3" maxlength="4" title="보내는분 일반전화 뒷자리"></td></tr>
  <tr><th>이메일</th><td><input type="text" name="sendprsnemail" id="sendprsnemail" maxlength="50"></td></tr>
</table></div>
<div class="Common_info"><div class="sub_title"><span>02</span><span>우편물 정보</span></div>
<table>
  <tr><th>* 내용물코드</th><td><select name="semiCode" id="semiCode" title="내용품코드-새창열림"><option value="">선택</option><option value="A">서류</option></select>
    <select name="semiDetailCode" id="semiDetailCode" title="내용품코드"><option value="">선택</option></select><input type="text" name="tMailContSemi" id="tMailContSemi" maxlength="10" title="내용물"></td></tr>
  <tr><th>* 박스중량/크기</th><td><select name="tWeight" id="tWeight" title="중량"><option value="">선택</option><option value="3">3kg</option></select>
    <select name="tHeight" id="tHeight" title="크기"><option value="">선택</option><option value="80">80cm (1~3호 상자)</option></select></td></tr>
  <tr><th>* 내용품</th><td><select name="productCodeCombo" id="labProductCode" title="내용품코드-새창열림"><option value="">내용품 종류 선택</option><option value="농/수/축산물(일반)">농/수/축산물(일반)</option><option value="서적">서적</option><option value="직접 입력">직접 입력</option></select>
    <input type="text" name="tMailCont" id="tMailCont" maxlength="30" title="내용물"></td></tr>
  <tr><th>박스개수</th><td><input type="text" name="mailCnt" id="mailCnt" maxlength="4" title="수량" value="1"></td></tr>
  <tr><th>배송시요청사항</th><td><select name="delivReqMsgCd" id="delivReqMsgCd" title="배송시요청사항 선택"><option value="">선택</option><option value="01">문 앞에 놓아주세요.</option><option value="02">무인 택배함에 보관해주세요.</option><option value="99">직접입력</option></select>
    <input type="text" name="delivReqMsg" id="delivReqMsg" readonly maxlength="50" title="배송시요청사항 직접입력"></td></tr>
</table></div>
<div class="Common_info"><div class="sub_title"><span>03</span><span>받는 분</span></div>
<table>
  <tr><th>* 이름</th><td><input type="text" name="tReceiverName" id="tReceiverName" title="성명"></td></tr>
  <tr><th>* 주소</th><td><input type="text" name="tReceiverZipcode1" id="tReceiverZipcode1" readonly maxlength="7" title="우편번호"><a href="#">주소찾기</a>
    <input type="text" name="tReceiverAddr1" id="tReceiverAddr1" readonly maxlength="50" title="주소입력 앞자리"><input type="text" name="tReceiverAddr2" id="tReceiverAddr2" maxlength="50" title="주소입력 뒷자리"></td></tr>
  <tr><th>* 연락처</th><td><input type="text" name="tReceiverHTel1" id="tReceiverHTel1" maxlength="4" title="받는분 휴대전화 앞자리"><input type="text" name="tReceiverHTel2" id="tReceiverHTel2" maxlength="4" title="받는분 휴대전화 중간자리"><input type="text" name="tReceiverHTel3" id="tReceiverHTel3" maxlength="4" title="받는분 휴대전화 뒷자리">
    <input type="text" name="tReceiverTel1" id="tReceiverTel1" maxlength="4" title="받는분 일반전화 지역번호"><input type="text" name="tReceiverTel2" id="tReceiverTel2" maxlength="4" title="받는분 일반전화 앞자리"><input type="text" name="tReceiverTel3" id="tReceiverTel3" maxlength="4" title="받는분 일반전화 뒷자리"></td></tr>
  <tr><th>등기번호</th><td><input type="text" name="tRegiNo" id="tRegiNo" maxlength="13" title="등기번호"></td></tr>
</table></div>
<div class="Common_info"><div class="sub_title"><span>05</span><span>결제수단 등록</span></div>
  <input type="text" name="creditNo1" title="카드번호 첫번째 네자리 입력"><input type="text" name="creditNo2" title="카드번호 두번째 네자리 입력">
  <input type="password" name="creditPwd1" title="비밀번호 첫번째 자리 입력"><input type="text" name="creditBirth" title="생년월일 6자리 또는 사업자번호 입력">
</div>`

/** 우체국 화면 스크립트 동작 (실제 화면의 jQuery change 처리기·dlvChangeCombo를 그대로 옮김) */
function realHandlers() {
  const product = document.getElementById('labProductCode') as HTMLSelectElement
  const text = document.getElementById('tMailCont') as HTMLInputElement
  product.addEventListener('change', () => {
    if (product.value === '직접 입력') {
      text.value = ''
      text.placeholder = '직접 입력'
    } else text.value = product.value
  })
  const memo = document.getElementById('delivReqMsgCd') as HTMLSelectElement
  const memoText = document.getElementById('delivReqMsg') as HTMLInputElement
  memo.addEventListener('change', () => {
    memoText.value = ''
    if (memo.selectedIndex === 0) memoText.readOnly = true
    else if (memo.options[memo.selectedIndex]?.text === '직접입력') memoText.readOnly = false
    else {
      memoText.readOnly = true
      memoText.value = memo.options[memo.selectedIndex]?.text ?? ''
    }
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('실제 인터넷우체국 신청서 모양 (D-EP1-12)', () => {
  it('서버 힌트로: 받는 분 모두·보내는 분 일반전화 세 칸, 내용품은 "직접 입력" + 식물, 배송 요청은 맞는 항목. 준등기 내용품·결제 카드·검색 칸·무게는 건드리지 않는다', async () => {
    document.body.innerHTML = REAL_FORM
    realHandlers()
    const [report] = await run(fillScript(VIEW))
    if (report?.type !== 'fill') throw new Error('답 없음')
    expect([value('tReceiverName'), value('tReceiverZipcode1'), value('tReceiverAddr1'), value('tReceiverAddr2')]).toEqual(['홍길동', '04524', '서울특별시 중구 세종대로 110', '101동 202호'])
    expect([value('tReceiverHTel1'), value('tReceiverHTel2'), value('tReceiverHTel3')]).toEqual(['010', '1234', '5678'])
    expect([value('tReceiverTel1'), value('tReceiverTel2'), value('tReceiverTel3')]).toEqual(['', '', ''])
    expect([value('tSndNm'), value('tSndZipcd'), value('tSndAddr1'), value('tSndAddr2')]).toEqual(['다육이네', '16490', '경기도 수원시 팔달구 효원로 1', '1층'])
    expect([value('tSndTel1'), value('tSndTel2'), value('tSndTel3')]).toEqual(['031', '123', '4567'])
    expect([value('tSndHTel1'), value('tSndHTel2'), value('tSndHTel3')]).toEqual(['', '', ''])
    expect(value('productCodeCombo')).toBe('직접 입력')
    expect(value('tMailCont')).toBe('식물')
    expect(value('delivReqMsgCd')).toBe('01')
    expect(value('delivReqMsg')).toBe('문 앞에 놓아주세요.')
    for (const name of ['semiCode', 'semiDetailCode', 'tMailContSemi', 'tWeight', 'tHeight', 'tRegiNo', 'sendprsnemail', 'creditNo1', 'creditNo2', 'creditPwd1', 'creditBirth', 'query']) expect(value(name), name).toBe('')
    expect(value('mailCnt')).toBe('1')
    expect(report.missing).toEqual([])
    expect(report.ambiguous).toEqual([])
    expect(report.filled).toEqual(expect.arrayContaining(['receiver.name', 'receiver.zip', 'receiver.address', 'receiver.detail', 'receiver.mobile', 'sender.name', 'sender.phone', 'item', 'memo']))
  })

  it('보내는 분 칸이 이미 차 있으면(주소 찾기·회원 정보) 두고 받는 분만', async () => {
    document.body.innerHTML = REAL_FORM
    realHandlers()
    ;(document.getElementById('tSndAddr2') as HTMLInputElement).value = '서울특별시청 (태평로1가)'
    ;(document.getElementById('tSndNm') as HTMLInputElement).value = '회원'
    await run(fillScript(VIEW))
    expect(value('tSndAddr2')).toBe('서울특별시청 (태평로1가)')
    expect(value('tSndNm')).toBe('회원')
    expect(value('tReceiverName')).toBe('홍길동')
  })
})

/** 실제 비회원 약관 쪽 (데스크톱, 2026-11-08): 약관 체크 둘·신청 비밀번호·비밀번호 확인 */
const TERMS_PAGE = `
<input type="checkbox" id="agree1"><input type="checkbox" id="agree2">
<table><tr><th>신청 비밀번호</th><td><input type="password" id="guest_orderpw" maxlength="4" placeholder="숫자 4자리를 입력해주세요"></td></tr>
<tr><th>신청 비밀번호 확인</th><td><input type="password" id="guest_orderpw2" maxlength="4"></td></tr></table>
<a href="#" id="next">다음</a>`

describe('비회원 신청 비밀번호 (D-EP1-14)', () => {
  const pw = (id: string) => (document.getElementById(id) as HTMLInputElement).value
  it('서버 힌트 선택자로 두 칸에 넣고 알린다. 약관 체크·[다음]은 건드리지 않는다', async () => {
    document.body.innerHTML = TERMS_PAGE
    let clicked = false
    document.getElementById('next')?.addEventListener('click', () => {
      clicked = true
    })
    const messages = await run(passwordScript('4821', EPOST_FORM_HINTS.password, EPOST_HOSTS))
    expect([pw('guest_orderpw'), pw('guest_orderpw2')]).toEqual(['4821', '4821'])
    expect(messages).toEqual([{ type: 'password', filled: 2 }])
    expect((document.getElementById('agree1') as HTMLInputElement).checked).toBe(false)
    expect((document.getElementById('agree2') as HTMLInputElement).checked).toBe(false)
    expect(clicked).toBe(false)
  })

  it('선택자가 맞지 않으면 신청 비밀번호 설명이 있는 비밀번호 칸만 — 결제 카드 비밀번호 칸은 건드리지 않는다', async () => {
    document.body.innerHTML = `<table><tr><th>신청 비밀번호</th><td><input type="password" name="mPw1"></td></tr></table>
      <input type="password" name="creditPwd1" title="비밀번호 첫번째 자리 입력"><input type="password" name="cardPw" title="카드 비밀번호">`
    await run(passwordScript('4821', '#nothing', EPOST_HOSTS))
    expect(value('mPw1')).toBe('4821')
    expect(value('creditPwd1')).toBe('')
    expect(value('cardPw')).toBe('')
  })

  it('신청서 쪽(결제 카드 칸만 있는 쪽)·이미 적힌 칸·4자리가 아닌 값·우체국이 아닌 호스트에는 넣지 않는다', async () => {
    document.body.innerHTML = REAL_FORM
    expect(await run(passwordScript('4821', EPOST_FORM_HINTS.password, EPOST_HOSTS))).toEqual([])
    expect(value('creditPwd1')).toBe('')
    document.body.innerHTML = TERMS_PAGE
    ;(document.getElementById('guest_orderpw') as HTMLInputElement).value = '1111'
    await run(passwordScript('4821', EPOST_FORM_HINTS.password, EPOST_HOSTS))
    expect([pw('guest_orderpw'), pw('guest_orderpw2')]).toEqual(['1111', '4821'])
    document.body.innerHTML = TERMS_PAGE
    await run(passwordScript('48a1', EPOST_FORM_HINTS.password, EPOST_HOSTS))
    await run(passwordScript('4821', EPOST_FORM_HINTS.password, ['example.org']))
    expect([pw('guest_orderpw'), pw('guest_orderpw2')]).toEqual(['', ''])
  })
})

describe('새 창을 같은 쪽 위 판으로 (D-EP1-11)', () => {
  it('window.open(빈 주소, 이름) → 그 이름의 iframe 판, 그 창의 opener는 이 쪽, close는 판 닫기. 우체국 호스트가 아니면 바꾸지 않는다', async () => {
    document.body.innerHTML = '<input id="zip">'
    const before = window.open
    await run(popupShimScript(['example.org']))
    expect(window.open).toBe(before)
    await run(popupShimScript(VIEW.hosts))
    expect(window.open).not.toBe(before)
    const popup = window.open('', 'nZipWin') as Window
    const frame = document.querySelector('iframe[name="nZipWin"]') as HTMLIFrameElement
    expect(frame).toBeTruthy()
    expect(document.getElementById('__ljpop')).toBeTruthy()
    expect(popup).toBe(frame.contentWindow)
    expect(popup.opener).toBe(window)
    // 우체국 주소 찾기 창이 하는 일: opener 칸에 적고 창을 닫는다
    ;(popup.opener as Window).document.querySelector<HTMLInputElement>('#zip')!.value = '04524'
    popup.close()
    expect(document.getElementById('__ljpop')).toBeNull()
    expect((document.getElementById('zip') as HTMLInputElement).value).toBe('04524')
    // 판의 [창 닫기]
    window.open('', 'again')
    ;(document.querySelector('#__ljpop button') as HTMLButtonElement).click()
    expect(document.getElementById('__ljpop')).toBeNull()
    window.open = before
  })
})

/**
 * 실제 모바일 소포 신청서 (2026-11-08 Chrome 모바일 화면에서 확인 — D-EP1-19): 내용품은 고르기 vContent(029 직접 입력) + 글 vWContent,
 * [다음](a#subStep2)이 받는 분을 #recevList에 더하고, [받는 분 추가 +]가 받는 분 칸을 비운다. [필수동의] broken_agree 체크 전이면 [다음]이 알림만 띄운다.
 */
const MOBILE_FORM = `
<input type="checkbox" name="broken_agree"> [필수동의]
<h3>보내는 분</h3>
<input name="tSndNm" title="이름 입력" placeholder="이름 입력"><input name="tSndZipcd" readonly title="우편번호"><input name="tSndAddr1" readonly title="기본주소"><input name="tSndAddr2" title="상세주소 입력">
<input name="tSndHTel1" title="보내는 분 휴대전화 앞자리"><input name="tSndHTel2" title="보내는 분 휴대전화 중간자리"><input name="tSndHTel3" title="보내는 분 휴대전화 뒷자리">
<input name="tSndTel1" title="보내는 분 일반전화 앞자리"><input name="tSndTel2" title="보내는 분 일반전화 중간자리"><input name="tSndTel3" title="보내는 분 일반전화 뒷자리">
<h3>받는 분</h3>
<input name="tReceiverName" title="받는분 이름"><input name="tReceiverZipcode1" readonly title="우편번호"><input name="tReceiverAddr1" readonly title="기본주소"><input name="tReceiverAddr2" title="상세주소 입력">
<input name="tReceiverHTel1" title="받는 분 휴대전화 앞자리"><input name="tReceiverHTel2" title="받는 분 휴대전화 중간자리"><input name="tReceiverHTel3" title="받는 분 휴대전화 뒷자리">
<input name="tReceiverTel1" title="받는 분 일반전화 앞자리"><input name="tReceiverTel2" title="받는 분 일반전화 중간자리"><input name="tReceiverTel3" title="받는 분 일반전화 뒷자리">
<div id="goods"></div>
<select name="demandSelect" id="demandSelect" title="배송시 요청사항 선택"><option value="06">직접입력</option><option value="01">문 앞에 놓아주세요</option></select><input name="labdemand" title="배송시 요청사항 입력">
<a id="subStep2" href="#step3"><button type="button">다음</button></a>
<ul id="recevList"></ul>
<a id="addBtn" href="#">받는 분 추가 +</a>
<input type="password" name="guest_orderpw" id="guest_orderpw"><input type="password" name="guest_orderpw_con" id="guest_orderpw_con">`

const MOBILE_HINTS = { ...EPOST_FORM_HINTS }
const MOBILE_VIEW = { ...VIEW, form: MOBILE_HINTS, pages: { ...VIEW.pages, apply: 'https://m.epost.go.kr/postal/mobile/mobile.RetrieveAcceptRn.postal?ctype=c2' } } as EpostFillView

/** 실제 화면 동작을 옮김: [다음] = 필수동의 확인·받는 분 확인 뒤 목록에 더함, [받는 분 추가] = 받는 분 칸 비움, 물품 정보는 늦게 그려진다 */
function mobileHandlers(): string[] {
  const alerts: string[] = []
  const v = (n: string) => document.querySelector<HTMLInputElement>(`[name="${n}"]`)!
  document.getElementById('subStep2')!.addEventListener('click', (event) => {
    event.preventDefault()
    if (!v('broken_agree').checked) return void window.alert('우편금지물품·취급제한품목 및 손해배상 안내에 동의해주세요.')
    if (v('tReceiverName').value === '') return void window.alert('받는 분 이름을 입력해 주세요.')
    const li = document.createElement('li')
    li.textContent = `받는분${v('tReceiverName').value} 내용품${(document.querySelector<HTMLInputElement>('[name="vWContent"]')?.value ?? '')}`
    document.getElementById('recevList')!.appendChild(li)
    window.alert('결제 정보가 입력되지 않았습니다.')
  })
  document.getElementById('addBtn')!.addEventListener('click', (event) => {
    event.preventDefault()
    for (const name of ['tReceiverName', 'tReceiverZipcode1', 'tReceiverAddr1', 'tReceiverAddr2', 'tReceiverHTel1', 'tReceiverHTel2', 'tReceiverHTel3']) v(name).value = ''
  })
  window.alert = (text?: unknown) => void alerts.push(String(text))
  // 물품 정보는 쪽을 읽고 조금 뒤에 그려진다 (앱에서 내용품을 못 채우던 까닭)
  setTimeout(() => {
    document.getElementById('goods')!.innerHTML = `<select name="vContent" id="vContent" title="내용품 종류 선택"><option value="">내용품 종류 선택</option><option value="021">농/수/축산물(일반)</option><option value="029">직접 입력</option></select><input name="vWContent" id="vWContent" title="내용물 입력">`
    const select = document.getElementById('vContent') as HTMLSelectElement
    select.addEventListener('change', () => {
      ;(document.getElementById('vWContent') as HTMLInputElement).value = select.value === '029' ? '' : (select.options[select.selectedIndex]?.text ?? '')
    })
  }, 300)
  return alerts
}

describe('실제 모바일 소포 신청서 — 늦게 그려지는 내용품·받는 분 여러 명 (D-EP1-19)', () => {
  // jsdom에는 그리기가 없어 모든 칸의 크기가 0이다 — 보이는 단추만 누르는 스크립트를 위해 크기를 준다
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 10 })
  })
  afterEach(() => {
    if (width !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width)
  })

  it('물품 정보가 늦게 그려져도 내용품을 "직접 입력" + 식물로 채우고 채운 칸 답을 다시 보낸다', async () => {
    document.body.innerHTML = MOBILE_FORM
    mobileHandlers()
    const messages = await run(fillScript(MOBILE_VIEW), 1600)
    const fills = messages.filter((m): m is Extract<AgentMessage, { type: 'fill' }> => m.type === 'fill')
    expect(fills[0]?.missing).toContain('item')
    expect(fills.at(-1)?.filled).toContain('item')
    expect(fills.at(-1)?.missing).not.toContain('item')
    expect(value('vContent')).toBe('029')
    expect(value('vWContent')).toBe('식물')
  })

  it('[필수동의] 전이면 [다음]을 누르지 않고 agree, 체크하면 [다음]으로 목록에 넣고(알림은 막고 문장만), [받는 분 추가]로 칸을 비운 뒤 둘째 사람', async () => {
    document.body.innerHTML = MOBILE_FORM
    const alerts = mobileHandlers()
    await run(fillScript(MOBILE_VIEW), 1600)
    expect(await run(commitScript(MOBILE_VIEW), 100)).toEqual([{ type: 'commit', ok: false, reason: 'agree', count: 0, messages: [] }])
    expect(document.querySelectorAll('#recevList > li')).toHaveLength(0)
    ;(document.querySelector('[name="broken_agree"]') as HTMLInputElement).checked = true
    const [first] = await run(commitScript(MOBILE_VIEW), 400)
    expect(first).toEqual({ type: 'commit', ok: true, reason: null, count: 1, messages: ['결제 정보가 입력되지 않았습니다.'] })
    expect(alerts).toEqual([])
    expect(await run(addScript(MOBILE_VIEW), 1000)).toEqual([{ type: 'added', ok: true }])
    expect(value('tReceiverName')).toBe('')
    const second = { ...MOBILE_VIEW, fill: { ...MOBILE_VIEW.fill, receiver: { ...MOBILE_VIEW.fill.receiver, name: '김초록' } } } as EpostFillView
    await run(fillScript(second), 100)
    expect(value('tReceiverName')).toBe('김초록')
    expect(value('tSndNm')).toBe('다육이네')
    const [again] = await run(commitScript(second), 400)
    expect(again).toMatchObject({ type: 'commit', ok: true, count: 2 })
    expect([...document.querySelectorAll('#recevList > li')].map((li) => li.textContent)).toEqual(['받는분홍길동 내용품식물', '받는분김초록 내용품식물'])
  })

  it('받는 분을 신청서가 받지 않으면 refused와 신청서 문장', async () => {
    document.body.innerHTML = MOBILE_FORM
    mobileHandlers()
    ;(document.querySelector('[name="broken_agree"]') as HTMLInputElement).checked = true
    const [result] = await run(commitScript(MOBILE_VIEW), 6000)
    expect(result).toEqual({ type: 'commit', ok: false, reason: 'refused', count: 0, messages: ['받는 분 이름을 입력해 주세요.'] })
  }, 10_000)

  it('우체국 회원 신청서: 보내는 분이 회원 정보 요약 + 숨은 칸이고 주소가 비어 있으면, 비어 있는 주소만 가게 주소로 채운다 (D-EP1-20)', async () => {
    // 2026-11-08 시뮬레이터: 회원 정보에 주소가 없던 계정으로 [다음] → "보내는 분 주소를 입력하십시오". 칸은 요약 아래 숨어 있다
    document.body.innerHTML = MOBILE_FORM.replace(
      /<h3>보내는 분<\/h3>[\s\S]*?<h3>받는 분<\/h3>/,
      `<h3>보내는 분</h3><div class="summary"><strong>회원</strong><p>()</p><p>010-1111-2222</p><button type="button">수정</button></div>
<input type="hidden" name="tSndNm" value="회원"><input type="hidden" name="tSndZipcd" value=""><input type="hidden" name="tSndAddr1" value=""><input type="hidden" name="tSndAddr2" value="">
<input type="hidden" name="tSndHTel1" value="010"><input type="hidden" name="tSndHTel2" value="1111"><input type="hidden" name="tSndHTel3" value="2222">
<h3>받는 분</h3>`,
    )
    const [report] = await run(fillScript(MOBILE_VIEW), 100)
    expect([value('tSndNm'), value('tSndZipcd'), value('tSndAddr1'), value('tSndAddr2')]).toEqual(['회원', '16490', '경기도 수원시 팔달구 효원로 1', '1층'])
    expect([value('tSndHTel1'), value('tSndHTel2'), value('tSndHTel3')]).toEqual(['010', '1111', '2222'])
    expect(report).toMatchObject({ type: 'fill' })
    expect((report as Extract<AgentMessage, { type: 'fill' }>).missing.filter((slot) => slot.startsWith('sender.'))).toEqual([])
    expect(value('tReceiverName')).toBe('홍길동')
  })

  it('모바일 신청서의 신청 비밀번호 확인 칸(guest_orderpw_con)에도 넣는다', async () => {
    document.body.innerHTML = MOBILE_FORM
    await run(passwordScript('4821', EPOST_FORM_HINTS.password, EPOST_HOSTS))
    expect([value('guest_orderpw'), value('guest_orderpw_con')]).toEqual(['4821', '4821'])
  })
})
