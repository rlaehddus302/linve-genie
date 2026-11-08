// @vitest-environment-options {"url":"https://service.epost.go.kr/front.commonpostplus.ParcelRetrieveAcceptPlus.postal?gubun=2"}
// EP1 우체국 화면에 넣는 스크립트 (PARCEL_RULES PC-9, D-EP1-05~D-EP1-07): 우체국 모양의 양식을 jsdom에 그리고 스크립트 글을 그대로 돌린다.
import { afterEach, describe, expect, it } from 'vitest'
import type { EpostFillView } from '@livejjim/web/src/api/parcel-types.ts'
import { canOpenInView, fillScript, isEpostUrl, readAgentMessage, receiptCandidates, receiptScript, type AgentMessage } from '../src/lib/epost-agent.ts'

const HINTS: EpostFillView['form'] = {
  sections: {
    receiver: ['받는분', '받는 분', '수취인', '받으시는 분', 'receiver', 'recv', 'rcv'],
    sender: ['보내는분', '보내는 분', '발송인', '보내시는 분', 'sender', 'send', 'snd'],
  },
  fields: {
    name: ['성명', '이름', '받는분', '보내는분', '수취인명', '발송인명', 'nm', 'name'],
    zip: ['우편번호', 'zip', 'zipcode'],
    address: ['기본주소', '주소', 'addr1', 'address'],
    detail: ['상세주소', '나머지주소', 'addr2', 'detail'],
    mobile: ['휴대전화', '휴대폰', '핸드폰', 'hp', 'mobile', 'cell'],
    phone: ['일반전화', '전화번호', 'tel', 'phone'],
    item: ['내용품', '물품', '품명', 'content', 'item'],
    memo: ['요청사항', '배송메모', '메모', 'memo'],
  },
  selectors: {},
  receiptWords: ['접수번호', '예약번호', '사전접수번호', '등기번호'],
}

const VIEW: EpostFillView = {
  date: '2026-10-19',
  buyer: 'UC_1',
  fill: {
    receiver: {
      name: '홍길동',
      zip: '04524',
      address: '서울특별시 중구 세종대로 110',
      detail: '101동 202호',
      mobile: ['010', '1234', '5678'],
      phone: null,
    },
    sender: {
      name: '다육이네',
      zip: '16490',
      address: '경기도 수원시 팔달구 효원로 1',
      detail: '1층',
      mobile: null,
      phone: ['031', '123', '4567'],
    },
    item: '식물',
    qty: 2,
    memo: '문 앞에',
  },
  row: {} as EpostFillView['row'],
  pages: {
    apply: 'https://service.epost.go.kr/a',
    history: 'https://www.epost.go.kr/h',
    guestHistory: 'https://service.epost.go.kr/g',
  },
  hosts: ['service.epost.go.kr', 'www.epost.go.kr', 'epost.go.kr'],
  form: HINTS,
}

/** 스크립트를 돌리고 보낸 답을 모은다 (칸을 못 찾으면 0.7초마다 다시 보므로 답이 올 때까지 기다린다) */
async function run(script: string, wait = 50): Promise<AgentMessage[]> {
  const sent: AgentMessage[] = []
  ;(
    window as unknown as {
      ReactNativeWebView: { postMessage: (data: string) => void }
    }
  ).ReactNativeWebView = {
    postMessage: (data) => {
      const message = readAgentMessage(data)
      if (message !== null) sent.push(message)
    },
  }
  // 스크립트 글 그대로 (앱의 injectJavaScript와 같다)
  new Function(script)()
  await new Promise((resolve) => setTimeout(resolve, wait))
  return sent
}

const value = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement).value

afterEach(() => {
  document.body.innerHTML = ''
})

/** 표 모양 양식 (보내는 분 먼저 — 우리 나라 관공서 화면에 흔한 모양) */
const TABLE_FORM = `
<h3>보내는 분</h3>
<table>
  <tr><th>성명</th><td><input name="sndNm" value="회원이름"></td></tr>
  <tr><th>주소</th><td><input name="sndZip" readonly><input name="sndAddr1" readonly><input name="sndAddr2"></td></tr>
  <tr><th>휴대전화</th><td><select name="sndHp1"><option></option><option>010</option></select><input name="sndHp2"><input name="sndHp3"></td></tr>
</table>
<h3>받는 분</h3>
<table>
  <tr><th>성명</th><td><input name="rcvNm"></td></tr>
  <tr><th>우편번호</th><td><input name="rcvZip" readonly maxlength="5"></td></tr>
  <tr><th>주소</th><td><input name="rcvAddr1" readonly><input name="rcvAddr2"></td></tr>
  <tr><th>휴대전화</th><td><select name="rcvHp1"><option></option><option>010</option><option>011</option></select><input name="rcvHp2" maxlength="4"><input name="rcvHp3" maxlength="4"></td></tr>
  <tr><th>일반전화</th><td><input name="rcvTel1"><input name="rcvTel2"><input name="rcvTel3"></td></tr>
</table>
<table>
  <tr><th>내용품</th><td><select name="contents"><option value="">선택</option><option value="01">의류</option><option value="09">식물</option></select></td></tr>
  <tr><th>무게</th><td><input name="weight"></td></tr>
  <tr><th>배송 요청사항</th><td><textarea name="reqMemo"></textarea></td></tr>
</table>
<input type="checkbox" name="agree"><button type="submit">신청</button>`

describe('칸 채우기 스크립트', () => {
  it('표 모양 양식: 받는 분은 모두 채우고, 휴대전화는 세 칸·고르기, 보내는 분은 빈 칸만, 내용품 고르기, 무게·약관·신청은 건드리지 않는다', async () => {
    document.body.innerHTML = TABLE_FORM
    let submitted = false
    document.querySelector('button')?.addEventListener('click', () => {
      submitted = true
    })
    const changed: string[] = []
    document.body.addEventListener('change', (event) => changed.push((event.target as HTMLInputElement).name))
    const [report] = await run(fillScript(VIEW))
    expect(report?.type).toBe('fill')
    if (report?.type !== 'fill') return
    expect(value('rcvNm')).toBe('홍길동')
    expect(value('rcvZip')).toBe('04524')
    expect(value('rcvAddr1')).toBe('서울특별시 중구 세종대로 110')
    expect(value('rcvAddr2')).toBe('101동 202호')
    expect([value('rcvHp1'), value('rcvHp2'), value('rcvHp3')]).toEqual(['010', '1234', '5678'])
    expect([value('rcvTel1'), value('rcvTel2'), value('rcvTel3')]).toEqual(['', '', ''])
    // 보내는 분: 회원 이름이 이미 있으면 두고, 빈 칸만
    expect(value('sndNm')).toBe('회원이름')
    expect(value('sndZip')).toBe('16490')
    expect(value('sndAddr1')).toBe('경기도 수원시 팔달구 효원로 1')
    expect(value('sndAddr2')).toBe('1층')
    // 보내는 분 일반전화 칸이 없으면 휴대전화 칸에 (고르기에 031이 없으니 둘째·셋째 칸만)
    expect([value('sndHp2'), value('sndHp3')]).toEqual(['123', '4567'])
    expect(value('contents')).toBe('09')
    expect(value('reqMemo')).toBe('문 앞에')
    expect(value('weight')).toBe('')
    expect((document.querySelector('[name="agree"]') as HTMLInputElement).checked).toBe(false)
    expect(submitted).toBe(false)
    expect(report.filled).toEqual(expect.arrayContaining(['receiver.name', 'receiver.zip', 'receiver.address', 'receiver.detail', 'receiver.mobile', 'sender.zip', 'sender.address', 'sender.detail', 'item', 'memo']))
    expect(report.filled).not.toContain('sender.name')
    // 주소 검색으로만 채우는 칸(읽기 전용)은 따로 알린다 — 판매자가 주소 검색으로 확인한다
    expect(report.readonly).toEqual(expect.arrayContaining(['receiver.zip', 'receiver.address', 'sender.zip', 'sender.address']))
    expect(report.ambiguous).toEqual([])
    expect(changed).toContain('rcvNm')
  })

  it('구역을 가릴 수 없는데 같은 칸이 둘이면 채우지 않고 "가릴 수 없음"으로 알린다', async () => {
    document.body.innerHTML = `
      <div><label for="a">이름</label><input id="a" name="n1"></div>
      <div><label for="b">이름</label><input id="b" name="n2"></div>
      <div><label for="c">우편번호</label><input id="c" name="z1"></div>`
    const [report] = await run(fillScript(VIEW))
    if (report?.type !== 'fill') throw new Error('답 없음')
    expect(value('n1')).toBe('')
    expect(value('n2')).toBe('')
    expect(report.ambiguous).toContain('receiver.name')
    // 하나뿐인 칸은 받는 분으로 본다
    expect(value('z1')).toBe('04524')
  })

  it('정확한 선택자 힌트가 있으면 그것을 먼저 쓴다 (서버가 내려 준 값으로 고친다)', async () => {
    document.body.innerHTML = `<input name="x1"><input name="x2">`
    const view = {
      ...VIEW,
      form: { ...HINTS, selectors: { 'receiver.name': '[name="x2"]' } },
    }
    const [report] = await run(fillScript(view))
    expect(value('x2')).toBe('홍길동')
    expect(value('x1')).toBe('')
    expect(report?.type === 'fill' && report.filled).toEqual(['receiver.name'])
  })

  it('우체국 호스트가 아니면 아무것도 채우지 않는다', async () => {
    document.body.innerHTML = TABLE_FORM
    const messages = await run(fillScript({ ...VIEW, hosts: ['example.org'] }))
    expect(messages).toEqual([{ type: 'host', ok: false }])
    expect(value('rcvNm')).toBe('')
  })

  it('스크립트 글에 넣는 값의 < > & 는 바꿔 쓴다 (스크립트가 끊기지 않게) — 값은 그대로 채워진다', async () => {
    document.body.innerHTML = `<table><tr><th>받는분 성명</th><td><input name="r"></td></tr></table>`
    const tricky = {
      ...VIEW,
      fill: {
        ...VIEW.fill,
        receiver: { ...VIEW.fill.receiver, name: '</script><b>&' },
      },
    }
    const script = fillScript(tricky)
    expect(script).not.toContain('</script>')
    await run(script)
    expect(value('r')).toBe('</script><b>&')
  })
})

describe('접수번호 찾기', () => {
  it('완료 화면 글에서 접수번호 낱말이 든 줄과 다음 줄만 돌려주고, 후보는 숫자 6개 이상 덩어리', async () => {
    document.body.innerHTML = `
<div>신청이 완료되었습니다.</div>
<table><tr><th>접수번호</th></tr>
<tr><td>1234-5678-9012</td></tr></table>
<p>받는 분 홍길동</p>`
    const [message] = await run(receiptScript(HINTS.receiptWords, VIEW.hosts))
    expect(message?.type).toBe('receipt')
    if (message?.type !== 'receipt') return
    expect(message.lines.join(' ')).not.toContain('홍길동')
    expect(receiptCandidates(message.lines, HINTS.receiptWords)).toEqual(['123456789012'])
  })

  it('후보 고르기: 같은 줄 먼저, 날짜처럼 짧은 것·숫자가 적은 것은 빼고, 같은 번호는 하나', () => {
    expect(receiptCandidates(['접수번호 : 6012345678901 (2026-11-08)'], ['접수번호'])).toEqual(['6012345678901'])
    expect(receiptCandidates(['예약번호', 'AB12-3456-78'], ['예약번호'])).toEqual(['AB12345678'])
    expect(receiptCandidates(['접수번호 조회'], ['접수번호'])).toEqual([])
    expect(receiptCandidates(['접수번호 1234567', '접수번호 1234567'], ['접수번호'])).toEqual(['1234567'])
  })
})

describe('답 읽기·주소', () => {
  it('라이브지니 표지가 없거나 모양이 틀린 글은 버린다', () => {
    expect(readAgentMessage('{"type":"fill"}')).toBeNull()
    expect(
      readAgentMessage(
        JSON.stringify({
          source: 'livejjim-epost',
          type: 'fill',
          filled: ['x'],
          readonly: [],
          missing: [],
          ambiguous: [],
        }),
      ),
    ).toBeNull()
    expect(readAgentMessage('not json')).toBeNull()
    expect(
      readAgentMessage(
        JSON.stringify({
          source: 'livejjim-epost',
          type: 'receipt',
          lines: ['접수번호 123456'],
        }),
      ),
    ).toEqual({ type: 'receipt', lines: ['접수번호 123456'] })
  })

  it('우체국 주소는 https와 우체국 호스트만, 앱 안 화면은 https만 연다', () => {
    expect(isEpostUrl('https://service.epost.go.kr/x', VIEW.hosts)).toBe(true)
    expect(isEpostUrl('https://m.epost.go.kr/x', VIEW.hosts)).toBe(true)
    expect(isEpostUrl('http://service.epost.go.kr/x', VIEW.hosts)).toBe(false)
    expect(isEpostUrl('https://epost.go.kr.evil.com/x', VIEW.hosts)).toBe(false)
    expect(isEpostUrl('https://notepost.go.kr/x', VIEW.hosts)).toBe(false)
    expect(canOpenInView('https://juso.go.kr/')).toBe(true)
    expect(canOpenInView('tel:0212345678')).toBe(false)
    expect(canOpenInView('intent://x')).toBe(false)
  })
})
