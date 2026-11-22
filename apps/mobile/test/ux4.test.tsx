// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 맥북 화면 다듬기 넷째 판 (D-UX4-01~06, 사용자 지시 2026-11-03): 단추는 늘 좌우(부정 왼쪽·긍정 오른쪽), 확인은 가운데 팝업,
// 곁길 단추는 작은 회색 단추, 켜고 끄기는 토스식 스위치, 프린터 고르기는 화면이 목록을 직접 그릴 수 있다, 라벨 칸 옮기기·키우기 계산.
import { FONT_SIZE_MAX as LABEL_FONT_MAX, FONT_SIZE_MIN as LABEL_FONT_MIN, ALL_LABEL_SIZES, SAMPLE_PRODUCT, defaultTemplate, formatLabelPrice, labelSizeInfo } from '@livejjim/label'
import type { BleDeviceInfo, DevicePicker, PickEntry } from '@livejjim/mobile-ble'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cancelPrinterPick, pickDevice, pickPrinter, setPickEntries, useInlinePrinterPick, usePickWindowShown, withPickWindow } from '../src/native/printer-pick.ts'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, fontStepped, labelDots, movedItem, resizedItem, sortedSizes, textBoxHeight } from '../src/screens/LabelSetupScreen.tsx'
import { firstChannelPopup } from '../src/lib/youtube.ts'
import { EXAMPLE_LABEL, EXAMPLE_LINES } from '../src/lib/label-example.ts'
import { BigButton, BottomCTA, ConfirmSheet, FormPage, PopupDialog, SmallButton, ToggleRow } from '../src/ui/kit/index.ts'

const names = (root: HTMLElement): (string | null)[] => Array.from(root.querySelectorAll('[role="button"]')).map((button) => button.getAttribute('aria-label'))

describe('D-UX4-01 단추는 좌우로 — 부정 왼쪽, 긍정 오른쪽', () => {
  it('입력 화면 맨 아래 단추 둘은 한 줄에 같은 폭으로, 놓은 차례대로 왼쪽부터', () => {
    render(
      <FormPage title="물어요" onBack={() => {}} actions={<><BigButton kind="outline" label="아니요" onPress={() => {}} /><BigButton label="네" onPress={() => {}} /></>} />,
    )
    const no = screen.getByRole('button', { name: '아니요' })
    const yes = screen.getByRole('button', { name: '네' })
    const row = no.parentElement?.parentElement as HTMLElement
    expect(row).toBe(yes.parentElement?.parentElement)
    expect(getComputedStyle(row).flexDirection).toBe('row')
    expect(getComputedStyle(no.parentElement as HTMLElement).flexGrow).toBe('1')
    expect(names(row)).toEqual(['아니요', '네'])
  })

  it('확인 판·화면 아래 고정 자리도 좌우 (취소가 왼쪽)', () => {
    render(
      <>
        <ConfirmSheet visible question="지울까요?" confirmLabel="지우기" onConfirm={() => {}} onCancel={() => {}} />
        <BottomCTA>
          <BigButton kind="secondary" label="닫기" onPress={() => {}} />
          <BigButton label="다음" onPress={() => {}} />
        </BottomCTA>
      </>,
    )
    const cancel = screen.getByRole('button', { name: '아니요' })
    expect(getComputedStyle(cancel.parentElement?.parentElement as HTMLElement).flexDirection).toBe('row')
    expect(names(cancel.parentElement?.parentElement as HTMLElement)).toEqual(['아니요', '지우기'])
    const close = screen.getByRole('button', { name: '닫기' })
    expect(names(close.parentElement?.parentElement as HTMLElement)).toEqual(['닫기', '다음'])
  })

  it('라벨 단계 단추들도 부정을 먼저 놓는다 (소스)', () => {
    const source = readFileSync(join(__dirname, '../src/screens/LabelSetupScreen.tsx'), 'utf8')
    // D-LBL-NOPRN-01: 왼쪽 단추가 [괜찮아요] → [프린터 없이](LABEL_WITHOUT_PRINTER)로 바뀌었다 (옛 기대: label="괜찮아요"가 먼저).
    // D-LBL-ASKNO-01: [프린터 없이] → [아니요](LABEL_ASK_NO) (옛 기대: label={LABEL_WITHOUT_PRINTER}). 없으면 -1이라 반드시 있는지도 본다
    const withoutPrinter = source.indexOf('label={LABEL_ASK_NO}')
    expect(withoutPrinter).toBeGreaterThanOrEqual(0)
    expect(withoutPrinter).toBeLessThan(source.indexOf('label="뽑을게요"'))
    expect(source.indexOf('label="아니요"')).toBeLessThan(source.indexOf('label="예"'))
    const keepDevice = source.indexOf("label={taken ? '그대로 두기' : '나중에 하기'}")
    expect(keepDevice).toBeGreaterThanOrEqual(0)
    expect(keepDevice).toBeLessThan(source.indexOf("label={taken ? '이 기기로 바꾸기' : '이 기기에서 출력'}"))
  })
})

describe('D-UX4-02 확인은 가운데 팝업', () => {
  it('묻는 말은 줄을 나눠 보이고, 왼쪽 부정·오른쪽 긍정, 바깥을 누르면 부정', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<PopupDialog visible message={firstChannelPopup('브롬톤다육')} name="처음 잇는 채널 확인" cancelLabel="아니에요" confirmLabel="맞아요" onConfirm={onConfirm} onCancel={onCancel} />)
    const dialog = screen.getByRole('alertdialog', { name: '처음 잇는 채널 확인' })
    expect(dialog.textContent).toContain('처음 연결하는 채널이에요.\n채널명: 브롬톤다육\n이 라이브가 맞나요?')
    expect(names(dialog)).toEqual(['아니에요', '맞아요'])
    fireEvent.click(screen.getByRole('button', { name: '맞아요' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '팝업 닫기' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('닫혀 있으면 그리지 않는다', () => {
    render(<PopupDialog visible={false} message="물어요" cancelLabel="취소" confirmLabel="옮기기" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('D-UX4-04 곁길 단추는 작은 회색 단추', () => {
  it('글자만큼의 폭으로 가운데에 놓인다', () => {
    const onPress = vi.fn()
    render(<SmallButton label="링크를 모르겠어요" onPress={onPress} />)
    const button = screen.getByRole('button', { name: '링크를 모르겠어요' })
    expect(getComputedStyle(button).alignSelf).toBe('center')
    fireEvent.click(button)
    expect(onPress).toHaveBeenCalled()
  })

  it('새 라이브·라이브 연결의 [링크를 모르겠어요]는 큰 단추가 아니다 (소스)', () => {
    // D-UX4-112: [링크를 모르겠어요]는 두 화면이 같이 쓰는 곁길 단추 줄(LinkSideButtons — [붙여넣기]와 한 줄) 안의 작은 회색 단추
    // (옛 기대: 두 화면 소스에 '<SmallButton label="링크를 모르겠어요"'가 바로 있음)
    // D-UX4-113 (사용자 지시 토스 "자세히 보기" 사진): 설명 바로 아래 왼쪽 회색 칩(SoftChip) — FormPage headerAction 자리
    for (const file of ['NewBroadcastScreen.tsx', 'BroadcastLinkScreen.tsx']) {
      const source = readFileSync(join(__dirname, '../src/screens', file), 'utf8')
      // D-UX4-117 (사용자 지시 "그 아래에 링크를 모르겠어요, 붙여넣기 버튼을 순서대로 한줄에"): 옛 기대 설명 아래 headerAction 자리 → 칸 아래 칩 줄(linker onUnknown)
      expect(source).toContain('onUnknown: () => setFinder(true)')
      expect(source).not.toContain('headerAction=')
      expect(source).not.toContain('<BigButton kind="outline" label="링크를 모르겠어요"')
    }
    const section = readFileSync(join(__dirname, '../src/screens/console/YoutubeSection.tsx'), 'utf8')
    expect(section).toContain('<SoftChip label={LINK_UNKNOWN} onPress={onPress} testID="link-unknown" />')
    expect(section).toContain("export const LINK_UNKNOWN = '링크를 모르겠어요'")
  })
})

describe('D-UX4-06 켜고 끄기는 토스식 스위치', () => {
  it('글자 알약 대신 스위치 — 이름은 "제목 — 켜짐/꺼짐", 줄 어디를 눌러도 바뀐다', () => {
    const onChange = vi.fn()
    render(<ToggleRow title="날짜" on onChange={onChange} />)
    const row = screen.getByRole('switch', { name: '날짜 — 켜짐' })
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(row.textContent).toBe('날짜')
    fireEvent.click(row)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})

describe('D-UX4-03 라벨 예시', () => {
  // 옛 기대 '30만원' — 새 기대 D-LABEL-ITEMS-01(만원 표기 "30만 원", 사용자 지시 2026-11-23 "30만 원 이렇게"): 그림 예시도 라벨 규칙과 같은 띄어쓰기
  it('라이브다육 · 26.11.03 · 365번 · 30만 원 · 삼광색금 · 지니다육', () => {
    expect(EXAMPLE_LABEL).toEqual({ shop: '라이브다육', date: '26.11.03', no: 365, price: '30만 원', name: '삼광색금', buyer: '지니다육' })
    expect(Object.values(EXAMPLE_LINES)).toEqual(['-라이브다육-', '번호: 365', '가격: 30만 원', '26.11.03', '품종: 삼광색금', '닉네임: 지니다육'])
  })

  it('서버 미리 보기 견본 값도 같은 예시다 (D-UX4-07)', () => {
    expect(SAMPLE_PRODUCT.no).toBe(EXAMPLE_LABEL.no)
    expect(SAMPLE_PRODUCT.name).toBe(EXAMPLE_LABEL.name)
    expect(formatLabelPrice(SAMPLE_PRODUCT.price, 'TEN_THOUSAND')).toBe(EXAMPLE_LABEL.price)
    expect(SAMPLE_PRODUCT.date.slice(2).replaceAll('-', '.')).toBe(EXAMPLE_LABEL.date)
    expect(SAMPLE_PRODUCT.buyer).toEqual({ kind: 'youtube', name: EXAMPLE_LABEL.buyer })
  })
})

type DeviceScan = Parameters<DevicePicker>[0]

/** 가짜 찾기: 받은 기기 목록을 손으로 넣는다 */
function fakeScan(): { readonly scan: DeviceScan; readonly found: (devices: BleDeviceInfo[]) => void } {
  let listener: ((devices: readonly BleDeviceInfo[]) => void) | null = null
  return {
    scan: {
      onDevices: (cb) => {
        listener = cb
        return () => {
          listener = null
        }
      },
    },
    found: (devices) => listener?.(devices),
  }
}

describe('D-UX4-04 프린터 고르기를 화면이 직접 그린다', () => {
  setPickEntries((devices) => devices.map((device): PickEntry => ({ device, title: device.name ?? '', model: 'NIIMBOT', signal: null, experimental: false, detail: 'NIIMBOT' })))
  const device = { id: 'd1', name: 'B1-1234' } as BleDeviceInfo

  it('목록을 그리는 화면이 떠 있으면 고르기 창을 띄우지 않고, 고르면 그 기기로', async () => {
    const seen: { window: readonly PickEntry[] | null; inline: readonly PickEntry[] | null } = { window: null, inline: null }
    function Window() {
      seen.window = usePickWindowShown()
      return null
    }
    function Inline() {
      seen.inline = useInlinePrinterPick()
      return null
    }
    render(<><Window /><Inline /></>)
    const { scan, found } = fakeScan()
    let picked: Promise<BleDeviceInfo | null> = Promise.resolve(null)
    act(() => {
      picked = pickDevice(scan)
      found([device])
    })
    expect(seen.window).toBeNull()
    expect(seen.inline?.map((entry) => entry.title)).toEqual(['B1-1234'])
    act(() => pickPrinter(device))
    await expect(picked).resolves.toBe(device)
    expect(seen.inline).toBeNull()
  })

  // D-NOPICK-02: 옛 기대 "목록을 그리는 화면이 없으면 늘 고르기 창" → 판매자가 누른 연결(withPickWindow) 안에서만 창
  it('목록을 그리는 화면이 없으면 판매자가 누른 연결에서만 고르기 창, 그만두면 null', async () => {
    let shown: readonly PickEntry[] | null = null
    function Window() {
      shown = usePickWindowShown()
      return null
    }
    render(<Window />)
    let picked: Promise<BleDeviceInfo | null> = Promise.resolve(device)
    act(() => {
      picked = withPickWindow(() => pickDevice(fakeScan().scan))
    })
    expect(shown).toEqual([])
    act(() => cancelPrinterPick())
    await expect(picked).resolves.toBeNull()
    expect(shown).toBeNull()
  })

  it('판매자가 부르지 않은 고르기(연결 화면을 떠난 뒤 늦게 끝난 찾기 등)는 창을 띄우지 않고 바로 null (D-NOPICK-02)', async () => {
    let shown: readonly PickEntry[] | null = null
    function Window() {
      shown = usePickWindowShown()
      return null
    }
    function Inline() {
      useInlinePrinterPick()
      return null
    }
    render(<Window />)
    const screenView = render(<Inline />)
    // 연결 화면이 떠 있는 동안 시작한 찾기가(기억한 프린터 알아보기 5초) 화면을 떠난 뒤에야 고르기로 넘어간다
    screenView.unmount()
    let picked: Promise<BleDeviceInfo | null> = Promise.resolve(device)
    act(() => {
      picked = pickDevice(fakeScan().scan)
    })
    expect(shown).toBeNull()
    await expect(picked).resolves.toBeNull()
    expect(shown).toBeNull()
  })

  it('목록을 그리던 화면이 닫히면 찾기를 그만둔다', async () => {
    function Inline() {
      useInlinePrinterPick()
      return null
    }
    const view = render(<Inline />)
    let picked: Promise<BleDeviceInfo | null> = Promise.resolve(device)
    act(() => {
      picked = pickDevice(fakeScan().scan)
    })
    view.unmount()
    await expect(picked).resolves.toBeNull()
  })
})

describe('D-UX4-05 라벨 칸 옮기기·키우기 계산', () => {
  const template = defaultTemplate('product', '50x30')
  const { widthDots: W, heightDots: H } = labelSizeInfo('50x30')

  it('옮기면 점 단위 정수로, 라벨 밖으로는 나가지 않는다', () => {
    const shop = template.items.shop
    expect(movedItem(shop, 10.4, -2.6, W, H)).toMatchObject({ x: shop.x + 10, y: shop.y - 3 })
    expect(movedItem(shop, -1000, 1000, W, H)).toMatchObject({ x: 0, y: H - shop.height })
    expect(movedItem(shop, 1000, -1000, W, H)).toMatchObject({ x: W - shop.width, y: 0 })
  })

  // 옛 기대: 상자 높이를 끈 만큼 키우고 글자는 높이 비율로, 아래로 끝까지 끌면 y + 높이 = H.
  // 새 기대 D-LABEL-SNAP-01 (사용자 지시 2026-11-23 "파워포인트에서 텍스트 박스 조절하듯이 … 쓸데없는 여백 생기게 하지 말라"): 끈 높이로 글자를 정하고 높이는 늘 그 글자 한 줄 높이
  it('키우면 글자 크기가 끈 만큼 — 높이는 글자 한 줄, 라벨 안, 글자 16~120, 최소 글자 ≤ 글자', () => {
    const name = template.items.name
    const bigger = resizedItem(name, 0, 20, W, H)
    expect(bigger.fontSize).toBe(Math.min(Math.floor((textBoxHeight(name.fontSize) + 20) / 1.25), FONT_SIZE_MAX))
    expect(bigger.height).toBe(Math.min(textBoxHeight(bigger.fontSize), H - name.y))
    const tiny = resizedItem(name, -1000, -1000, W, H)
    expect(tiny.width).toBe(24)
    expect(tiny.height).toBe(textBoxHeight(16))
    expect(tiny.fontSize).toBe(16)
    expect(tiny.minFontSize).toBeLessThanOrEqual(tiny.fontSize)
    const wide = resizedItem(name, 1000, 1000, W, H)
    expect(wide.x + wide.width).toBe(W)
    expect(wide.y + wide.height).toBeLessThanOrEqual(H)
    expect(wide.height).toBe(textBoxHeight(wide.fontSize))
    // 더 큰 글자는 라벨 밖으로 나가거나 이미 가장 큰 글자
    expect(wide.fontSize === FONT_SIZE_MAX || wide.y + textBoxHeight(wide.fontSize + 1) > H).toBe(true)
  })

  it('글자 크기 한 단계: 커지면 상자 높이도 따라, 16 아래로는 안 내려간다', () => {
    const number = template.items.number
    const up = fontStepped({ ...number, fontSize: 40 }, 2, H)
    expect(up.fontSize).toBe(42)
    expect(up.height).toBeGreaterThanOrEqual(Math.min(Math.ceil(42 * 1.25), H - number.y))
    // D-LABEL-SNAP-01: 높이는 글자 한 줄 높이 그대로(줄이면 같이 준다), 라벨 아래 끝을 넘게는 안 커진다
    expect(up.height).toBe(textBoxHeight(42))
    expect(fontStepped({ ...number, fontSize: 40, height: 90 }, -2, H).height).toBe(textBoxHeight(38))
    const low = { ...number, y: H - textBoxHeight(40), fontSize: 40 }
    expect(fontStepped(low, 2, H)).toBe(low)
    expect(fontStepped({ ...number, fontSize: 16, minFontSize: 16 }, -2, H)).toMatchObject({ fontSize: 16, minFontSize: 16 })
  })

  it('앱이 옮겨 둔 숫자는 라벨 규칙과 같다 (글자 크기 범위·모든 크기의 점)', () => {
    expect([FONT_SIZE_MIN, FONT_SIZE_MAX]).toEqual([LABEL_FONT_MIN, LABEL_FONT_MAX])
    for (const size of ALL_LABEL_SIZES) {
      const info = labelSizeInfo(size)
      // D-LABEL-SAFE-01로 앱 labelDots에 테이프 여부(tape)가 생겼다 — 라벨 규칙의 tape와도 같아야 한다
      expect(labelDots(size), size).toEqual({ widthMm: info.widthMm, heightMm: info.heightMm, widthDots: info.widthDots, heightDots: info.heightDots, tape: info.tape })
    }
    expect(labelDots('엉뚱한 크기')).toBeNull()
  })

  it('라벨 크기는 작은 것부터', () => {
    expect(sortedSizes(['50x40', '50x30', '50x20', '50x50'])).toEqual(['50x20', '50x30', '50x40', '50x50'])
  })
})
