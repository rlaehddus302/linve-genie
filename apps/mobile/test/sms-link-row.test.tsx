// 설정 "문자 연동" 칸 (SMS4): 빌드 스위치 off면 숨김, 켜기 → 권한 묻기 → 켬, 거절하면 설정 안내, 채팅 문자 안내
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PhoneNoticePort, PhoneSmsPort, PhoneSmsState } from '../src/native/notice.ts'
import { SMS_LINK_CHAT, SMS_LINK_INTRO, SMS_LINK_ON, SMS_LINK_PERMISSION_OFF, SmsLinkRow, smsLinkLine } from '../src/screens/SmsLinkRow.tsx'

afterEach(() => {
  cleanup()
})

class FakeSms implements PhoneSmsPort {
  state: PhoneSmsState = { available: true, permission: 'needed', enabled: false, active: false }
  allow = true
  calls: string[] = []
  getState = async () => this.state
  requestPermission = async () => {
    this.calls.push('ask')
    this.state = { ...this.state, permission: this.allow ? 'granted' : 'needed' }
    return this.state
  }
  setEnabled = async (on: boolean) => {
    this.calls.push(`set:${String(on)}`)
    this.state = { ...this.state, enabled: on, active: on && this.state.permission === 'granted' }
    return this.state
  }
}

function portWith(sms: PhoneSmsPort | null): PhoneNoticePort & { opened: string[] } {
  const opened: string[] = []
  const state = { platform: 'android' as const, enabled: true, access: 'granted' as const, hasToken: true, tokenRejected: false, pending: 0, lastSentAtMs: null }
  return {
    opened,
    start: async () => state,
    stop: async () => state,
    getState: async () => state,
    addStateListener: () => () => undefined,
    openSettings: async (target) => {
      opened.push(target ?? 'app')
      return true
    },
    setToken: async () => state,
    sms,
  }
}

describe('문자 연동 줄', () => {
  it('상태별 한 줄', () => {
    const off: PhoneSmsState = { available: true, permission: 'needed', enabled: false, active: false }
    expect(smsLinkLine(off, true)).toBe(SMS_LINK_INTRO)
    expect(smsLinkLine({ ...off, enabled: true }, true)).toBe(SMS_LINK_PERMISSION_OFF)
    expect(smsLinkLine({ ...off, enabled: true, permission: 'granted', active: true }, true)).toBe(SMS_LINK_ON)
  })
})

describe('문자 연동 칸', () => {
  it('이 빌드에 문자 권한이 없으면(LIVEGENIE_SMS=off — available false) 그리지 않는다', async () => {
    const sms = new FakeSms()
    sms.state = { ...sms.state, available: false }
    render(<SmsLinkRow port={portWith(sms)} noticeOn accessNeeded={false} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('문자 연동')).toBeNull()
  })

  it('모듈에 문자 연동이 없으면(아이폰·옛 모듈) 그리지 않는다', async () => {
    render(<SmsLinkRow port={portWith(null)} noticeOn accessNeeded={false} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('문자 연동')).toBeNull()
  })

  it('켜기 → 권한 → 켬, 알림 읽기가 꺼져 있으면 채팅 문자 안내', async () => {
    const sms = new FakeSms()
    const port = portWith(sms)
    render(<SmsLinkRow port={port} noticeOn accessNeeded />)
    fireEvent.click(await screen.findByText('문자 연동 켜기'))
    await screen.findByText(SMS_LINK_ON)
    expect(sms.calls).toEqual(['ask', 'set:true'])
    expect(screen.getByText(SMS_LINK_CHAT)).toBeTruthy()
    fireEvent.click(screen.getByText('알림 읽기 켜러 가기'))
    await waitFor(() => expect(port.opened).toEqual(['notificationAccess']))
  })

  it('권한을 거절하면 켜지 않고 설정 안내', async () => {
    const sms = new FakeSms()
    sms.allow = false
    const port = portWith(sms)
    render(<SmsLinkRow port={port} noticeOn accessNeeded={false} />)
    fireEvent.click(await screen.findByText('문자 연동 켜기'))
    await screen.findAllByText(SMS_LINK_PERMISSION_OFF)
    expect(sms.calls).toEqual(['ask'])
    fireEvent.click(screen.getByText('설정 열기'))
    await waitFor(() => expect(port.opened).toEqual(['app']))
  })
})
