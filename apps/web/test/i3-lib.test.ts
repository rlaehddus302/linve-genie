// I3 화면 판단 (D-I3-02~10, AC-I3-02·13·25·30·31·38·40·45·46·52): 낱말·셈·주소. 시험은 TZ=Pacific/Honolulu에서 돈다(verify test 단계).
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import type { CollectorView } from '../src/api/types.ts'
import { kstClockWords, kstDateTimeWords, kstHourWords } from '../src/lib/kst.ts'
import { groupDigits } from '../src/lib/money.ts'
import { menuOf, parseRoute, routePath, type Route } from '../src/lib/router.ts'
import { FIELDS, changedSettings, draftOf, fieldOf, fieldWarning, fieldsAt, payloadOf, valueWords } from '../src/lib/settings-fields.ts'
import {
  ALERT_REASONS,
  CALLBACK_UNKNOWN_MESSAGE,
  QUOTA_BACK_TO_NORMAL,
  QUOTA_MODE_SENTENCE,
  SUMMARY_AUTO,
  SUMMARY_MANUAL,
  SUMMARY_OFF,
  callbackMessage,
  collectorWarning,
  consentSummary,
  outboxGroups,
  productNo,
  quotaChangeNotice,
  sealSoon,
  thanksFailedCount,
  unconfirmedWarning,
} from '../src/lib/youtube.ts'
import { outboxRow as row } from './support.ts'

const collector = (patch: Partial<CollectorView>): CollectorView => ({
  status: 'LIVE',
  statusMessage: '채팅을 받는 중',
  reason: null,
  reasonMessage: null,
  mode: 'STREAM',
  lastMessageAt: null,
  recorded: 0,
  skippedBeforeLink: 0,
  gap: false,
  gapMessage: null,
  restartable: false,
  ...patch,
})

describe('알림 띠 "감사 실패" (AC-I3-30, D-I3-05)', () => {
  it('할 일이 있는 실패만 센다 — 동의하지 않음·방송 안 이음·채팅 끝남·봉인·알림에서 뺀 행은 세지 않는다', () => {
    const rows = [
      ...[...ALERT_REASONS].map((reason, index) => row(index + 1, { state: 'FAILED', reason })),
      row(20, { state: 'FAILED', reason: 'NO_CONSENT' }),
      row(21, { state: 'FAILED', reason: 'NO_LINK' }),
      row(22, { state: 'FAILED', reason: 'CHAT_ENDED' }),
      row(23, { state: 'FAILED', reason: 'SEALED' }),
      row(24, { state: 'FAILED', reason: 'GAVE_UP', dismissed: true }),
      row(25, { state: 'WAITING', reason: 'RETRY' }),
      row(26),
    ]
    expect([...ALERT_REASONS].sort()).toEqual(['EXPIRED', 'GAVE_UP', 'NOT_MY_CHANNEL', 'NO_PERMISSION', 'REJECTED', 'UNCONFIRMED'])
    expect(thanksFailedCount(rows)).toBe(6)
    // 동의하지 않은 판매자가 판매를 아무리 해도 0
    expect(thanksFailedCount(Array.from({ length: 30 }, (_, i) => row(i + 1, { state: 'FAILED', reason: 'NO_CONSENT' })))).toBe(0)
  })

  it('목록 묶음: 확인이 필요한 감사 → 자동으로 보내지 않은 감사(뺀 행 포함) → 기다리는 중·보내는 중 → 보냄(게시됨·건너뜀), 묶음 안은 최근 순', () => {
    const groups = outboxGroups([
      row(1, { state: 'FAILED', reason: 'REJECTED' }),
      row(2, { state: 'FAILED', reason: 'NO_CONSENT' }),
      row(3, { state: 'FAILED', reason: 'UNCONFIRMED', dismissed: true }),
      row(4, { state: 'SENDING' }),
      row(5, { state: 'WAITING' }),
      row(6, { state: 'SKIPPED', reason: 'CANCELLED' }),
      row(7),
      row(8, { state: 'FAILED', reason: 'UNCONFIRMED' }),
    ])
    expect(groups.attention.map((item) => item.id)).toEqual([8, 1])
    expect(groups.notSent.map((item) => item.id)).toEqual([3, 2])
    expect(groups.pending.map((item) => item.id)).toEqual([5, 4])
    expect(groups.sent.map((item) => item.id)).toEqual([7, 6])
  })

  it('확인하지 못한 감사 안내는 대상 낱말로, 상품 키에서 번호', () => {
    expect(unconfirmedWarning('LIVE_CHAT')).toBe('이미 올라갔을 수 있어요. 유튜브 채팅에서 먼저 확인해 주세요.')
    expect(unconfirmedWarning('VIDEO_COMMENT')).toBe('이미 올라갔을 수 있어요. 영상 댓글에서 먼저 확인해 주세요.')
    expect(unconfirmedWarning('SUMMARY')).toBe('이미 올라갔을 수 있어요. 영상 댓글에서 먼저 확인해 주세요.')
    expect(productNo('b_1/15')).toBe(15)
    expect(productNo(null)).toBeNull()
    expect(productNo('b1/x')).toBeNull()
  })
})

describe('감사 메시지 요약 한 줄 (AC-I3-13)', () => {
  it('만들기 켜짐 + 동의 켜짐 / 만들기 켜짐 + 동의 꺼짐 / 만들기 꺼짐', () => {
    expect(consentSummary(true, true)).toBe(SUMMARY_AUTO)
    expect(consentSummary(true, false)).toBe(SUMMARY_MANUAL)
    expect(consentSummary(false, true)).toBe(SUMMARY_OFF)
    expect(consentSummary(false, false)).toBe(SUMMARY_OFF)
    expect(SUMMARY_AUTO).toBe('다음 방송부터 자동으로 남겨요')
  })
})

describe('구글에서 돌아온 결과 (AC-I3-02)', () => {
  it('코드마다 정한 문장, 그 밖은 "알 수 없어요"', () => {
    expect(callbackMessage('connected')).toBe('유튜브 채널을 연결했어요.')
    expect(callbackMessage('STATE_INVALID')).toBe('연결 시간이 지났어요. 다시 시도해 주세요.')
    expect(callbackMessage('ACCESS_DENIED')).toBe('구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요.')
    expect(callbackMessage('NO_CHANNEL')).toBe('이 구글 계정에는 유튜브 채널이 없어요.')
    expect(callbackMessage('CHANNEL_TAKEN')).toBe('이 채널은 연결할 수 없어요. 운영자에게 문의해 주세요.')
    expect(callbackMessage('CHANNEL_MISMATCH')).toBe('처음 연결한 채널과 달라요. 바꾸려면 먼저 연결을 끊어 주세요.')
    expect(callbackMessage('GOOGLE_FAILED')).toBe('구글에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    expect(callbackMessage('toString')).toBe(CALLBACK_UNKNOWN_MESSAGE)
    expect(callbackMessage('<script>')).toBe('연결 결과를 알 수 없어요. 아래 연결 상태를 확인해 주세요.')
  })
})

describe('수집 멈춤 경고 (AC-I3-25)', () => {
  it('멈춤 이유마다: 다시 연결 필요·연결 끊김은 "다시 연결하기", 다시 받을 수 있으면 "채팅 다시 받기"', () => {
    const reconnect = collectorWarning(collector({ status: 'STOPPED', statusMessage: '유튜브 연결을 다시 해 주세요.', reason: 'RECONNECT', reasonMessage: '유튜브 연결을 다시 해 주세요.', restartable: true }), false)
    expect(reconnect).toEqual({ message: '유튜브 채팅을 받지 못하고 있어요 — 유튜브 연결을 다시 해 주세요.', reconnect: true, restartable: false })
    const disabled = collectorWarning(collector({ status: 'STOPPED', statusMessage: '채팅이 꺼져 있어요.', reason: 'CHAT_DISABLED', reasonMessage: '채팅이 꺼져 있어요.', restartable: true }), false)
    expect(disabled).toEqual({ message: '유튜브 채팅을 받지 못하고 있어요 — 채팅이 꺼져 있어요.', reconnect: false, restartable: true })
    for (const reason of ['NOT_CONNECTED', 'NOT_MY_CHANNEL', 'QUOTA', 'FORBIDDEN', 'CHAT_NOT_FOUND']) {
      expect(collectorWarning(collector({ status: 'STOPPED', reason, reasonMessage: '이유' }), false)).not.toBeNull()
    }
  })

  it('경고 없음: 끊음(UNLINKED)·봉인·채팅 끝남·시작하는 중(예정 방송)·마침·받는 중', () => {
    expect(collectorWarning(collector({ status: 'STOPPED', reason: 'UNLINKED' }), true)).toBeNull()
    expect(collectorWarning(collector({ status: 'STOPPED', reason: 'SEALED' }), true)).toBeNull()
    expect(collectorWarning(collector({ status: 'CHAT_ENDED' }), true)).toBeNull()
    expect(collectorWarning(collector({ status: 'STARTING', reason: 'NOT_STARTED' }), true)).toBeNull()
    expect(collectorWarning(collector({ status: 'FINISHED' }), true)).toBeNull()
    expect(collectorWarning(collector({}), true)).toBeNull()
    expect(collectorWarning(null, true)).toBeNull()
  })

  it('"다시 연결하는 중"은 10초 넘게 이어질 때만 (이유가 없으면 상태 문장)', () => {
    const retrying = collector({ status: 'RETRYING', statusMessage: '다시 연결하는 중' })
    expect(collectorWarning(retrying, false)).toBeNull()
    expect(collectorWarning(retrying, true)?.message).toBe('유튜브 채팅을 받지 못하고 있어요 — 다시 연결하는 중')
  })
})

describe('사용량 모드 알림 (AC-I3-38)', () => {
  it('바뀔 때만 한 번 — 같은 모드를 다시 알려도·처음 알아도 띄우지 않는다', () => {
    expect(quotaChangeNotice('NORMAL', 'BATCH')).toBe(QUOTA_MODE_SENTENCE.BATCH)
    expect(quotaChangeNotice('BATCH', 'PAUSED')).toBe('오늘 유튜브 사용량이 거의 다 되어 감사 메시지를 멈췄어요. 채팅은 계속 받아요')
    expect(quotaChangeNotice('PAUSED', 'NORMAL')).toBe(QUOTA_BACK_TO_NORMAL)
    expect(quotaChangeNotice('PAUSED', 'PAUSED')).toBeNull()
    expect(quotaChangeNotice(null, 'PAUSED')).toBeNull()
    expect(QUOTA_MODE_SENTENCE.NORMAL).toBe('감사 메시지를 바로 보내요')
  })
})

describe('봉인 예고 (AC-I3-40)', () => {
  it('봉인 7일 전부터 경고', () => {
    const sealAt = '2026-11-24T15:00:00.000Z'
    expect(sealSoon(sealAt, Date.parse(sealAt) - 7 * 86_400_000 - 1)).toBe(false)
    expect(sealSoon(sealAt, Date.parse(sealAt) - 7 * 86_400_000)).toBe(true)
    expect(sealSoon(sealAt, Date.parse(sealAt) + 1)).toBe(true)
    expect(sealSoon('알 수 없음', 0)).toBe(false)
  })
})

describe('한국 시각 낱말 (NFR-07)', () => {
  it('"10월 25일 오후 8:01" · "오후 8:31:05" · 봉인 "11월 25일 0시"', () => {
    expect(kstDateTimeWords('2026-10-25T11:01:00.000Z')).toBe('10월 25일 오후 8:01')
    expect(kstDateTimeWords('2026-10-24T15:05:00.000Z')).toBe('10월 25일 오전 12:05')
    expect(kstDateTimeWords('2026-10-25T03:00:00.000Z')).toBe('10월 25일 오후 12:00')
    expect(kstClockWords('2026-10-25T11:31:05.000Z')).toBe('오후 8:31:05')
    expect(kstHourWords('2026-11-24T15:00:00.000Z')).toBe('11월 25일 0시')
    expect(kstHourWords('2026-11-24T15:30:00.000Z')).toBe('11월 25일 0시 30분')
    expect(kstDateTimeWords('없음')).toBe('')
    expect(groupDigits(1234)).toBe('1,234')
    expect(groupDigits(10000)).toBe('10,000')
  })
})

describe('판매 규칙 칸 (AC-I3-45·46·52)', () => {
  it('보이는 칸에 직접 묶기·자동 출력은 없다, 자리마다 칸', () => {
    const keys = FIELDS.map((field) => field.key as string)
    expect(keys).not.toContain('settlement.groupBy')
    expect(keys).not.toContain('print.autoOnConfirm')
    expect(fieldsAt('basic').map((field) => field.key)).toEqual(['waitlist.max', 'cancel.succession', 'cancel.buyerChat', 'price.unit'])
    expect(fieldsAt('more').map((field) => field.key)).toEqual([
      'claim.parseMode',
      'claim.multiNumber',
      'claim.maxNumber',
      'claim.ignoreOwner',
      'claim.preOpenWindowSec',
      'contention.policy',
      'contention.sameMinuteTieBreaker',
    ])
    expect(fieldsAt('shipping').map((field) => field.key)).toEqual(['shipping.baseFee', 'shipping.freeThreshold'])
    expect(fieldsAt('thanks').map((field) => field.key)).toEqual(['thanks.liveChat', 'thanks.videoComment', 'thanks.batchWindowSec'])
  })

  it('바뀐 키만 보낸다 — 빈 무료배송 기준은 null, 숫자로 읽지 못한 글자·범위 밖은 그대로 보내 서버 문장을 받는다', () => {
    const fields = [...fieldsAt('basic'), ...fieldsAt('shipping'), ...fieldsAt('thanks')]
    const draft = { ...draftOf(DEFAULT_SETTINGS, fields) }
    expect(changedSettings(fields, draft, DEFAULT_SETTINGS)).toEqual({})
    expect(changedSettings(fields, { ...draft, 'waitlist.max': '3', 'shipping.freeThreshold': '50,000' }, DEFAULT_SETTINGS)).toEqual({ 'waitlist.max': 3, 'shipping.freeThreshold': 50000 })
    expect(changedSettings(fields, { ...draft, 'shipping.freeThreshold': '' }, { ...DEFAULT_SETTINGS, 'shipping.freeThreshold': 30000 })).toEqual({ 'shipping.freeThreshold': null })
    expect(changedSettings(fields, { ...draft, 'thanks.batchWindowSec': '1.5' }, DEFAULT_SETTINGS)).toEqual({ 'thanks.batchWindowSec': 1.5 })
    expect(changedSettings(fields, { ...draft, 'thanks.batchWindowSec': '-1' }, DEFAULT_SETTINGS)).toEqual({ 'thanks.batchWindowSec': -1 })
    expect(changedSettings(fields, { ...draft, 'thanks.batchWindowSec': '열' }, DEFAULT_SETTINGS)).toEqual({ 'thanks.batchWindowSec': '열' })
    expect(changedSettings(fields, { ...draft, 'thanks.liveChat': false, 'thanks.videoComment': 'SUMMARY' }, DEFAULT_SETTINGS)).toEqual({ 'thanks.liveChat': false, 'thanks.videoComment': 'SUMMARY' })
    // 돈 칸은 원 단위 (천원 단위 설정을 쓰지 않는다)
    expect(payloadOf(fieldOf('shipping.baseFee'), '3,500')).toBe(3500)
    expect(payloadOf(fieldOf('shipping.baseFee'), '4천')).toBe(4000)
    expect(payloadOf(fieldOf('shipping.baseFee'), '')).toBe('')
  })

  it('경고 한 줄: 느슨하게·바로 취소해요', () => {
    expect(fieldWarning(fieldOf('claim.parseMode'), 'LOOSE')).toBe("느슨하게 하면 '15번 예뻐요' 같은 채팅도 주문이 될 수 있어요.")
    expect(fieldWarning(fieldOf('claim.parseMode'), 'STRICT')).toBeNull()
    expect(fieldWarning(fieldOf('cancel.buyerChat'), 'AUTO')).toBe('장난 취소도 바로 처리돼요.')
    expect(fieldWarning(fieldOf('cancel.buyerChat'), 'REQUEST')).toBeNull()
  })

  it('마법사 2단계 값 낱말 (기본값)', () => {
    const words = (['waitlist.max', 'cancel.succession', 'cancel.buyerChat', 'price.unit', 'shipping.baseFee', 'shipping.freeThreshold'] as const).map((key) =>
      valueWords(fieldOf(key), DEFAULT_SETTINGS),
    )
    // FB1 D-FB1-11: 가격 단위 낱말 원·천원·만원 (AC-FB1-01)
    expect(words).toEqual(['5명', '대기 1순위가 바로 1등', '내가 확인하고 처리해요', '천원 (15 → 15,000원)', '4,000원', '없음'])
    expect(valueWords(fieldOf('shipping.freeThreshold'), { ...DEFAULT_SETTINGS, 'shipping.freeThreshold': 50000 })).toBe('50,000원')
  })
})

describe('주소 (AC-I3-44·50·77)', () => {
  it.each<[string, string, Route]>([
    ['/settings', '', { name: 'settings' }],
    ['/settings/youtube', '', { name: 'settings', section: 'youtube' }],
    ['/settings/youtube', '?youtube=connected', { name: 'settings', section: 'youtube', youtubeResult: 'connected' }],
    ['/start', '', { name: 'start' }],
    ['/start', '?youtube=ACCESS_DENIED', { name: 'start', youtubeResult: 'ACCESS_DENIED' }],
    ['/privacy', '', { name: 'privacy' }],
    ['/terms/', '', { name: 'terms' }],
  ])('%s%s', (path, search, route) => {
    expect(parseRoute(path, search)).toEqual(route)
  })

  it('주소 → 화면 → 주소, 메뉴', () => {
    for (const url of ['/settings', '/settings/youtube', '/settings/youtube?youtube=connected', '/start', '/privacy', '/terms']) {
      const [path, query] = url.split('?')
      expect(routePath(parseRoute(path ?? '', query === undefined ? '' : `?${query}`))).toBe(url)
    }
    expect(routePath({ name: 'start', fresh: true })).toBe('/start')
    expect(menuOf({ name: 'settings', section: 'youtube' })).toBe('settings')
    expect(menuOf({ name: 'start' })).toBeNull()
    expect(menuOf({ name: 'privacy' })).toBeNull()
  })
})
