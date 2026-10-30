// 앱 설정의 "휴대폰 알림 받기" 칸 (SMS3 ORD-13 C-01·C-02, D-SMS3-02·04·14, AC-SMS3-29).
// - 켜기: 로그인한 판매자 세션으로 받기 토큰을 만들고(POST /api/inbox/token) 기기 보안 저장소에 넣은 뒤 받기를 켠다.
//   서버에 이미 켜진 토큰이 있으면 먼저 묻는다 — 새로 만들면 전에 쓰던 휴대폰·단축어는 더 이상 보내지 못한다.
// - 안드로이드에서 알림 읽기가 아직이면 안내 한 장: "문자와 은행 앱 알림만 라이브지니로 보내요. 다른 앱 알림은 읽지 않아요." + "알림 읽기 켜러 가기".
//   켠 뒤에도 권한이 꺼져 있으면 칸에 "알림 읽기가 꺼져 있어요".
// - 아이폰: 다른 앱 알림을 읽을 수 없다 — 단축어로 문자만 보낸다는 안내와 "단축어 앱 열기".
// - 토큰 원문은 화면에 보이지 않는다(앱이 바로 넣는다). 서버가 토큰을 받지 않으면(401) "받기 토큰을 다시 넣어 주세요" + "토큰 다시 받기".
import { useCallback, useEffect, useState } from 'react'
import { apiConfig } from '../api/config.ts'
import { get, isApiError, post } from '../api/client.ts'
import { noticeModule, type PhoneNoticeState } from '../native/notice.ts'
import { SERVICE_NAME } from '../lib/words.ts'
import { BigButton, Body, Card, Hint, Notice, Row, SectionTitle, Tag } from '../ui/parts.tsx'

export const PHONE_NOTICE_TITLE = '휴대폰 알림 받기'
export const PHONE_NOTICE_INTRO = `손님 문자는 문자찜으로, 은행 입금 알림은 입금 확인으로 ${SERVICE_NAME}가 자동으로 받아요.`
/** 권한 안내 한 장 (AC-SMS3-29 그대로) */
export const PHONE_NOTICE_SHEET = `문자와 은행 앱 알림만 ${SERVICE_NAME}로 보내요. 다른 앱 알림은 읽지 않아요.`
export const PHONE_NOTICE_GO = '알림 읽기 켜러 가기'
export const PHONE_NOTICE_ACCESS_OFF = '알림 읽기가 꺼져 있어요'
export const PHONE_NOTICE_SETTINGS_FAILED = `설정을 열지 못했어요. 휴대폰 설정 → 알림 → 기기 및 앱 알림(알림 읽기)에서 ${SERVICE_NAME}를 켜 주세요.`
export const PHONE_NOTICE_TOKEN_AGAIN = '받기 토큰을 다시 넣어 주세요'
export const PHONE_NOTICE_RENEW_QUESTION = '전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요. 이 휴대폰으로 받을까요?'
export const PHONE_NOTICE_UNAVAILABLE = `이 휴대폰에서는 쓸 수 없어요. ${SERVICE_NAME} 앱을 새로 받아 주세요.`
export const PHONE_NOTICE_IPHONE = '아이폰은 다른 앱 알림을 읽을 수 없어요. 단축어로 손님 문자와 은행 문자만 보낼 수 있어요(은행 앱 알림은 받을 수 없어요).'
export const PHONE_NOTICE_SHORTCUT_GUIDE = `단축어 앱 → 자동화 → 새로 만들기 → "메시지" → "즉시 실행" → 동작에 "${SERVICE_NAME}에 문자 보내기"를 넣고 보낸 사람·내용을 이어 주세요.`

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
  if (state.pending > 0) return `${String(state.pending)}건을 보내는 중이에요`
  return state.access === 'shortcut' ? '단축어로 받은 문자를 보내고 있어요' : '문자와 은행 앱 알림을 보내고 있어요'
}

function deviceName(state: PhoneNoticeState): string {
  return state.platform === 'ios' ? `아이폰 ${SERVICE_NAME} 앱` : `안드로이드 ${SERVICE_NAME} 앱`
}

export function PhoneNoticeCard() {
  const port = noticeModule()
  const [state, setState] = useState<PhoneNoticeState | null>(null)
  const [server, setServer] = useState<InboxServerView | null>(null)
  const [sheet, setSheet] = useState(false)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const loadServer = useCallback(async () => {
    try {
      const { inbox } = await get<{ inbox: InboxServerView }>('/api/inbox/settings')
      setServer(inbox)
    } catch {
      setServer(null)
    }
  }, [])

  useEffect(() => {
    if (port === null) return
    let alive = true
    void port.getState().then((next) => {
      if (alive) setState(next)
    })
    const off = port.addStateListener((next) => setState(next))
    void loadServer()
    return () => {
      alive = false
      off()
    }
  }, [port, loadServer])

  if (port === null) {
    return (
      <Card label={PHONE_NOTICE_TITLE}>
        <SectionTitle>{PHONE_NOTICE_TITLE}</SectionTitle>
        <Hint>{PHONE_NOTICE_UNAVAILABLE}</Hint>
      </Card>
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

  return (
    <Card label={PHONE_NOTICE_TITLE}>
      <SectionTitle>{PHONE_NOTICE_TITLE}</SectionTitle>
      <Body>{PHONE_NOTICE_INTRO}</Body>
      {sheet ? (
        <Card label="알림 읽기 안내">
          <Body bold>{PHONE_NOTICE_SHEET}</Body>
          <BigButton primary label={PHONE_NOTICE_GO} disabled={busy} onPress={() => void openAccess()} />
          <BigButton small label="나중에 할게요" onPress={() => setSheet(false)} />
        </Card>
      ) : null}
      {state === null ? (
        <Hint>불러오는 중…</Hint>
      ) : (
        <Row wrap>
          <Tag tone={on && !accessOff && !tokenBad ? 'success' : on ? 'warning' : 'info'}>{on ? '켜짐' : '꺼짐'}</Tag>
          <Body>{phoneNoticeLine(state)}</Body>
        </Row>
      )}
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
      {tokenBad ? <BigButton label="토큰 다시 받기" disabled={busy} onPress={() => (server?.enabled === true ? setAsk(true) : void connect())} /> : null}
      {ask ? (
        <Card label="토큰을 새로 만들까요?">
          <Body bold>{PHONE_NOTICE_RENEW_QUESTION}</Body>
          <BigButton primary label="이 휴대폰으로 받기" disabled={busy} onPress={() => void connect()} />
          <BigButton small label="그대로 두기" onPress={() => setAsk(false)} />
        </Card>
      ) : null}
      {state !== null ? on ? <BigButton label="끄기" disabled={busy} onPress={() => void turnOff()} /> : <BigButton primary label="켜기" disabled={busy} onPress={turnOn} /> : null}
      {ios ? (
        <>
          <Hint>{PHONE_NOTICE_IPHONE}</Hint>
          <Hint>{PHONE_NOTICE_SHORTCUT_GUIDE}</Hint>
          <BigButton small label="단축어 앱 열기" disabled={busy} onPress={() => void port.openSettings('shortcuts')} />
        </>
      ) : null}
      {problem !== null ? (
        <Notice tone="danger" alert>
          {problem}
        </Notice>
      ) : null}
    </Card>
  )
}
