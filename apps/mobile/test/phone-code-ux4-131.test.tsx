// D-UX4-131 (사용자 지시 2026-11-12 "로그인 처음할 때 인증번호 입력할 때 키보드 위에 자동으로 인식된 인증번호 눌러서 자동으로 입력되어야 하는데 지금 안 된다. 고쳐라.
// 그리고 문자가 안 오나요? 이 버튼 디자인도 우리가 만든 일반 버튼 디자인(사진 참고)으로 바꿔." · "아이폰, 갤럭시 둘 다 공통적으로")
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhoneVerify } from '../src/screens/PhoneVerify.tsx'

const source = readFileSync(join(import.meta.dirname, '../src/screens/PhoneVerify.tsx'), 'utf8')

async function toCodeStep(verify: (code: string) => Promise<void>, send: (phone: string) => Promise<string> = async () => '010-****-5678') {
  render(<PhoneVerify send={send} verify={verify} back={{ label: '처음으로', onPress: () => {} }} />)
  fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '01012345678' } })
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await screen.findByLabelText('인증번호 6자리')
}

describe('인증번호 자동 채우기 (D-UX4-131)', () => {
  it('아이폰: 숨은 인증번호 칸은 여러 줄 칸 — 키보드 위 인증번호 채우기를 선택 바뀜으로도 받는다 (갤럭시는 한 줄 — 글 바뀜으로 늘 받는다)', () => {
    expect(source).toContain('textContentType="oneTimeCode"')
    expect(source).toContain('autoComplete="sms-otp"')
    expect(source).toContain("multiline={Platform.OS === 'ios'}")
  })

  it('키보드 위 인증번호를 누르면(칸 전체가 그 6자리로 바뀜) 바로 확인한다 — 아이폰·갤럭시 같다', async () => {
    const codes: string[] = []
    await toCodeStep(async (code) => void codes.push(code))
    fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '482913' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(codes).toEqual(['482913'])
  })

  it('[문자가 안 오나요?]는 [링크를 모르겠어요]와 같은 회색 칩 — 밑줄 글자가 아니다', async () => {
    await toCodeStep(async () => {})
    const chip = screen.getByRole('button', { name: '문자가 안 오나요?' })
    expect(source).toContain('<SoftChip label={CODE_NOT_COMING}')
    expect(chip.innerHTML).not.toContain('underline')
  })
})
