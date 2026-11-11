// D-UX4-132 (사용자 지시 2026-11-12 "문자가 안 오나요 버튼 중간 정렬하고 키보드로 부터 좀 더 위로 띄워.
// 그리고 휴대폰 번호 입력받는 화면에서 키보드를 우리가 만든 키보드로 쓰자. 단 00 버튼만 빼고.")
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { padKeyAt } from '../src/screens/console/ProductAdd.tsx'
import { NOT_COMING_LIFT, PhoneVerify } from '../src/screens/PhoneVerify.tsx'
import { SPACE } from '../src/ui/kit/tokens.ts'

const source = readFileSync(join(import.meta.dirname, '../src/screens/PhoneVerify.tsx'), 'utf8')

function open(send: (phone: string) => Promise<string> = async () => '010-****-5678') {
  render(<PhoneVerify send={send} verify={async () => {}} back={{ label: '처음으로', onPress: () => {} }} />)
}

describe('휴대폰 번호는 앱 숫자판으로 (D-UX4-132)', () => {
  it('번호 단계에 앱 숫자판이 있고 00 키는 없다 (0·지우기는 있다)', () => {
    open()
    const pad = screen.getByRole('group', { name: '숫자판' })
    expect(within(pad).queryByRole('button', { name: '00' })).toBeNull()
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '지우기']) expect(within(pad).getByRole('button', { name: key })).toBeTruthy()
  })

  it('숫자판으로 넣으면 칸에 010-1234-5678로 보이고 [다음]이 켜진다, 지우기는 끝 한 자리', () => {
    open()
    const pad = screen.getByRole('group', { name: '숫자판' })
    for (const key of '01012345678') fireEvent.click(within(pad).getByRole('button', { name: key }))
    const field = screen.getByLabelText<HTMLInputElement>('휴대폰 번호')
    expect(field.value).toBe('010-1234-5678')
    expect(screen.getByTestId('phone-next').getAttribute('aria-disabled')).not.toBe('true')
    // 11자리 넘게는 받지 않는다
    fireEvent.click(within(pad).getByRole('button', { name: '9' }))
    expect(field.value).toBe('010-1234-5678')
    fireEvent.click(within(pad).getByRole('button', { name: '지우기' }))
    // 10자리는 010-123-4567 모양으로 보인다(옛 번호 모양, formatMobileInput)
    expect(field.value).toBe('010-123-4567')
  })

  it('칸을 눌러도 휴대폰 키보드는 뜨지 않는다 (아이폰·갤럭시 같은 showSoftInputOnFocus)', () => {
    expect(source).toContain('showSoftInputOnFocus={false}')
  })

  it('휴대폰에서 00 자리(왼쪽 아래)를 눌러도 아무 키도 아니다', () => {
    const width = 300
    const lastRow = SPACE.xs + 64 * 3 + 10
    expect(padKeyAt(20, lastRow, width, [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', 'back']])).toBeNull()
    expect(padKeyAt(150, lastRow, width, [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', 'back']])).toBe('0')
    // 상품 추가 숫자판은 00 그대로
    expect(padKeyAt(20, lastRow, width)).toBe('00')
  })
})

describe('[문자가 안 오나요?] 가운데·더 위로 (D-UX4-132)', () => {
  it('칩은 가운데(alignSelf center), 키보드와 사이가 옛 16보다 넓다', async () => {
    open()
    const pad = screen.getByRole('group', { name: '숫자판' })
    for (const key of '01012345678') fireEvent.click(within(pad).getByRole('button', { name: key }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const chip = await screen.findByRole('button', { name: '문자가 안 오나요?' })
    expect(getComputedStyle(chip).alignSelf).toBe('center')
    expect(SPACE.md + NOT_COMING_LIFT).toBeGreaterThan(16)
  })
})
