// QL3R2 웹 단위 시험 — .csv 아닌 파일(D-QL3R2-01), 접힌 띠 "보류 n"·이중 표시(D-QL3R2-02), 출력 기기 없음 짧은 줄(D-QL3R2-03),
// 쉬운 낱말(D-QL3R2-04), 머리 줄 없음 휴대폰 안내(D-QL3R2-05), 숫자 키 반복 무시(D-QL3R2-06).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { AlertStrip, PENDING_SHORT_WORD } from '../src/components/AlertStrip.tsx'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { DepositContext } from '../src/components/deposit-context.tsx'
import { DepositsPage } from '../src/components/DepositsPage.tsx'
import { NO_HEADER_PHONE_HINT } from '../src/components/DepositPaste.tsx'
import { Modal } from '../src/components/Modal.tsx'
import { NotTextFileError, decodeCsv, readCsvFile } from '../src/lib/csv-text.ts'
import type { AlertCounts } from '../src/lib/derive.ts'
import { reasonWords, PASTE_STATE_WORD } from '../src/lib/deposit-words.ts'
import { BUYER_CAN_WRITE } from '../src/lib/parcel-words.ts'
import { NO_STATION_PILING, NO_STATION_SHORT, deviceLostMessage, deviceLostShortMessage, stationLeadShortText, stationLeadText } from '../src/lib/print-words.ts'
import { DepositStore } from '../src/lib/deposit-store.ts'
import type { Route } from '../src/lib/router.ts'
import { DepositServer } from './deposit-server.ts'
import { FakeEventSource, FakeServer, apiError, flush } from './support.ts'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  onUnauthorized(null)
})

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
const utf8 = (text: string) => new TextEncoder().encode(text)

describe('파일 읽기 — 글 파일이 아니면 실패 (D-QL3R2-01, AC-QL3R2-02)', () => {
  const TEXT = '거래일시,입금액,입금자명\n2026-10-18 21:03,14000,김영희\n'
  const EUC_KR = 'b0c5b7a1c0cfbdc32cc0d4b1ddbed72cc0d4b1ddc0dab8ed0a323032362d31302d31382032313a30332c31343030302cb1e8bfb5c8f10a'

  it('(a) UTF-8(BOM 있음·없음) (b) EUC-KR 은행 머리 줄은 지금과 같은 글, (c) 빈 파일은 빈 글', async () => {
    expect(decodeCsv(utf8(TEXT))).toBe(TEXT)
    expect(decodeCsv(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(TEXT)]))).toBe(TEXT)
    expect(decodeCsv(hex(EUC_KR))).toBe(TEXT)
    expect(decodeCsv(hex(EUC_KR).buffer)).toBe(TEXT)
    expect(decodeCsv(new Uint8Array())).toBe('')
    expect(await readCsvFile(new Blob([]))).toBe('')
  })

  it('(d) PNG·JPEG·PDF·zip 머리 바이트는 예외', async () => {
    // 각 파일 첫 30여 바이트 (PNG 1×1 IHDR, JFIF, PDF 1.4 + 압축 덩어리, zip(엑셀) 지역 머리)
    const heads = [
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
      'ffd8ffe000104a46494600010100000100010000',
      // PDF: 머리 줄 + 첫 압축 덩어리(바이너리 — NUL이 든다). 글자만 있는 머리 줄 하나는 EUC-KR 글로 풀린다(D-QL3R2-01은 두 줄 규칙만)
      '255044462d312e340a25e2e3cfd30a312030206f626a0a3c3c2f4c656e6774682031303e3e73747265616d0a789c0300000000',
      '504b0304140006000800000021000000000000000000000000000000000013000000',
    ]
    for (const head of heads) {
      expect(() => decodeCsv(hex(head))).toThrow(NotTextFileError)
      await expect(readCsvFile(new Blob([hex(head)]))).rejects.toThrow(NotTextFileError)
    }
  })

  it('(e) NUL 한 바이트만 끼운 UTF-8 글도 예외 — 글을 돌려주지 않는다', () => {
    const bytes = utf8(TEXT)
    const withNul = Uint8Array.from([...bytes.slice(0, 10), 0x00, ...bytes.slice(10)])
    expect(() => decodeCsv(withNul)).toThrow(NotTextFileError)
    expect(() => decodeCsv(Uint8Array.from([0x00]))).toThrow(NotTextFileError)
  })

  it('(f) UTF-8로도 EUC-KR(엄격)로도 풀리지 않는 바이트는 예외', () => {
    expect(() => decodeCsv(Uint8Array.from([0xff, 0xfe, 0x80, 0x41]))).toThrow(NotTextFileError)
    expect(() => decodeCsv(Uint8Array.from([0x41, 0xc8]))).toThrow(NotTextFileError)
  })
})

describe('입금 붙여넣기 화면 (D-QL3R2-01·05)', () => {
  let store: DepositStore
  let api: DepositServer
  function Harness() {
    const [route, setRoute] = useState<Route>({ name: 'deposits', tab: 'paste' })
    return <DepositContext.Provider value={store}>{route.name === 'deposits' ? <DepositsPage route={route} navigate={setRoute} /> : null}</DepositContext.Provider>
  }
  async function open(setup?: (server: DepositServer) => void) {
    api = new DepositServer([])
    setup?.(api)
    vi.stubGlobal('fetch', api.server.fetch)
    const stream = new FakeEventSource('/api/stream')
    store = new DepositStore({ openStream: () => stream })
    store.start()
    render(<Harness />)
    await flush(10)
  }
  afterEach(() => store?.stop())

  const PNG = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'

  for (const before of ['', '가나다']) {
    it(`사진·NUL 파일을 고르면 읽기 실패 문장, 글 칸은 "${before}" 그대로, 미리 보기 요청 없음`, async () => {
      await open()
      const field = screen.getByLabelText('입금 내역') as HTMLTextAreaElement
      if (before !== '') fireEvent.change(field, { target: { value: before } })
      const input = screen.getByLabelText('은행 파일 고르기(.csv)')
      fireEvent.change(input, { target: { files: [new File([hex(PNG)], '사진.png', { type: 'image/png' })] } })
      await flush(10)
      expect(screen.getByRole('alert').textContent).toBe('파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요.')
      expect(field.value).toBe(before)
      fireEvent.change(input, { target: { files: [new File([Uint8Array.from([0x41, 0x00, 0x42])], '거래내역.csv', { type: 'text/csv' })] } })
      await flush(10)
      expect(field.value).toBe(before)
      expect(api.server.callsTo('POST', /^\/api\/deposits\/paste\/preview$/)).toHaveLength(0)
      expect((screen.getByRole('button', { name: '입금 내역 넣기' }) as HTMLButtonElement).disabled).toBe(true)
      expect(document.body.textContent).not.toContain('�')
    })
  }

  it('머리 줄 없음(PASTE_NO_HEADER)이면 서버 문장 바로 아래 휴대폰 안내 — 다른 오류에는 없다', async () => {
    await open((server) => {
      server.preview = apiError(400, 'PASTE_NO_HEADER', '표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.')
    })
    expect(NO_HEADER_PHONE_HINT).toBe("휴대폰에서는 PC로 은행 거래내역을 복사해 넣거나, 정산 화면의 '입금 적기'로 직접 적어 주세요.")
    fireEvent.change(screen.getByLabelText('입금 내역'), { target: { value: '[Web발신] 농협 입금 24,000원 10/26 14:20 물주기담당' } })
    fireEvent.click(screen.getByRole('button', { name: '읽어 보기' }))
    await flush(10)
    const alert = screen.getByRole('alert')
    const lines = [...alert.querySelectorAll('p')].map((p) => p.textContent)
    expect(lines.slice(0, 2)).toEqual(['표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.', NO_HEADER_PHONE_HINT])
    expect(api.server.callsTo('POST', /^\/api\/deposits\/paste$/)).toHaveLength(0)
    cleanup()
    store.stop()
    await open((server) => {
      server.preview = apiError(400, 'PASTE_TOO_MANY_ROWS', '한 번에 넣을 수 있는 줄 수를 넘었어요.')
    })
    fireEvent.change(screen.getByLabelText('입금 내역'), { target: { value: '거래일시,입금액\n...' } })
    fireEvent.click(screen.getByRole('button', { name: '읽어 보기' }))
    await flush(10)
    expect(screen.getByRole('alert').textContent).not.toContain(NO_HEADER_PHONE_HINT)
  })

  it('넣은 뒤 결과: "시각이 지금보다 늦은 입금 n건은 넣지 않았어요. 은행 글의 날짜·시각을 확인해 주세요."', async () => {
    const PREVIEW = { rows: [{ line: 2, at: '2026-10-18T21:03:00+09:00', precision: 'minute' as const, amount: 14000, name: '김영희', balance: null, state: 'NEW' as const }], skipped: [], unreadable: [] }
    await open((server) => {
      server.preview = PREVIEW
      server.pasteSummary = { read: 3, skipped: 0, unreadable: [], new: 1, existing: 0, old: 0, future: 2, auto: 1, review: 0 }
    })
    fireEvent.change(screen.getByLabelText('입금 내역'), { target: { value: '거래일시,입금액\n...' } })
    fireEvent.click(screen.getByRole('button', { name: '읽어 보기' }))
    await flush(10)
    fireEvent.click(screen.getByRole('button', { name: '입금 내역 넣기' }))
    await flush(10)
    expect(screen.getByRole('status').textContent).toContain('오래된 입금 0건, 시각이 지금보다 늦은 입금 2건은 넣지 않았어요. 은행 글의 날짜·시각을 확인해 주세요.')
    expect(document.body.textContent).not.toContain('앞으로인')
  })
})

describe('쉬운 낱말 (D-QL3R2-04)', () => {
  it('늦은 입금·같은 입금 두 번·구매자 확인서 링크 문장', () => {
    expect(PASTE_STATE_WORD.FUTURE).toBe('시각이 지금보다 늦은 입금')
    expect(reasonWords('POSSIBLE_DUPLICATE', 2)).toBe('같은 입금이 두 번 들어왔을 수 있어요 (입금 #2도 같은 입금이에요)')
    expect(reasonWords('POSSIBLE_DUPLICATE', 2)).not.toContain('#2과')
    expect(BUYER_CAN_WRITE).toBe("구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요. 링크는 방송을 끝낸 뒤 '영수증 보내기'에서 만들어요.")
  })

  it('방송 화면을 열지 못하면 제목 "방송 화면을 열지 못했어요" + "다시 열기" — "콘솔"이 없다', async () => {
    const server = new FakeServer().on('GET', /^\/api\//, () => apiError(403, 'FORBIDDEN', '볼 수 없는 방송이에요.'))
    vi.stubGlobal('fetch', server.fetch)
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: '방송 화면을 열지 못했어요' })).toBeDefined()
    expect(screen.getByRole('button', { name: '다시 열기' })).toBeDefined()
    expect(document.body.textContent).not.toContain('콘솔')
  })
})

describe('출력 기기 없음 짧은 줄 (D-QL3R2-03, AC-QL3R2-14)', () => {
  const base = { labelsOn: true, rehearsal: false, ended: false, mine: false } as const
  const device = { id: 'd1', name: 'PC 2', live: false, printerConnected: true, releasing: false }
  const queue = { rev: 1, device, pause: null, waiting: 2, printing: 0, discard: 0, labelsEnabled: true }

  it('stationLeadShortText — 끊김·없음+대기·없음+대기 0·정상·리허설·끝남·이 기기', () => {
    expect(NO_STATION_SHORT).toBe('라벨이 안 나가요 · 라벨 화면에서 프린터를 연결해 주세요')
    expect(stationLeadShortText({ ...base, queue })).toBe(deviceLostShortMessage('PC 2'))
    expect(stationLeadShortText({ ...base, queue: { ...queue, device: null } })).toBe(NO_STATION_SHORT)
    expect(stationLeadText({ ...base, queue: { ...queue, device: null } })).toBe(NO_STATION_PILING)
    expect(stationLeadShortText({ ...base, queue: { ...queue, device: null, waiting: 0 } })).toBeNull()
    expect(stationLeadShortText({ ...base, queue: { ...queue, device: { ...device, live: true } } })).toBeNull()
    expect(stationLeadShortText({ ...base, rehearsal: true, queue: { ...queue, device: null } })).toBeNull()
    expect(stationLeadShortText({ ...base, ended: true, queue: { ...queue, device: null } })).toBeNull()
    expect(stationLeadShortText({ ...base, mine: true, queue })).toBeNull()
    expect(stationLeadShortText({ ...base, labelsOn: false, queue: { ...queue, device: null } })).toBeNull()
    // 짧은 문장이 있으면 긴 문장도 있다 (같은 조건)
    for (const q of [queue, { ...queue, device: null }, { ...queue, device: null, waiting: 0 }, { ...queue, device: { ...device, live: true } }]) {
      expect(stationLeadShortText({ ...base, queue: q }) === null).toBe(stationLeadText({ ...base, queue: q }) === null)
    }
  })
})

describe('접힌 휴대폰 띠 (D-QL3R2-02 (1)(2))', () => {
  const counts = { conflict: 0, cancelRequest: 0, succession: 0, pending: 1, attention: 0 } as AlertCounts
  const wide = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  const lead = (name: string) => ({ key: 'print-station', text: deviceLostMessage(name), shortText: deviceLostShortMessage(name), soft: true, uncounted: true, onClick: vi.fn() })

  it('보류 단추: 접힌 휴대폰은 "보류 1"(글 = 이름), 펼친 띠·PC는 "보류 찜 1" — 누르면 보류 창', () => {
    const onOpen = vi.fn()
    const { rerender } = render(<AlertStrip counts={counts} onOpen={onOpen} expanded={false} onToggle={() => undefined} />)
    expect(PENDING_SHORT_WORD).toBe('보류')
    const short = screen.getByRole('button', { name: '보류 1' })
    expect(short.textContent).toBe('보류 1')
    expect(screen.queryByText(/보류 찜/)).toBeNull()
    fireEvent.click(short)
    expect(onOpen).toHaveBeenCalledWith('pending')
    rerender(<AlertStrip counts={counts} onOpen={onOpen} expanded onToggle={() => undefined} />)
    expect(screen.getByRole('button', { name: '보류 찜 1' }).textContent).toBe('보류 찜 1')
    cleanup()
    wide()
    render(<AlertStrip counts={counts} onOpen={onOpen} />)
    expect(screen.getByRole('button', { name: '보류 찜 1' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '보류 1' })).toBeNull()
  })

  it('끊김: 접힌 휴대폰은 긴 문장 0번·짧은 줄 1번(누르면 같은 곳), 펼친 띠·PC는 긴 문장 1번·짧은 줄 0번 — 알림 수는 같다', () => {
    const one = lead('PC')
    const { rerender } = render(<AlertStrip leads={[one]} counts={counts} onOpen={() => undefined} expanded={false} onToggle={() => undefined} />)
    expect(screen.queryAllByText(deviceLostMessage('PC'))).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: deviceLostShortMessage('PC') })).toHaveLength(1)
    expect(screen.getByRole('button', { name: '알림 1 펼치기' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: deviceLostShortMessage('PC') }))
    expect(one.onClick).toHaveBeenCalledTimes(1)
    rerender(<AlertStrip leads={[one]} counts={counts} onOpen={() => undefined} expanded onToggle={() => undefined} />)
    expect(screen.getAllByRole('button', { name: deviceLostMessage('PC') })).toHaveLength(1)
    expect(screen.queryByText(/라벨이 안 나가요/)).toBeNull()
    expect(screen.getByRole('button', { name: '알림 1 접기' })).toBeDefined()
    cleanup()
    wide()
    render(<AlertStrip leads={[one]} counts={counts} onOpen={() => undefined} />)
    expect(screen.getAllByRole('button', { name: deviceLostMessage('PC') })).toHaveLength(1)
    expect(screen.queryByText(/라벨이 안 나가요/)).toBeNull()
  })

  it('출력 기기 없음 짧은 줄도 같다, 기기 이름의 태그는 글자로만', () => {
    const none = { key: 'print-station', text: NO_STATION_PILING, shortText: NO_STATION_SHORT, soft: true, uncounted: true, onClick: vi.fn() }
    render(<AlertStrip leads={[none]} counts={counts} onOpen={() => undefined} expanded={false} onToggle={() => undefined} />)
    expect(screen.queryByText(NO_STATION_PILING)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: NO_STATION_SHORT }))
    expect(none.onClick).toHaveBeenCalledTimes(1)
    cleanup()
    render(<AlertStrip leads={[lead('<b>굵게</b>')]} counts={counts} onOpen={() => undefined} expanded={false} onToggle={() => undefined} />)
    expect(screen.getByRole('button', { name: "라벨이 안 나가요 · '<b>굵게</b>' 화면을 켜 주세요" }).querySelector('b')).toBeNull()
  })
})

describe('숫자 키 반복 무시 (D-QL3R2-06 (2), AC-QL3R2-30)', () => {
  it('repeat: true는 누르지 않고, 보통 한 번은 한 번 누른다', () => {
    const pressed = vi.fn()
    render(
      <Modal title="찜 취소하기" onClose={() => undefined}>
        <button type="button" data-key="2" onClick={pressed}>
          2 장난 찜
        </button>
      </Modal>,
    )
    const close = screen.getByRole('button', { name: '닫기' })
    fireEvent.keyDown(close, { key: '2', repeat: true })
    expect(pressed).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '찜 취소하기' })).toBeDefined()
    fireEvent.keyDown(close, { key: '2' })
    expect(pressed).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(close, { key: '2', repeat: true })
    fireEvent.keyDown(close, { key: '2', repeat: true })
    expect(pressed).toHaveBeenCalledTimes(1)
  })
})
