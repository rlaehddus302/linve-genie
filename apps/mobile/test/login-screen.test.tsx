// 로그인 화면 (APP-01 AC1 "앱을 열면 로그인 화면"): 아이디·비밀번호 칸, 틀리면 서버 문장 그대로 + 안내, 맞으면 onLogin.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SESSION_EXPIRED_MESSAGE } from '../src/lib/words.ts'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'

describe('LoginScreen', () => {
  it('아이디·비밀번호를 적고 로그인을 누르면 onLogin을 부른다', async () => {
    const onLogin = vi.fn(async () => {})
    render(<LoginScreen expired={false} onLogin={onLogin} />)
    expect(screen.getByRole('heading', { name: '라이브지니' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'seller1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('seller1', 'pw'))
  })

  it('틀리면 서버 문장을 그대로 보이고 아이디는 남기며 운영자 안내를 붙인다', async () => {
    const onLogin = vi.fn(async () => {
      throw new ApiError({ status: 401, code: 'LOGIN_FAILED', message: '아이디 또는 비밀번호가 맞지 않아요.' })
    })
    render(<LoginScreen expired={false} onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'seller1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('아이디 또는 비밀번호가 맞지 않아요.'))
    expect(screen.getByText(LOGIN_FAILED_HINT)).toBeTruthy()
    expect((screen.getByLabelText('아이디') as HTMLInputElement).value).toBe('seller1')
    expect((screen.getByLabelText('비밀번호') as HTMLInputElement).value).toBe('')
  })

  it('세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다', () => {
    render(<LoginScreen expired onLogin={async () => {}} />)
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy()
  })

  it('켤 때 서버에 닿지 못했으면 로그인이 풀렸다고 하지 않고 "다시 확인"을 보인다 (APP2 실기기)', async () => {
    const onRecheck = vi.fn(async () => {})
    render(<LoginScreen expired={false} offline onRecheck={onRecheck} onLogin={async () => {}} />)
    expect(screen.getByText(OFFLINE_AT_START_MESSAGE)).toBeTruthy()
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1))
  })
})
