// QL2 품질 2회차 — 화면 낱말·작은 부품 (AC-QL2-05·21·25·40·41·43, D-QL2-02·05·07·09).
// 알림 띠 펼치기 단추 이름, AI 제안 고지·유튜브 제외 한 줄, 아이폰·아이패드 판별, 출력 멈춤 알림 문장, 보류 찜 시간 낱말,
// ("'이 기기에서 출력'을 눌러" 문장 검사는 ql2-words.node.test.ts)
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AlertStrip, alertToggleWord } from '../src/components/AlertStrip.tsx'
import { AI_ASSIST_YOUTUBE } from '../src/components/PolicyPages.tsx'
import { ASSIST_NOTICE, ASSIST_YOUTUBE_EXCLUDED, showsYoutubeExcluded } from '../src/lib/assist.ts'
import { defaultDeviceName } from '../src/lib/device.ts'
import {
  AUTO_RECONNECT_GAVE_UP,
  NO_STATION_PILING,
  autoReconnectingMessage,
  cancelJobQuestion,
  isIphone,
  pauseAlertMessage,
} from '../src/lib/print-words.ts'
import { agoWord, pendingMeaning } from '../src/lib/words.ts'

afterEach(cleanup)

const COUNTS = { conflict: 0, cancelRequest: 0, succession: 0, pending: 0, attention: 0 }

describe('알림 띠 펼치기 단추 (AC-QL2-05, D-QL2-02 (1))', () => {
  it('이름: 세는 알림 n ≥ 1이면 "알림 n 펼치기/접기", 0이면 "알림 펼치기/접기"', () => {
    expect(alertToggleWord(0, false)).toBe('알림 펼치기')
    expect(alertToggleWord(0, true)).toBe('알림 접기')
    expect(alertToggleWord(2, false)).toBe('알림 2 펼치기')
    expect(alertToggleWord(2, true)).toBe('알림 2 접기')
  })

  it('알림이 하나도 없으면 "알림 없음"이고 펼치기 단추가 없다', () => {
    render(<AlertStrip counts={COUNTS} onOpen={() => {}} onToggle={() => {}} />)
    expect(screen.getByText('알림 없음')).toBeDefined()
    expect(screen.queryByRole('button', { name: /펼치기/ })).toBeNull()
  })

  it('출력 기기 항목 하나뿐(세는 알림 0) → "알림 펼치기"(aria-expanded=false, aria-controls=alerts) — 펼치면 "알림 접기"', () => {
    const { rerender } = render(
      <AlertStrip leads={[{ key: 'print-station', text: NO_STATION_PILING, soft: true, uncounted: true, onClick: () => {} }]} counts={COUNTS} onOpen={() => {}} onToggle={() => {}} />,
    )
    const toggle = screen.getByRole('button', { name: '알림 펼치기' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('alerts')
    // 펼치기 단추는 "알림" 영역 밖 (지금 그대로)
    expect(within(screen.getByRole('region', { name: '알림' })).queryByRole('button', { name: '알림 펼치기' })).toBeNull()
    rerender(
      <AlertStrip leads={[{ key: 'print-station', text: NO_STATION_PILING, soft: true, uncounted: true, onClick: () => {} }]} counts={COUNTS} onOpen={() => {}} expanded onToggle={() => {}} />,
    )
    const open = screen.getByRole('button', { name: '알림 접기' })
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: '알림' }).textContent).toContain(NO_STATION_PILING)
  })

  it('결과 문장(누르는 곳 아님)만 있어도 "알림 펼치기"', () => {
    render(<AlertStrip leads={[{ key: 'paste', text: '붙여 넣은 댓글 3개를 넣었어요.' }]} counts={COUNTS} onOpen={() => {}} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: '알림 펼치기' })).toBeDefined()
  })

  it('세는 알림(충돌 1·출력 멈춤 1) + 출력 기기 끊김 항목 → "알림 2 펼치기"(출력 기기 항목은 세지 않음)', () => {
    let toggled = 0
    render(
      <AlertStrip
        leads={[{ key: 'print-station', text: '출력 기기 끊김', soft: true, uncounted: true, onClick: () => {} }]}
        counts={{ ...COUNTS, conflict: 1 }}
        print={{ pause: '프린터 연결이 끊겼어요.', discard: 0 }}
        onOpen={() => {}}
        onToggle={() => {
          toggled++
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '알림 2 펼치기' }))
    expect(toggled).toBe(1)
  })

  it('PC처럼 onToggle이 없으면 단추가 없다', () => {
    render(<AlertStrip counts={{ ...COUNTS, conflict: 1 }} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: /펼치기/ })).toBeNull()
  })
})

describe('AI 제안 문장 (AC-QL2-20·21·22, D-QL2-05)', () => {
  it('설정 고지 상수 글자 그대로', () => {
    expect(ASSIST_NOTICE).toBe('확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 유튜브 채팅은 보내지 않아요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.')
    expect(AI_ASSIST_YOUTUBE).toBe('유튜브에서 받은 채팅 글은 보내지 않아요.')
    expect(ASSIST_YOUTUBE_EXCLUDED).toBe('유튜브 채팅은 AI에 보내지 않아요. 규칙 제안만 보여 드려요.')
  })

  it('확인 필요 목록 위 한 줄: 켜져 있고 유튜브로 뺀 항목이 하나라도 있을 때만', () => {
    const youtube = { excluded: 'YOUTUBE_POLICY' }
    const other = { excluded: null }
    expect(showsYoutubeExcluded(true, [other, youtube])).toBe(true)
    expect(showsYoutubeExcluded(false, [youtube])).toBe(false)
    expect(showsYoutubeExcluded(true, [other, {}])).toBe(false)
    expect(showsYoutubeExcluded(true, [])).toBe(false)
  })
})

describe('아이폰·아이패드 판별 (AC-QL2-25, D-QL2-07)', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1'
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

  it('(a) 아이폰 참 (b) 옛 아이패드 참 (c) 맥 + 터치 지점 5 참 (d) 맥 + 터치 지점 0 거짓 (e) 안드로이드·윈도우 거짓', () => {
    expect(isIphone(IPHONE, 0)).toBe(true)
    expect(isIphone(IPAD_OLD, 0)).toBe(true)
    expect(isIphone(MAC, 5)).toBe(true)
    expect(isIphone(MAC, 0)).toBe(false)
    expect(isIphone(MAC, 1)).toBe(false)
    expect(isIphone(ANDROID, 5)).toBe(false)
    expect(isIphone(WINDOWS, 10)).toBe(false)
    expect(isIphone('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)', 0)).toBe(true)
  })

  it('기본 기기 이름: (c) "아이폰", (d) "PC"', () => {
    expect(defaultDeviceName({ userAgent: MAC, narrow: false, otherStation: null, touchPoints: 5 })).toBe('아이폰')
    expect(defaultDeviceName({ userAgent: MAC, narrow: false, otherStation: null, touchPoints: 0 })).toBe('PC')
    expect(defaultDeviceName({ userAgent: MAC, narrow: false, otherStation: null })).toBe('PC')
  })
})

describe('출력 멈춤 알림 문장 (AC-QL2-41, D-QL2-09 ②)', () => {
  it('판매자 멈춤만 까닭·할 일 — 쌓인 라벨이면 장 수와 "출력 시작", 손으로 멈췄으면 "다시 시작"', () => {
    expect(pauseAlertMessage({ reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true }, 3)).toBe("쌓인 라벨 3장이 기다려요. 눌러서 '출력 시작'을 골라 주세요.")
    expect(pauseAlertMessage({ reason: 'SELLER', message: '출력을 멈췄어요.', backlog: false }, 3)).toBe("'출력 멈추기'를 눌러 멈췄어요. 눌러서 '다시 시작'을 골라 주세요.")
  })

  it('끊김·프린터 오류·라벨 오류는 서버 문장 그대로', () => {
    expect(pauseAlertMessage({ reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false }, 2)).toBe('프린터 연결이 끊겼어요.')
    expect(pauseAlertMessage({ reason: 'PRINTER_ERROR', message: '프린터 문장', backlog: false }, 0)).toBe('프린터 문장')
    expect(pauseAlertMessage({ reason: 'LABEL_ERROR', message: '라벨 문장', backlog: false }, 0)).toBe('라벨 문장')
  })

  it('알림 띠 항목은 "출력 멈춤 · …"', () => {
    render(<AlertStrip counts={COUNTS} print={{ pause: pauseAlertMessage({ reason: 'SELLER', message: 'x', backlog: false }, 0), discard: 0 }} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: "출력 멈춤 · '출력 멈추기'를 눌러 멈췄어요. 눌러서 '다시 시작'을 골라 주세요." })).toBeDefined()
  })
})

describe('보류 찜 시간 낱말 (AC-QL2-43, D-QL2-09 ④)', () => {
  it('60초 미만 "N초 전", 60초 이상 "N분 전"(내림)', () => {
    expect(agoWord(0)).toBe('0초 전')
    expect(agoWord(45)).toBe('45초 전')
    expect(agoWord(59)).toBe('59초 전')
    expect(agoWord(60)).toBe('1분 전')
    expect(agoWord(119)).toBe('1분 전')
    expect(agoWord(383)).toBe('6분 전')
  })

  it('창 맨 위 뜻 — 방송의 인정 시간(기본 30, 45로 정한 방송이면 45)', () => {
    expect(pendingMeaning(30)).toBe('보류 찜은 아직 등록하지 않은 번호로 들어온 찜이에요. 찜이 들어오고 30초 안에 그 번호를 등록하면 판정에 들어가고, 늦으면 만료돼요.')
    expect(pendingMeaning(45)).toContain('찜이 들어오고 45초 안에')
  })
})

describe('라벨 문장 (AC-QL2-13·14·40·42)', () => {
  it('출력 기기 없음 항목 글자 그대로', () => {
    expect(NO_STATION_PILING).toBe("출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 프린터를 연결한 뒤 '이 기기에서 출력'을 눌러 주세요.")
  })

  it('저절로 다시 잇는 동안·그친 뒤·빼기 확인', () => {
    expect(autoReconnectingMessage(1, 6)).toBe('프린터에 다시 잇고 있어요. (1/6)')
    expect(autoReconnectingMessage(6, 6)).toBe('프린터에 다시 잇고 있어요. (6/6)')
    expect(AUTO_RECONNECT_GAVE_UP).toBe("저절로 다시 잇지 못했어요. 아래를 해 본 뒤 '다시 연결'을 눌러 주세요.")
    expect(cancelJobQuestion('15번 핑크프릴')).toBe('15번 핑크프릴 라벨을 뺄까요? 뺀 라벨은 출력하지 않아요(기록은 남아요).')
  })

})
