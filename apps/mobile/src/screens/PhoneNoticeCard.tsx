// 앱 설정의 "휴대폰 알림 받기" 칸 (SMS3 ORD-13 C-01·C-02, D-SMS3-02·04·14, AC-SMS3-29).
// - 켜기: 로그인한 판매자 세션으로 받기 토큰을 만들고(POST /api/inbox/token) 기기 보안 저장소에 넣은 뒤 받기를 켠다.
//   서버에 이미 켜진 토큰이 있으면 먼저 묻는다 — 새로 만들면 전에 쓰던 휴대폰·단축어는 더 이상 보내지 못한다.
// - 안드로이드에서 알림 읽기가 아직이면 안내 한 장: "문자와 은행 앱 알림만 라이브지니로 보내요. 다른 앱 알림은 읽지 않아요." + "알림 읽기 켜러 가기".
//   켠 뒤에도 권한이 꺼져 있으면 칸에 "알림 읽기가 꺼져 있어요".
// - 아이폰: 다른 앱 알림을 읽을 수 없다 — 단축어 자동화가 앱 동작 "라이브지니에 문자 보내기"(App Intent)를 부른다(D-REAL-01, D-SMS3-23을 바꿈).
//   "켜기"로 앱이 받기 열쇠를 넣고, 판매자는 단축어 앱에서 자동화를 한 번 만든다(받는 주소·열쇠를 옮겨 적지 않는다).
//   웹 설정의 "URL 콘텐츠 가져오기" 안내는 웹에 그대로 둔다(앱 없이 쓰는 사람).
// - 토큰 원문은 화면에 보이지 않는다(앱이 바로 넣는다). 서버가 토큰을 받지 않으면(401) "받기 열쇠를 다시 넣어 주세요" + "받기 열쇠 다시 받기"(D-SMS3-39).
import { useCallback, useEffect, useState } from 'react'
import { apiConfig } from '../api/config.ts'
import { isApiError, post } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { noticeModule, type PhoneNoticeState } from '../native/notice.ts'
import { SERVICE_NAME } from '../lib/words.ts'
import { BigButton, Body, Card, Hint, Notice, Row, Tag } from '../ui/parts.tsx'
import { SettingsGroup } from './settings/Group.tsx'
import { SmsLinkRow } from './SmsLinkRow.tsx'
import { Late } from '../ui/late.tsx'

export const PHONE_NOTICE_TITLE = '휴대폰 알림 받기'
export const PHONE_NOTICE_INTRO = `손님 문자는 문자찜으로, 은행 입금 알림은 입금 확인으로 ${SERVICE_NAME}가 자동으로 받아요.`
/** 권한 안내 한 장 (AC-SMS3-29 그대로) */
export const PHONE_NOTICE_SHEET = `문자와 은행 앱 알림만 ${SERVICE_NAME}로 보내요. 다른 앱 알림은 읽지 않아요.`
export const PHONE_NOTICE_GO = '알림 읽기 켜러 가기'
export const PHONE_NOTICE_ACCESS_OFF = '알림 읽기가 꺼져 있어요'
export const PHONE_NOTICE_SETTINGS_FAILED = `설정을 열지 못했어요. 휴대폰 설정 → 알림 → 기기 및 앱 알림(알림 읽기)에서 ${SERVICE_NAME}를 켜 주세요.`
/** D-SMS3-39: 판매자에게 보이는 말은 "토큰" 대신 "받기 열쇠" — @livejjim/mobile-notice NOTICE_TOKEN_AGAIN과 같은 글 */
export const PHONE_NOTICE_TOKEN_AGAIN = '받기 열쇠를 다시 넣어 주세요'
export const PHONE_NOTICE_TOKEN_RENEW = '받기 열쇠 다시 받기'
export const PHONE_NOTICE_RENEW_TITLE = '받기 열쇠를 새로 만들까요?'
/** 403 INBOX_OFF — 웹 설정에서 받기를 껐다. 토큰·모아 둔 알림은 그대로 (ORD-13 받기 상태, D-SMS3-27 — @livejjim/mobile-notice NOTICE_INBOX_OFF와 같은 글) */
export const PHONE_NOTICE_INBOX_OFF = '웹 설정에서 휴대폰 알림 받기가 꺼져 있어요. 켜면 모아 둔 알림을 보내요'
/** 대기열이 넘쳐 버린 알림 (D-SMS3-28 — @livejjim/mobile-notice NOTICE_DROPPED_TEMPLATE와 같은 글) */
export function phoneNoticeDroppedLine(state: Pick<PhoneNoticeState, 'dropped'>): string | null {
  const dropped = state.dropped ?? 0
  return dropped > 0 ? `보내지 못하고 버린 알림이 ${String(dropped)}건 있어요. 은행 앱에서 입금을 확인해 주세요` : null
}
export const PHONE_NOTICE_RENEW_QUESTION = '전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요. 이 휴대폰으로 받을까요?'
export const PHONE_NOTICE_UNAVAILABLE = `이 휴대폰에서는 쓸 수 없어요. ${SERVICE_NAME} 앱을 새로 받아 주세요.`
export const PHONE_NOTICE_IPHONE = '아이폰은 다른 앱 알림을 읽을 수 없어요. 단축어로 손님 문자와 은행 문자만 보낼 수 있어요(은행 앱 알림은 받을 수 없어요).'
/** 아이폰 단축어 안내 — 앱 동작 하나 (D-REAL-01). 앱이 받기 열쇠를 넣으므로 주소·열쇠를 옮겨 적지 않는다 */
export const PHONE_NOTICE_SHORTCUT_GUIDE = `[켜기]를 누른 뒤 단축어 앱에서 자동화를 한 번만 만들면, 받은 문자가 ${SERVICE_NAME}로 가요.`
/** 앱 동작 이름 (packages/mobile-notice/ios/NoticeIntents.swift SendNoticeIntent.title과 같은 글) */
export const PHONE_NOTICE_INTENT_NAME = `${SERVICE_NAME}에 문자 보내기`
export const PHONE_NOTICE_SHORTCUT_STEPS: readonly string[] = [
  '단축어 앱 → 아래 "자동화" → 오른쪽 위 + → "메시지"를 고르세요.',
  '보낸 사람·내용 조건은 비워 두고 "즉시 실행"을 고른 뒤 "다음"을 누르세요.',
  `"새로운 빈 자동화" → "동작 추가"에서 ${SERVICE_NAME}를 찾아 "${SERVICE_NAME}에 문자 보내기"를 고르세요.`,
  '"보낸 사람" 칸을 눌러 "단축어 입력"을 고르고, 그 글자를 한 번 더 눌러 "보낸 사람"으로 바꾸세요. "내용" 칸도 같은 방법으로 "내용"을 고르세요.',
  '"완료"를 누르고 손님 문자 하나로 시험해 보세요. 라이브 화면에 문자찜이 들어오면 잘 된 거예요.',
]

/** 서버의 받기 설정 (웹 설정과 같은 GET /api/inbox/settings) */
interface InboxServerView {
  readonly enabled: boolean
  readonly lastReceivedAt: string | null
}

/** 칸의 상태 한 줄 */
export function phoneNoticeLine(state: PhoneNoticeState): string {
  if (!state.enabled) return '꺼져 있어요'
  if (state.tokenRejected || !state.hasToken) return PHONE_NOTICE_TOKEN_AGAIN
  if (state.access === 'needed') return PHONE_NOTICE_ACCESS_OFF
  if (state.inboxOff === true) return PHONE_NOTICE_INBOX_OFF
  if (state.pending > 0) return `${String(state.pending)}건을 보내는 중이에요`
  return state.access === 'shortcut' ? '단축어로 받은 문자를 보내고 있어요' : '문자와 은행 앱 알림을 보내고 있어요'
}

function deviceName(state: PhoneNoticeState): string {
  return state.platform === 'ios' ? `아이폰 ${SERVICE_NAME} 앱` : `안드로이드 ${SERVICE_NAME} 앱`
}

export function PhoneNoticeCard() {
  const port = noticeModule()
  const [state, setState] = useState<PhoneNoticeState | null>(null)
  // 서버 쪽 받기 상태는 기억해 둔 것을 바로 쓰고 뒤에서 다시 받는다 (D-UX4-77) — 모르면 null
  const inbox = useCachedGet<{ inbox: InboxServerView }>(port === null ? null : '/api/inbox/settings')
  const server = inbox.data?.inbox ?? null
  const reloadInbox = inbox.reload
  const [sheet, setSheet] = useState(false)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const loadServer = useCallback(() => reloadInbox(), [reloadInbox])

  useEffect(() => {
    if (port === null) return
    let alive = true
    void port.getState().then((next) => {
      if (alive) setState(next)
    })
    const off = port.addStateListener((next) => setState(next))
    return () => {
      alive = false
      off()
    }
  }, [port])

  if (port === null) {
    return (
      <SettingsGroup title={PHONE_NOTICE_TITLE}>
        <Hint>{PHONE_NOTICE_UNAVAILABLE}</Hint>
      </SettingsGroup>
    )
  }

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } catch (caught) {
      setProblem(isApiError(caught) ? caught.message : '켜지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /** 토큰을 새로 받아 넣고 켠다 (서버의 옛 토큰은 바로 무효) */
  const connect = () =>
    run(async () => {
      setAsk(false)
      const current = state ?? (await port.getState())
      const { token } = await post<{ token: string }>('/api/inbox/token', {})
      await port.setToken({ token, serverUrl: apiConfig().baseUrl, deviceName: deviceName(current) })
      const next = await port.start()
      setState(next)
      if (next.access === 'needed') setSheet(true)
      void loadServer()
    })

  const turnOn = () => {
    if (state !== null && state.hasToken && !state.tokenRejected) {
      // 토큰은 그대로 — 받기만 다시 켠다
      void run(async () => {
        const next = await port.start()
        setState(next)
        if (next.access === 'needed') setSheet(true)
      })
      return
    }
    if (server?.enabled === true) setAsk(true)
    else void connect()
  }

  const turnOff = () =>
    run(async () => {
      setState(await port.stop())
    })

  const openAccess = () =>
    run(async () => {
      const opened = await port.openSettings('notificationAccess')
      if (!opened) setProblem(PHONE_NOTICE_SETTINGS_FAILED)
      else setSheet(false)
    })

  const ios = state?.platform === 'ios' || state?.access === 'shortcut'
  const on = state?.enabled === true
  const accessOff = on && state?.access === 'needed'
  const tokenBad = on && state !== null && (state.tokenRejected || !state.hasToken)
  // 웹 설정에서 받기가 꺼짐 — 토큰은 그대로라 웹에서 다시 켜면 이어진다 (D-SMS3-27)
  const serverOff = on && !tokenBad && state?.inboxOff === true
  const droppedLine = state === null ? null : phoneNoticeDroppedLine(state)

  return (
    // 설정 화면의 다른 묶음과 같은 흰 카드 · 작은 회색 이름 (D-UX3-96)
    <SettingsGroup title={PHONE_NOTICE_TITLE}>
      <Body>{PHONE_NOTICE_INTRO}</Body>
      {sheet ? (
        <Card label="알림 읽기 안내">
          <Body bold>{PHONE_NOTICE_SHEET}</Body>
          {/* 단추 둘은 좌우로 — 부정 왼쪽, 긍정 오른쪽 (D-UX4-01, D-UX3-96) */}
          <Row>
            <BigButton small label="나중에 할게요" onPress={() => setSheet(false)} />
            <BigButton primary label={PHONE_NOTICE_GO} disabled={busy} onPress={() => void openAccess()} />
          </Row>
        </Card>
      ) : null}
      {/* 불러오는 동안은 비워 둔다 (D-UX4-83) */}
      {/* 받은 뒤에야 생기는 상태 줄·단추는 부드럽게 (D-UX4-112) */}
      <Late>
        {state === null ? null : (
          <Row wrap>
            <Tag tone={on && !accessOff && !tokenBad && !serverOff ? 'success' : on ? 'warning' : 'info'}>{on ? '켜짐' : '꺼짐'}</Tag>
            <Body>{phoneNoticeLine(state)}</Body>
          </Row>
        )}
      </Late>
      {accessOff && !sheet ? (
        <Notice tone="warning" alert>
          {PHONE_NOTICE_ACCESS_OFF}
        </Notice>
      ) : null}
      {accessOff && !sheet ? <BigButton label={PHONE_NOTICE_GO} disabled={busy} onPress={() => void openAccess()} /> : null}
      {tokenBad ? (
        <Notice tone="warning" alert>
          {PHONE_NOTICE_TOKEN_AGAIN}
        </Notice>
      ) : null}
      {droppedLine !== null ? (
        <Notice tone="danger" alert>
          {droppedLine}
        </Notice>
      ) : null}
      {tokenBad ? <BigButton label={PHONE_NOTICE_TOKEN_RENEW} disabled={busy} onPress={() => (server?.enabled === true ? setAsk(true) : void connect())} /> : null}
      {ask ? (
        <Card label={PHONE_NOTICE_RENEW_TITLE}>
          <Body bold>{PHONE_NOTICE_RENEW_QUESTION}</Body>
          <Row>
            <BigButton small label="그대로 두기" onPress={() => setAsk(false)} />
            <BigButton primary label="이 휴대폰으로 받기" disabled={busy} onPress={() => void connect()} />
          </Row>
        </Card>
      ) : null}
      <Late>
        {state !== null ? on ? <BigButton label="알림 받기 끄기" disabled={busy} onPress={() => void turnOff()} /> : <BigButton primary label="켜기" disabled={busy} onPress={turnOn} /> : null}
      </Late>
      <Late>
        {state !== null && !ios ? <SmsLinkRow port={port} noticeOn={on && !tokenBad} accessNeeded={state.access === 'needed'} /> : null}
      </Late>
      {ios ? (
        <>
          <Hint>{PHONE_NOTICE_IPHONE}</Hint>
          <Hint>{PHONE_NOTICE_SHORTCUT_GUIDE}</Hint>
          {PHONE_NOTICE_SHORTCUT_STEPS.map((step, index) => (
            <Hint key={step}>{`${String(index + 1)}. ${step}`}</Hint>
          ))}
          <BigButton small label="단축어 앱 열기" disabled={busy} onPress={() => void port.openSettings('shortcuts')} />
        </>
      ) : null}
      {problem !== null ? (
        <Notice tone="danger" alert>
          {problem}
        </Notice>
      ) : null}
    </SettingsGroup>
  )
}
