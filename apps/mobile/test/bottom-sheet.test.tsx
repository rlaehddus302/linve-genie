// 아래 창 (D-UX4-76, 사용자 지시 2026-11-10 토스 "비밀번호 인증" 사진): 양옆·아래 GUTTER만큼 떠 있는 둥근 카드, 위 손잡이, 굵은 제목·회색 설명,
// 아래 단추는 스크롤 밖 카드 바닥에 고정(옆·아래 여백 같음), 고르기 줄은 radio이고 고른 줄에만 체크.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BigButton, BottomSheet, ConfirmSheet, GUTTER, ListRow, PopupDialog, SHEET, SHEET_DRAG, sheetBottomGap, sheetDragCloses, SheetChoices } from '../src/ui/kit/index.ts'

const css = (el: Element) => getComputedStyle(el)

describe('아래 창 모양 (D-UX4-76)', () => {
  it('위에 손잡이가 있고, 카드가 화면 양옆에서 GUTTER만큼 떨어져 네 귀가 둥글다', () => {
    render(
      <BottomSheet visible onClose={() => {}} title="비밀번호 인증">
        <ListRow title="하나" />
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: '비밀번호 인증' })
    const handle = within(dialog).getByTestId('sheet-handle')
    expect(handle.getAttribute('aria-hidden')).toBe('true')
    expect(css(handle).width).toBe(`${String(SHEET.handleWidth)}px`)
    expect(css(handle).height).toBe(`${String(SHEET.handleHeight)}px`)
    expect(css(dialog).marginLeft).toBe(`${String(GUTTER)}px`)
    expect(css(dialog).marginRight).toBe(`${String(GUTTER)}px`)
    expect(css(dialog).marginBottom).toBe(`${String(GUTTER)}px`)
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'] as const) expect(css(dialog)[corner]).toBe(`${String(SHEET.radius)}px`)
  })

  it('아래 여백은 GUTTER — 홈 표시줄 자리가 더 크면 그만큼, 키보드가 뜨면 GUTTER', () => {
    expect(sheetBottomGap(0)).toBe(GUTTER)
    expect(sheetBottomGap(34)).toBe(34)
    expect(sheetBottomGap(34, true)).toBe(GUTTER)
  })

  it('제목은 굵은 머리글, 설명은 그 아래 회색 글', () => {
    render(<BottomSheet visible onClose={() => {}} title="비밀번호 인증" description="토스 앱을 열 때 쓰는 비밀번호예요." />)
    const heading = screen.getByRole('heading', { name: '비밀번호 인증' })
    expect(Number(css(heading).fontWeight)).toBeGreaterThanOrEqual(600) // 굵게(700)는 Pretendard SemiBold로 그린다 (D-UX3-70)
    const description = screen.getByText('토스 앱을 열 때 쓰는 비밀번호예요.')
    expect(heading.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(css(description).color).not.toBe(css(heading).color)
  })

  it('아래 단추는 스크롤되는 내용 밖, 카드 바닥에 있고 옆·아래 여백이 같다', () => {
    render(
      <BottomSheet visible onClose={() => {}} title="고르기" actions={<BigButton label="확인" onPress={() => {}} />}>
        {Array.from({ length: 30 }, (_, i) => (
          <ListRow key={i} title={`줄 ${String(i)}`} />
        ))}
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: '고르기' })
    const body = within(dialog).getByTestId('sheet-body')
    const button = screen.getByRole('button', { name: '확인' })
    expect(body.contains(screen.getByText('줄 0'))).toBe(true)
    expect(body.contains(button)).toBe(false)
    const footer = within(dialog).getByTestId('sheet-actions')
    expect(footer.contains(button)).toBe(true)
    expect(dialog.lastElementChild).toBe(footer)
    expect(css(footer).paddingLeft).toBe(`${String(SHEET.buttonInset)}px`)
    expect(css(footer).paddingRight).toBe(css(footer).paddingLeft)
    expect(css(footer).paddingBottom).toBe(css(footer).paddingLeft)
  })

  it('단추를 안 주면 "닫기" 하나, 바깥을 눌러도 닫힌다', () => {
    const onClose = vi.fn()
    render(<BottomSheet visible onClose={onClose} title="알림" />)
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('확인 질문(ConfirmSheet)도 같은 아래 창 — 손잡이·설명·좌우 단추', () => {
    render(<ConfirmSheet visible question="방송을 끝낼까요?" description="끝난 뒤에도 늦게 온 채팅은 처리돼요." confirmLabel="끝내기" danger onConfirm={() => {}} onCancel={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '방송을 끝낼까요?' })
    expect(within(dialog).getByTestId('sheet-handle')).toBeTruthy()
    expect(within(dialog).getByText('끝난 뒤에도 늦게 온 채팅은 처리돼요.')).toBeTruthy()
    expect(css(dialog).marginLeft).toBe(`${String(GUTTER)}px`)
    const footer = within(dialog).getByTestId('sheet-actions')
    expect(within(footer).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['아니요', '끝내기'])
  })

  it('끌어내려 닫기: 충분히 내렸거나 빠르게 튕기면 닫고, 조금 내리면 제자리', () => {
    expect(sheetDragCloses(SHEET_DRAG.close + 1, 0, 600)).toBe(true)
    expect(sheetDragCloses(40, 0, 600)).toBe(false)
    expect(sheetDragCloses(20, SHEET_DRAG.flick + 0.1, 600)).toBe(true)
    expect(sheetDragCloses(-20, 2, 600)).toBe(false)
    // 낮은 창은 높이의 1/3만 내려도 닫힌다
    expect(sheetDragCloses(70, 0, 180)).toBe(true)
  })
})

describe('아래 창 고르기 줄 SheetChoices (D-UX4-76)', () => {
  const CHOICES = [
    { value: 'one', label: '비밀번호', description: '6자리 숫자', accent: '1단계' },
    { value: 'two', label: '비밀번호 + 생체 인증', accent: '2단계' },
    { value: 'three', label: '안 쓰기' },
  ] as const

  function Harness({ onPick }: { readonly onPick: (v: string) => void }) {
    const [value, setValue] = useState<string>('two')
    return (
      <BottomSheet visible onClose={() => {}} title="비밀번호 인증">
        <SheetChoices
          label="비밀번호 인증"
          choices={CHOICES}
          value={value}
          onPick={(next) => {
            setValue(next)
            onPick(next)
          }}
        />
      </BottomSheet>
    )
  }

  it('radiogroup 안 radio들, 고른 줄만 aria-checked이고 체크도 그 줄에만', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    const group = screen.getByRole('radiogroup', { name: '비밀번호 인증' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['1단계 비밀번호', '2단계 비밀번호 + 생체 인증', '안 쓰기'])
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(radios.map((r) => within(r).queryByTestId('choice-check') !== null)).toEqual([false, true, false])
    expect(within(group).getAllByTestId('choice-check')).toHaveLength(1)
    expect(within(radios[0]!).getByText('6자리 숫자')).toBeTruthy()

    fireEvent.click(radios[2]!)
    expect(onPick).toHaveBeenCalledWith('three')
    const after = within(group).getAllByRole('radio')
    expect(after.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    expect(after.map((r) => within(r).queryByTestId('choice-check') !== null)).toEqual([false, false, true])
  })

  it('고른 줄의 이름 색은 다른 줄과 같고(체크만 표시), 꼬리 글은 주색', () => {
    render(<Harness onPick={() => {}} />)
    const chosen = screen.getByText('비밀번호 + 생체 인증')
    const other = screen.getByText('안 쓰기')
    expect(css(chosen).color).toBe(css(other).color)
    expect(css(chosen).fontWeight).toBe(css(other).fontWeight)
    expect(css(screen.getByText('2단계')).color).not.toBe(css(chosen).color)
  })

  it('줄 글의 왼쪽 끝이 창 제목과 같다 (누름 바탕만 양옆으로 넓다)', () => {
    render(<Harness onPick={() => {}} />)
    const group = screen.getByRole('radiogroup')
    const radio = within(group).getAllByRole('radio')[0]!
    const bleed = -Number.parseFloat(css(group).marginLeft)
    expect(bleed).toBeGreaterThan(0)
    expect(Number.parseFloat(css(radio).paddingLeft)).toBe(bleed)
    expect(css(screen.getByTestId('sheet-body').firstElementChild!).paddingLeft).toBe(`${String(SHEET.side)}px`)
  })
})

describe('가운데 팝업 위험 단추 (PopupDialog danger)', () => {
  it('danger면 오른쪽 긍정 단추만 빨간 바탕, 왼쪽은 그대로 회색', () => {
    const { unmount } = render(<PopupDialog visible message="방송 연결을 끊을까요?" confirmLabel="끊기" cancelLabel="취소" onConfirm={() => {}} onCancel={() => {}} />)
    const plain = css(screen.getByRole('button', { name: '끊기' })).backgroundColor
    const plainCancel = css(screen.getByRole('button', { name: '취소' })).backgroundColor
    unmount()
    const onConfirm = vi.fn()
    render(<PopupDialog visible danger message="방송 연결을 끊을까요?" confirmLabel="끊기" cancelLabel="취소" onConfirm={onConfirm} onCancel={() => {}} />)
    const confirm = screen.getByRole('button', { name: '끊기' })
    expect(css(confirm).backgroundColor).not.toBe(plain)
    expect(css(screen.getByRole('button', { name: '취소' })).backgroundColor).toBe(plainCancel)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
