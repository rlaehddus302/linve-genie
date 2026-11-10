// 아래 창·가운데 팝업 닫기 다듬기 (D-UX4-103, 사용자 지시 2026-11-10 "팝업이나 아래 팝업 닫을 때 안에 내용이 사라져서 닫김" · "모든 아래팝업의 닫기 버튼을 없애")
// 와 반 화면 판 (D-UX4-106, 상품 고치기).
// 웹(시험)은 판이 바로 열리고 닫혀 닫히는 움직임 동안을 그릴 수 없다 — 붙잡아 두기는 훅(useHeldWhileClosing)을 직접 시험하고, 판들이 그것을 쓰는지는 소스로 본다.
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextInput } from 'react-native'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { BigButton, BottomSheet, PopupDialog, SHEET, Txt, useHeldWhileClosing } from '../src/ui/kit/index.ts'

const css = (el: Element) => getComputedStyle(el)
const source = (path: string) => readFileSync(join(__dirname, '../src', path), 'utf8')
/** 소스에서 함수 하나의 몸통 (다음 export까지) */
const functionBody = (text: string, name: string) => {
  const start = text.indexOf(`export function ${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = text.indexOf('\nexport ', start + 1)
  return text.slice(start, next < 0 ? undefined : next)
}

describe('닫히는 동안 마지막 모습 붙잡기 (D-UX4-103)', () => {
  it('열려 있으면 받은 값, 닫히기 시작하면 열려 있던 마지막 값, 다시 열리면 새 값', () => {
    const { result, rerender } = renderHook((props: { visible: boolean; value: string | null }) => useHeldWhileClosing(props.visible, props.value), { initialProps: { visible: true, value: '15번 핑크프릴' as string | null } })
    expect(result.current).toBe('15번 핑크프릴')
    rerender({ visible: true, value: '16번 레티지아' })
    expect(result.current).toBe('16번 레티지아')
    // 부르는 쪽이 닫으면서 내용을 비워도(null) 닫히는 동안은 마지막 내용
    rerender({ visible: false, value: null })
    expect(result.current).toBe('16번 레티지아')
    rerender({ visible: false, value: '다른 것' })
    expect(result.current).toBe('16번 레티지아')
    rerender({ visible: true, value: '17번 정야' })
    expect(result.current).toBe('17번 정야')
  })

  it('BottomSheet·PopupDialog·FullSheet는 그리는 값(제목·내용·단추·글)을 모두 붙잡은 것에서 꺼낸다 (소스)', () => {
    const text = source('ui/kit/sheets.tsx')
    const bottom = functionBody(text, 'BottomSheet')
    expect(bottom).toMatch(/export function BottomSheet\(\{ visible, onClose, testID, \.\.\.look \}/)
    expect(bottom).toMatch(/\{ title, description, children, actions, half = false, bodyPadding = true \} = useHeldWhileClosing\(visible, look\)/)
    const popup = functionBody(text, 'PopupDialog')
    expect(popup).toMatch(/\.\.\.look \}: PopupDialogProps/)
    expect(popup).toMatch(/\{ message, name, description, content, confirmLabel, cancelLabel, danger \} = useHeldWhileClosing\(visible, look\)/)
    const full = functionBody(text, 'FullSheet')
    expect(full).toMatch(/\{ title, name, children, actions, closeLabel = '닫기', cards, overlay \} = useHeldWhileClosing\(visible, look\)/)
    // ConfirmSheet는 BottomSheet로 그린다 — 따라서 같이 붙잡힌다
    expect(functionBody(text, 'ConfirmSheet')).toContain('<BottomSheet')
  })
})

describe('아래 창에는 닫기 단추가 없다 (D-UX4-103)', () => {
  it('단추를 안 줘도 닫기 단추를 붙이지 않는다 (소스)', () => {
    expect(functionBody(source('ui/kit/sheets.tsx'), 'BottomSheet')).not.toMatch(/label="닫기"/)
  })

  it('단추를 안 주면 단추 줄이 없고 내용 아래를 글 옆 여백(24)만큼 띄운다 · 단추를 주면 그것만', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <BottomSheet visible onClose={onClose} title="도움말">
        <Txt>설명</Txt>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: '도움말' })
    expect(within(dialog).queryByTestId('sheet-actions')).toBeNull()
    expect(within(dialog).queryAllByRole('button')).toHaveLength(0)
    expect(css(within(dialog).getByTestId('sheet-body').firstElementChild!).paddingBottom).toBe(`${String(SHEET.end)}px`)
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    expect(onClose).toHaveBeenCalledOnce()
    rerender(
      <BottomSheet visible onClose={onClose} title="도움말" actions={<BigButton label="저장" onPress={() => {}} />}>
        <Txt>설명</Txt>
      </BottomSheet>,
    )
    const footer = within(screen.getByRole('dialog', { name: '도움말' })).getByTestId('sheet-actions')
    expect(within(footer).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['저장'])
  })

  it('앱의 아래 창들이 닫기(·확인) 단추를 넘기지 않는다 (소스)', () => {
    // 옛: 아래 창 actions에 [닫기 | 저장]처럼 회색 닫기 단추를 왼쪽에 두었다. 가운데 팝업(PopupDialog)의 "닫기"는 그대로다
    for (const path of ['screens/EpostScreen.tsx', 'screens/ParcelExtra.tsx', 'screens/DepositsScreen.tsx', 'screens/ParcelAddress.tsx', 'screens/SettleScreen.tsx', 'screens/ScheduleScreen.tsx', 'screens/ReceiptsScreen.tsx', 'screens/BuyersScreen.tsx']) {
      expect(source(path), path).not.toMatch(/<BigButton[^>]*label="닫기"/)
    }
    // 감사 채팅 도움말 아래 창의 [확인]도 닫기와 같아 없앤다
    expect(source('screens/console/Manage.tsx')).not.toMatch(/<BigButton[^>]*label="확인"/)
  })
})

describe('반 화면 판 (D-UX4-106)', () => {
  it('화면 양옆·아래에 붙고 위 두 귀만 둥글며, 화면 높이의 절반 이상이다', () => {
    // jsdom은 화면 높이가 0 — 800인 화면으로 잰다
    const root = document.documentElement
    const before = Object.getOwnPropertyDescriptor(root, 'clientHeight')
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 800 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    onTestFinished(() => {
      if (before === undefined) Reflect.deleteProperty(root, 'clientHeight')
      else Object.defineProperty(root, 'clientHeight', before)
      window.dispatchEvent(new Event('resize'))
    })
    render(
      <BottomSheet visible half onClose={() => {}} title="상품 고치기">
        <Txt>내용</Txt>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: '상품 고치기' })
    expect(css(dialog).marginLeft).toBe('0px')
    expect(css(dialog).marginRight).toBe('0px')
    expect(css(dialog).marginBottom).toBe('0px')
    expect(css(dialog).borderTopLeftRadius).toBe(`${String(SHEET.radius)}px`)
    expect(css(dialog).borderTopRightRadius).toBe(`${String(SHEET.radius)}px`)
    expect(css(dialog).borderBottomLeftRadius).toBe('0px')
    expect(css(dialog).borderBottomRightRadius).toBe('0px')
    expect(css(dialog).minHeight).toBe(`${String(Math.round(800 * SHEET.halfMin))}px`)
    // 내용 자리가 남는 높이를 채운다
    expect(css(within(dialog).getByTestId('sheet-body')).flexGrow).toBe('1')
  })

  it('열린 채로 half를 바꿔도 안의 입력 칸이 같은 것으로 남고 커서도 그대로다', () => {
    const view = (half: boolean) => (
      <BottomSheet visible half={half} onClose={() => {}} title="가격">
        <TextInput aria-label="가격 칸" defaultValue="12000" />
      </BottomSheet>
    )
    const { rerender } = render(view(false))
    const field = screen.getByLabelText('가격 칸')
    act(() => field.focus())
    expect(document.activeElement).toBe(field)
    rerender(view(true))
    expect(screen.getByLabelText('가격 칸')).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(css(screen.getByRole('dialog', { name: '가격' })).marginBottom).toBe('0px')
    rerender(view(false))
    expect(screen.getByLabelText('가격 칸')).toBe(field)
    expect(document.activeElement).toBe(field)
  })

  it('bodyPadding={false}면 내용 자리 양옆 여백·줄 사이가 없다 (기본은 24·12)', () => {
    const { rerender } = render(
      <BottomSheet visible onClose={() => {}} title="숫자">
        <Txt>1</Txt>
      </BottomSheet>,
    )
    const padded = screen.getByTestId('sheet-body').firstElementChild!
    expect(css(padded).paddingLeft).toBe(`${String(SHEET.side)}px`)
    expect(css(padded).gap).toBe('12px')
    rerender(
      <BottomSheet visible bodyPadding={false} onClose={() => {}} title="숫자">
        <Txt>1</Txt>
      </BottomSheet>,
    )
    const bare = screen.getByTestId('sheet-body').firstElementChild!
    expect(css(bare).paddingLeft).toBe('0px')
    expect(css(bare).paddingRight).toBe('0px')
    expect(css(bare).gap).toBe('0px')
  })
})

describe('가운데 팝업 content (D-UX4-103)', () => {
  it('content를 주면 묻는 말 자리에 그것을 그리고, 묻는 말은 보조 기술 이름으로만 쓴다', () => {
    render(
      <PopupDialog
        visible
        message="15번 핑크프릴을 삭제할까요?"
        content={
          <Txt step="lead" weight="bold">
            <Txt step="lead" weight="bold" color="primaryText">15번 핑크프릴</Txt>을 삭제할까요?
          </Txt>
        }
        confirmLabel="삭제"
        cancelLabel="닫기"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: '15번 핑크프릴을 삭제할까요?' })
    expect(within(dialog).getByText('15번 핑크프릴')).toBeTruthy()
    expect(within(dialog).queryByText('15번 핑크프릴을 삭제할까요?')).toBeNull()
    // 가운데 팝업의 부정 단추 "닫기"는 그대로 (아래 창만 닫기 단추를 없앤다)
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['닫기', '삭제'])
  })
})
