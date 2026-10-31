// 앱 설정의 "휴대폰 알림 받기" 칸 (SMS3 ORD-13 C-01·C-02, D-SMS3-02·04·14, AC-SMS3-29).
// - 켜기: 로그인한 판매자 세션으로 받기 토큰을 만들고(POST /api/inbox/token) 기기 보안 저장소에 넣은 뒤 받기를 켠다.
//   서버에 이미 켜진 토큰이 있으면 먼저 묻는다 — 새로 만들면 전에 쓰던 휴대폰·단축어는 더 이상 보내지 못한다.
// - 안드로이드에서 알림 읽기가 아직이면 안내 한 장: "문자와 은행 앱 알림만 라이브지니로 보내요. 다른 앱 알림은 읽지 않아요." + "알림 읽기 켜러 가기".
//   켠 뒤에도 권한이 꺼져 있으면 칸에 "알림 읽기가 꺼져 있어요".
// - 아이폰: 다른 앱 알림을 읽을 수 없다 — 단축어로 문자만 보낸다는 안내와 "단축어 앱 열기". 안내는 웹 설정의 한 가지
//   ("URL 콘텐츠 가져오기"에 받기 토큰 붙여 넣기)뿐이다(D-SMS3-23). 앱의 단축어 동작은 권하지 않고, 아이폰에서는 "켜기"를 두지 않는다
//   (앱에서 켜면 토큰이 새로 만들어져 판매자가 단축어에 넣어 둔 토큰이 멈춘다). 이미 켜져 있으면 "끄기"만.
// - 토큰 원문은 화면에 보이지 않는다(앱이 바로 넣는다). 서버가 토큰을 받지 않으면(401) "받기 열쇠를 다시 넣어 주세요" + "받기 열쇠 다시 받기"(D-SMS3-39).
import { useCallback, useEffect, useState } from 'react'
import { apiConfig } from '../api/config.ts'
import { get, isApiError, post } from '../api/client.ts'
import { noticeModule, type PhoneNoticeState } from '../native/notice.ts'
import { SERVICE_NAME } from '../lib/words.ts'
import { BigButton, Body, Card, Code, Hint, Notice, Row, SectionTitle, Tag } from '../ui/parts.tsx'

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
/**
 * 아이폰 단축어 안내 — 웹 설정의 한 가지만 (D-SMS3-23). 컴퓨터에서 복사한 글은 아이폰에 붙여 넣을 수 없으니
 * 아이폰 사파리로 웹 설정을 열어 토큰을 만들고 받는 주소·헤더 값을 복사해 붙여 넣는다 (UX-SMS3-002 — 웹 INBOX_IPHONE_FIRST와 같은 뜻)
 */
export const PHONE_NOTICE_SHORTCUT_GUIDE = `아이폰 사파리로 ${SERVICE_NAME} 웹 설정 → "휴대폰 알림 받기"를 열어 받기 열쇠를 만들고, 받는 주소와 헤더 값을 복사해 붙여 넣으세요. 컴퓨터에서 복사한 글은 아이폰에 붙여 넣을 수 없어요. 그다음 아래 순서대로 "URL 콘텐츠 가져오기" 단축어를 만들어 주세요.`
/** 값 글꼴 설명 (UX-SMS3-001 — 따옴표를 같이 적지 않게) */
export const PHONE_NOTICE_VALUE_NOTE = '회색 상자 안의 글자만 그대로 적어 주세요(따옴표는 적지 않아요). 길게 누르면 복사할 수 있어요.'

/** 단축어가 보낼 받는 주소 (웹 설정의 받는 주소와 같다) */
export function phoneNoticeAddress(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/api/inbox/messages`
}
/**
 * 단축어 만들기 순서 — 웹 설정 안내(apps/web/src/lib/inbox.ts INBOX_SHORTCUT_STEPS)와 같은 글 (D-SMS3-23, SA-SMS3-004).
 * 기기 입구(ORD-13 C-04)는 JSON `{ device, messages: [{ id, channel, from, text, receivedAt }] }`만 받는다. `…`로 감싼 글은 단축어에 그대로 넣는 값.
 */
export const PHONE_NOTICE_SHORTCUT_STEPS: readonly string[] = [
  '단축어 앱 → 자동화 → 새로 만들기 → "메시지"를 고르세요. 보낸 사람·내용 조건은 비워 두고 "즉시 실행"을 켜세요.',
  `동작에 "URL 콘텐츠 가져오기"를 넣고, URL에 ${SERVICE_NAME} 설정 "휴대폰 알림 받기"의 받는 주소를 넣으세요.`,
  '동작을 펼쳐 방법을 `POST`로 바꾸세요.',
  '헤더에 하나를 더하세요. 키는 `Authorization`, 값은 `Bearer` 뒤에 한 칸 띄고 설정에서 만든 받기 열쇠를 붙여 넣으세요.',
  '요청 본문을 `JSON`으로 고르고 칸 두 개를 더하세요. `device`(텍스트) = 휴대폰 이름(예: 내 아이폰), `messages`(배열).',
  '`messages` 안에 "사전" 하나를 더하고, 그 안에 칸 다섯 개를 넣으세요.',
  '`id`(텍스트) = "현재 날짜"(날짜 형식 "사용자 지정" `yyyyMMddHHmmss` — 초까지)와 단축어 입력의 "보낸 사람"을 이어 붙인 글 — 문자마다 달라야 해요.',
  '`id`에 고정 글(예: 내 문자)을 넣지 마세요. 그러면 하루 동안 같은 문자로 보고 그 뒤 손님 문자를 하나도 받지 못해요.',
  '`channel`(텍스트) = `SMS`',
  '`from`(텍스트) = 단축어 입력의 "보낸 사람"',
  '`text`(텍스트) = 단축어 입력의 "내용"',
  '`receivedAt`(텍스트) = 현재 날짜 (날짜 형식은 "ISO 8601")',
  '칸 이름은 위 영어 글자를 대소문자까지 똑같이 적어 주세요. 하나라도 다르면 문자를 하나도 받지 못해요.',
  '다 만들면 손님 문자 하나로 시험해 보세요. 설정 "휴대폰 알림 받기"의 "마지막으로 받은 시각"이 바뀌면 잘 된 거예요.',
]

/** 안내 한 단계를 글·값 조각으로 (`…`로 감싼 조각은 단축어에 그대로 넣는 값) */
export function shortcutStepParts(step: string): { readonly text: string; readonly value: boolean }[] {
  return step
    .split('`')
    .map((text, index) => ({ text, value: index % 2 === 1 }))
    .filter((part) => part.text !== '')
}

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
  // 웹 설정에서 받기가 꺼짐 — 토큰은 그대로라 웹에서 다시 켜면 이어진다 (D-SMS3-27)
  const serverOff = on && !tokenBad && state?.inboxOff === true
  const droppedLine = state === null ? null : phoneNoticeDroppedLine(state)

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
          <Tag tone={on && !accessOff && !tokenBad && !serverOff ? 'success' : on ? 'warning' : 'info'}>{on ? '켜짐' : '꺼짐'}</Tag>
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
      {droppedLine !== null ? (
        <Notice tone="danger" alert>
          {droppedLine}
        </Notice>
      ) : null}
      {tokenBad ? <BigButton label={PHONE_NOTICE_TOKEN_RENEW} disabled={busy} onPress={() => (server?.enabled === true ? setAsk(true) : void connect())} /> : null}
      {ask ? (
        <Card label={PHONE_NOTICE_RENEW_TITLE}>
          <Body bold>{PHONE_NOTICE_RENEW_QUESTION}</Body>
          <BigButton primary label="이 휴대폰으로 받기" disabled={busy} onPress={() => void connect()} />
          <BigButton small label="그대로 두기" onPress={() => setAsk(false)} />
        </Card>
      ) : null}
      {state !== null ? on ? <BigButton label="끄기" disabled={busy} onPress={() => void turnOff()} /> : ios ? null : <BigButton primary label="켜기" disabled={busy} onPress={turnOn} /> : null}
      {ios ? (
        <>
          <Hint>{PHONE_NOTICE_IPHONE}</Hint>
          <Hint>{PHONE_NOTICE_SHORTCUT_GUIDE}</Hint>
          <Hint>
            받는 주소: <Code label="받는 주소">{phoneNoticeAddress(apiConfig().baseUrl)}</Code>
          </Hint>
          <Hint>{PHONE_NOTICE_VALUE_NOTE}</Hint>
          {PHONE_NOTICE_SHORTCUT_STEPS.map((step, index) => (
            <Hint key={step}>
              {`${String(index + 1)}. `}
              {/* 값은 따옴표 없이 회색 상자 (UX-SMS3-001) — 따옴표까지 적으면 문자를 하나도 받지 못한다 */}
              {shortcutStepParts(step).map((part, at) => (part.value ? <Code key={at}>{part.text}</Code> : part.text))}
            </Hint>
          ))}
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
