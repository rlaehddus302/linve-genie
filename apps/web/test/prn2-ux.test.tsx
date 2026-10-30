// PRN2 사용성 검토 고침 — 웹 라벨 화면 (harness/sprints/PRN2/ux/review.md UX-PRN2-001~006·009):
// - 001 테스트 인쇄 "아니요" 도움말은 이은 프린터에 맞는 줄만, 실험 기종이면 제조사 앱으로 그림 파일 인쇄하는 길이 맨 위
// - 002 "그림 파일로 저장하기"는 그림 파일 목록을 펼쳐 그리로, 방송이 없어도 테스트 라벨 그림 파일, 대기 라벨도 한 장씩
// - 003 라벨 오류 멈춤이 크기 때문이면 띠에 까닭(L-11 13)·할 일·"라벨 크기 고르기", 작업 줄 마지막 오류도 크기
// - 004 라벨 설정 안 크기 경고에 이 자리에서 할 일
// - 005 실험 기종 "예" 기다림 멈춤 띠에 "테스트 인쇄"
// - 006 "예" 뒤 다른 까닭으로 다시 멈추면 "이어서 해요" 대신 지난 일
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import { LABEL_SIZE_JOB_ERROR, labelSizePause, printErrorMessage } from '../src/lib/print-words.ts'
import { testFallbackLine, testHelp } from '../src/lib/test-help.ts'
import { device, job, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

const ME = 'device-me-1234'
const IMAGE: LabelBitmap = createBitmap(384, 240)
const LABEL_ERROR_MESSAGE = '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.'
const B1_HELP = ['라벨 크기가 50×30mm인지 확인해 주세요.', '인쇄 농도를 한 단계 올려 보세요.', 'NIIMBOT 정품 라벨인지 확인해 주세요.', '맨 아래 테두리가 빠지면 알려 주세요.']

let server: FakeServer
let current: PrintOverview
const downloads: string[] = []

const base64 = (image: LabelBitmap): string => btoa(Array.from(image.data, (byte) => String.fromCharCode(byte)).join(''))

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  downloads.length = 0
  server = new FakeServer()
  current = overview()
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: true } }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { 'print.autoOnConfirm': true } } }))
    .on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, () => ({ body: { width: IMAGE.width, height: IMAGE.height, data: base64(IMAGE) } }))
    .on('GET', /^\/api\/print\/preview\/job\?/, () => ({ body: { images: [{ width: IMAGE.width, height: IMAGE.height, data: base64(IMAGE) }] } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  // 내려받기: 파일 이름만 기록
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:label')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (this.download !== '') downloads.push(this.download)
  })
  window.history.replaceState(null, '', '/labels')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
})

async function openLabels(): Promise<HTMLElement> {
  render(<App />)
  await screen.findByRole('heading', { name: '라벨', level: 1 })
  await flush(10)
  return screen.getByRole('region', { name: '프린터' })
}

async function connectTest(printer: HTMLElement): Promise<void> {
  fireEvent.click(within(printer).getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }))
  await waitFor(() => expect(within(printer).getByText('연결됨')).toBeTruthy())
}

const filesDetails = (): HTMLDetailsElement => {
  const details = document.getElementById('label-export-files')
  if (!(details instanceof HTMLDetailsElement)) throw new Error('그림 파일 목록이 없다')
  return details
}

describe('UX-PRN2-001 테스트 인쇄 "아니요" 도움말 — 이은 프린터에 맞는 줄만', () => {
  it('B1(확인됨)·모름은 지금 그대로 네 줄', () => {
    expect(testHelp('NIIMBOT_B1', '50x30')).toEqual({ fallbackApp: null, lines: B1_HELP })
    expect(testHelp(null, '50x30')).toEqual({ fallbackApp: null, lines: B1_HELP })
    expect(testHelp('NIIMBOT_B1', '50x20').lines[0]).toBe('라벨 크기가 50×20mm인지 확인해 주세요.')
  })

  it('D110(테이프·실험): 맨 위에 NIIMBOT 앱으로 그림 파일, 테이프 크기, 농도·정품 줄, 맨 아래 테두리 줄은 없음', () => {
    expect(testHelp('NIIMBOT_D110', 'tape12x40')).toEqual({
      fallbackApp: 'NIIMBOT 앱',
      lines: [testFallbackLine('NIIMBOT 앱'), '라벨 크기가 테이프 12×40mm인지 확인해 주세요.', '인쇄 농도를 한 단계 올려 보세요.', 'NIIMBOT 정품 라벨인지 확인해 주세요.'],
    })
  })

  it('바우아토(실험·농도 없음): Luck Jingle 앱, 농도·NIIMBOT 줄 없음 — Marklife는 농도 줄만', () => {
    expect(testHelp('BAUATO_PPA2L', '50x30')).toEqual({
      fallbackApp: 'Luck Jingle 앱',
      lines: ['잘 안 나오면 이 프린터로 찍지 말고, 라벨을 그림 파일로 저장해 Luck Jingle 앱에서 인쇄해 주세요.', '라벨 크기가 50×30mm인지 확인해 주세요.'],
    })
    expect(testHelp('MARKLIFE_P50', '50x30').lines).toEqual([testFallbackLine('Marklife 앱'), '라벨 크기가 50×30mm인지 확인해 주세요.', '인쇄 농도를 한 단계 올려 보세요.'])
  })

  it('화면: 바우아토에서 "아니요" → 그 프린터 도움말과 "그림 파일로 저장하기" — 누르면 그림 파일 목록을 펼치고 그리로', async () => {
    const printer = await openLabels()
    window.livejjimTestPrinter?.setTestProfile('BAUATO_PPA2L')
    await connectTest(printer)
    fireEvent.click(within(printer).getByRole('button', { name: '테스트 인쇄' }))
    const result = await within(printer).findByRole('group', { name: '테스트 인쇄 결과' })
    fireEvent.click(within(result).getByRole('button', { name: '아니요' }))
    const help = within(result).getByRole('list', { name: '테스트 인쇄 도움말' })
    expect(within(help).getAllByRole('listitem').map((item) => item.textContent)).toEqual(testHelp('BAUATO_PPA2L', '50x30').lines)
    expect(help.textContent).not.toContain('NIIMBOT')
    // 실험 기종이 이어져 있으면 목록은 펼쳐져 있다 — 판매자가 접은 뒤 단추를 눌러도 다시 펼치고 목록 안 첫 단추에 초점
    await waitFor(() => expect(filesDetails().open).toBe(true))
    filesDetails().open = false
    fireEvent(filesDetails(), new Event('toggle'))
    await waitFor(() => expect(filesDetails().open).toBe(false))
    fireEvent.click(within(result).getByRole('link', { name: '그림 파일로 저장하기' }))
    await waitFor(() => expect(filesDetails().open).toBe(true))
    await waitFor(() => expect(filesDetails().contains(document.activeElement)).toBe(true))
    expect(document.activeElement?.tagName).toBe('BUTTON')
  })

  it('화면: B1에서 "아니요"는 지금 그대로 네 줄, "그림 파일로 저장하기" 없음', async () => {
    const printer = await openLabels()
    await connectTest(printer)
    fireEvent.click(within(printer).getByRole('button', { name: '테스트 인쇄' }))
    const result = await within(printer).findByRole('group', { name: '테스트 인쇄 결과' })
    fireEvent.click(within(result).getByRole('button', { name: '아니요' }))
    expect(within(within(result).getByRole('list', { name: '테스트 인쇄 도움말' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(B1_HELP)
    expect(within(result).queryByRole('link', { name: '그림 파일로 저장하기' })).toBeNull()
  })
})

describe('UX-PRN2-002 그림 파일 목록 — 방송이 없어도 테스트 라벨, 대기 라벨도 한 장씩', () => {
  it('방송이 없어도 테스트 라벨 그림 파일을 저장한다 (크기 = 테스트 인쇄 크기)', async () => {
    await openLabels()
    const row = within(filesDetails()).getByRole('group', { name: '테스트 라벨 그림 파일' })
    expect(row.textContent).toContain('50×30mm')
    fireEvent.click(within(row).getByRole('button', { name: '테스트 라벨 그림 파일로 저장' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]).toMatch(/^테스트라벨-\d{4}-\d{2}-\d{2}\.png$/)
    expect(server.callsTo('GET', /test-bitmap/).map((call) => call.path)).toEqual(['/api/print/test-bitmap?size=50x30'])
  })

  it('대기·출력 중 라벨도 줄마다 그림 파일로 저장 — 서버 미리 보기 그림 그대로', async () => {
    current = overview({ queue: queue({ waiting: 1 }), jobs: [job('j1')] })
    await openLabels()
    const list = within(filesDetails()).getByRole('list', { name: '그림 파일로 저장할 대기 라벨' })
    const row = within(list).getByRole('listitem')
    expect(row.textContent).toContain('15번 핑크프릴')
    fireEvent.click(within(row).getByRole('button', { name: '그림 파일로 저장' }))
    await waitFor(() => expect(downloads).toEqual([`라벨-${DATE}-15번.png`]))
    expect(server.callsTo('GET', /preview\/job/)).toHaveLength(1)
  })

  it('접기 줄은 단추 모양(.files-summary)이고 내보내기 칸 안 단추는 큰 단추 규칙(.label-export) 안', async () => {
    await openLabels()
    expect(filesDetails().querySelector('summary')?.classList.contains('files-summary')).toBe(true)
    const pdf = screen.getByRole('button', { name: '대기 중인 라벨 모두 A4 PDF로 저장' })
    expect(pdf.closest('.label-export')).not.toBeNull()
  })
})

describe('UX-PRN2-003·004 라벨 오류 멈춤이 크기 때문일 때', () => {
  const sizeJob = job('j1', { lastError: { code: 'INVALID_TEMPLATE', item: 'size' } })
  const pause = { reason: 'LABEL_ERROR' as const, message: LABEL_ERROR_MESSAGE, backlog: false }

  it('labelSizePause: 크기 오류 작업이 있고 출력 기기 프린터가 저장된 크기를 못 찍을 때만 까닭 문장', () => {
    const tape = labelSizePause({ pause, jobs: [sizeJob], sizes: { product: '50x30' }, profileId: 'NIIMBOT_D110' })
    expect(tape).toEqual({
      kind: 'product',
      message: '이 프린터는 50×30 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.',
      hint: "'라벨 크기 고르기'를 눌러 테이프 12×40mm처럼 이 프린터에 맞는 크기를 고르고 '라벨 설정 저장'을 누른 뒤 '다시 시작'을 눌러 주세요.",
    })
    // 이미 맞는 크기로 바꿨거나 프린터를 모르면 까닭 문장 없이 할 일만
    expect(labelSizePause({ pause, jobs: [sizeJob], sizes: { product: 'tape12x40' }, profileId: 'NIIMBOT_D110' })?.message).toBeNull()
    expect(labelSizePause({ pause, jobs: [sizeJob], sizes: { product: '50x30' }, profileId: null })).toEqual({
      kind: 'product',
      message: null,
      hint: "'라벨 크기 고르기'를 눌러 이 프린터에 맞는 크기를 고르고 '라벨 설정 저장'을 누른 뒤 '다시 시작'을 눌러 주세요.",
    })
    // 크기 때문이 아니면 없음
    expect(labelSizePause({ pause, jobs: [job('j2', { lastError: { code: 'DOES_NOT_FIT', item: 'name' } })], sizes: { product: '50x30' }, profileId: 'NIIMBOT_D110' })).toBeNull()
    expect(labelSizePause({ pause: { ...pause, reason: 'PRINTER_ERROR' }, jobs: [sizeJob], sizes: { product: '50x30' }, profileId: 'NIIMBOT_D110' })).toBeNull()
    expect(printErrorMessage({ code: 'INVALID_TEMPLATE', item: 'size' })).toBe(LABEL_SIZE_JOB_ERROR)
    expect(printErrorMessage({ code: 'INVALID_TEMPLATE', item: null })).toBe('라벨 설정에 고칠 곳이 있어요.')
  })

  it('화면: 띠에 까닭·할 일과 "라벨 크기 고르기"(주 단추) — 누르면 라벨 설정 크기 칸으로, 작업 줄·설정 경고도 크기를 말한다', async () => {
    current = overview({ queue: queue({ waiting: 1, pause, device: device('other-device', { name: 'PC', profileId: 'NIIMBOT_D110' }), labelSizes: ['tape12x40', 'tape15x30', 'tape15x50'] }), jobs: [sizeJob] })
    await openLabels()
    const band = screen.getByRole('region', { name: '출력 멈춤' })
    expect(band.textContent).toContain(LABEL_ERROR_MESSAGE)
    expect(band.textContent).toContain('이 프린터는 50×30 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.')
    const pick = within(band).getByRole('button', { name: '라벨 크기 고르기' })
    expect(pick.classList.contains('button-primary')).toBe(true)
    expect(within(band).getByRole('button', { name: '다시 시작' }).classList.contains('button-primary')).toBe(false)
    expect(screen.getByText(`마지막 오류: ${LABEL_SIZE_JOB_ERROR}`)).toBeTruthy()
    // 라벨 설정 안 경고: L-11 13 문장 뒤에 이 자리에서 할 일 (UX-PRN2-004)
    const warning = await screen.findByRole('note', { name: '라벨 크기 경고' })
    expect(warning.textContent).toBe("이 프린터는 50×30 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요. 위에서 크기를 하나 고르고 아래 '라벨 설정 저장'을 눌러 주세요.")
    fireEvent.click(pick)
    await waitFor(() => expect((document.activeElement as HTMLInputElement | null)?.type).toBe('radio'))
    expect(document.activeElement?.closest('.label-size-choices')).not.toBeNull()
  })
})

describe('UX-PRN2-005·006 출력 기기의 실험 기종', () => {
  function asDevice(): void {
    window.sessionStorage.setItem('livejjim.deviceId', ME)
    current = overview({ queue: queue({ device: device(ME, { name: 'PC' }) }) })
    server.on('POST', /^\/api\/print\/device\/state$/, (call) => {
      const connected = call.body?.['connected'] === true
      current = overview({
        queue: queue({
          device: device(ME, { name: 'PC', printerConnected: connected }),
          ...(connected ? {} : { pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겨 출력을 멈췄어요.', backlog: false } }),
        }),
      })
      return { body: { queue: current.queue } }
    })
  }

  it('"예" 기다림 멈춤 띠의 "테스트 인쇄"가 바로 테스트 인쇄 — 결과 "예/아니요"는 프린터 칸에', async () => {
    asDevice()
    const printer = await openLabels()
    window.livejjimTestPrinter?.setTestProfile('MARKLIFE_P50')
    await connectTest(printer)
    const band = await screen.findByRole('region', { name: '출력 멈춤' })
    await waitFor(() => expect(band.textContent).toContain('실험 중인 프린터라 출력을 잠시 멈췄어요.'))
    const test = within(band).getByRole('button', { name: '테스트 인쇄' })
    expect(test.classList.contains('button-primary')).toBe(true)
    fireEvent.click(test)
    await within(printer).findByRole('group', { name: '테스트 인쇄 결과' })
    expect(server.callsTo('GET', /test-bitmap/)).toHaveLength(1)
  })

  it('"예" 뒤 라벨 오류로 다시 멈추면 "이어서 해요" 대신 지난 일 문장', async () => {
    asDevice()
    const printer = await openLabels()
    window.livejjimTestPrinter?.setTestProfile('MARKLIFE_P50')
    await connectTest(printer)
    fireEvent.click(within(printer).getByRole('button', { name: '테스트 인쇄' }))
    fireEvent.click(within(await within(printer).findByRole('group', { name: '테스트 인쇄 결과' })).getByRole('button', { name: '예' }))
    await waitFor(() => expect(within(printer).getByText('좋아요. 멈췄던 출력을 이어서 해요.')).toBeTruthy())
    const paused = queue({ rev: 9, device: device(ME, { name: 'PC' }), pause: { reason: 'LABEL_ERROR', message: LABEL_ERROR_MESSAGE, backlog: false } })
    current = overview({ queue: paused })
    FakeEventSource.last.emit('print', { rev: 9, queue: paused, jobs: [], labels: [] })
    await waitFor(() => expect(within(printer).getByText('테스트 인쇄가 잘 나온 것을 확인했어요.')).toBeTruthy())
    expect(within(printer).queryByText('좋아요. 멈췄던 출력을 이어서 해요.')).toBeNull()
  })
})
