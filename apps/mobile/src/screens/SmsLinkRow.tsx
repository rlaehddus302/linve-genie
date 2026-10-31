// "휴대폰 알림 받기" 안의 "문자 연동" 칸 하나 (SMS4, D-SMS4-01~).
// 켜기 → 문자 권한 묻기 → 켬(최근 24시간 문자부터 따라잡기). 채팅 문자(RCS)는 문자함에 없어 알림 읽기로 받는다 — 알림 읽기가 꺼져 있으면 안내.
// LIVEGENIE_SMS=off 빌드(production.tsx가 sms를 뗀다)·아이폰·옛 모듈이면 칸을 그리지 않는다.
import { useEffect, useState } from 'react'
import type { PhoneNoticePort, PhoneSmsState } from '../native/notice.ts'
import { BigButton, Body, Hint, Notice, Row, Tag } from '../ui/parts.tsx'

export const SMS_LINK_TITLE = '문자 연동'
export const SMS_LINK_INTRO = '손님 문자를 휴대폰 문자함에서 바로 받아요.'
export const SMS_LINK_NOTICE_FIRST = '위에서 먼저 켜 주세요.'
export const SMS_LINK_PERMISSION_OFF = '문자 권한이 꺼져 있어요. 설정에서 문자를 허용해 주세요.'
export const SMS_LINK_ON = '문자를 바로 받고 있어요'
export const SMS_LINK_CHAT = '채팅 문자는 알림 읽기를 켜야 받아요.'

/** 칸의 상태 한 줄 */
export function smsLinkLine(state: PhoneSmsState, noticeOn: boolean): string {
  if (!state.enabled) return SMS_LINK_INTRO
  if (!noticeOn) return SMS_LINK_NOTICE_FIRST
  if (state.permission !== 'granted') return SMS_LINK_PERMISSION_OFF
  return SMS_LINK_ON
}

export function SmsLinkRow({ port, noticeOn, accessNeeded }: { readonly port: PhoneNoticePort; readonly noticeOn: boolean; readonly accessNeeded: boolean }) {
  const sms = port.sms ?? null
  const [state, setState] = useState<PhoneSmsState | null>(null)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    if (sms === null) return
    let alive = true
    void sms.getState().then(
      (next) => {
        if (alive) setState(next)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [sms, noticeOn])

  if (sms === null || state === null || !state.available) return null

  const run = async (work: () => Promise<PhoneSmsState>) => {
    if (busy) return
    setBusy(true)
    try {
      setState(await work())
    } catch {
      // 상태를 다시 읽는다 (가짜 성공으로 바꾸지 않는다)
      setState(await sms.getState().catch(() => state))
    } finally {
      setBusy(false)
    }
  }

  const turnOn = () =>
    run(async () => {
      const answer = await sms.requestPermission()
      setAsked(true)
      return answer.permission === 'granted' ? sms.setEnabled(true) : answer
    })

  const on = state.enabled
  // 켜 두었는데 권한이 꺼졌거나, 방금 물었는데 허용하지 않았으면 설정 안내
  const permissionOff = state.permission !== 'granted' && (on || asked)
  return (
    <>
      <Row wrap>
        <Body bold>{SMS_LINK_TITLE}</Body>
        <Tag tone={state.active ? 'success' : on ? 'warning' : 'info'}>{on ? '켜짐' : '꺼짐'}</Tag>
        <Body>{smsLinkLine(state, noticeOn)}</Body>
      </Row>
      {permissionOff ? (
        <Notice tone="warning" alert>
          {SMS_LINK_PERMISSION_OFF}
        </Notice>
      ) : null}
      {permissionOff ? <BigButton small label="설정 열기" disabled={busy} onPress={() => void port.openSettings('app')} /> : null}
      {state.active && accessNeeded ? <Hint>{SMS_LINK_CHAT}</Hint> : null}
      {state.active && accessNeeded ? <BigButton small label="알림 읽기 켜러 가기" disabled={busy} onPress={() => void port.openSettings('notificationAccess')} /> : null}
      {on ? (
        <BigButton small label="문자 연동 끄기" disabled={busy} onPress={() => void run(() => sms.setEnabled(false))} />
      ) : (
        <BigButton small label="문자 연동 켜기" disabled={busy || !noticeOn} onPress={() => void turnOn()} />
      )}
    </>
  )
}
