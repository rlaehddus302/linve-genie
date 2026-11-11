// 네이티브 파일 구조 검사 — 실기기·네이티브 빌드 없이 지킬 것(SPEC ORD-13 C-01·C-03·C-04·C-07, D-SMS3-02).
// 값 자체(거르기·꺼내기·요청 모양)는 공용 사례(vectors.test.ts)와 Kotlin·Swift 시험이 잠근다. 여기서는 그 밖의 약속을 글로 본다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BANK_NUMBERS, DEFAULT_SKIP_WORDS, INBOX_BATCH_MAX, INBOX_OFF_RECHECK_MS, NOTICE_QUEUE_MAX, NOTICE_TEXT_MAX_CHARS, TOO_MANY_WAIT_MS } from '../src/index.ts'

const root = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const kotlinDir = 'android/src/main/java/com/livejjim/notice'
const kotlin = readdirSync(join(root, kotlinDir)).map((name) => ({ name, text: read(`${kotlinDir}/${name}`) }))
const swift = readdirSync(join(root, 'ios'))
  .filter((name) => name.endsWith('.swift'))
  .map((name) => ({ name, text: read(`ios/${name}`) }))

describe('권한 (C-01)', () => {
  it('문자 수신 권한은 쓰지 않는다 — 알림 읽기 하나', () => {
    const manifest = read('android/src/main/AndroidManifest.xml')
    for (const permission of ['READ_SMS', 'RECEIVE_SMS', 'RECEIVE_MMS', 'SEND_SMS']) expect(manifest).not.toContain(permission)
    expect(manifest).toContain('android.permission.BIND_NOTIFICATION_LISTENER_SERVICE')
  })
  // D-SMS-CONTACT (SPEC C-01 바뀜): 연락처 읽기는 이름만 온 문자의 보낸 곳을 휴대폰 번호로 바꾸는 한 곳(ContactNumber)에서만 쓴다
  it('연락처는 보낸 곳 이름 → 휴대폰 번호 바꾸기에서만 읽는다', () => {
    expect(read('android/src/main/AndroidManifest.xml')).toContain('android.permission.READ_CONTACTS')
    const readers = kotlin.filter((f) => f.text.includes('ContactsContract')).map((f) => f.name)
    expect(readers).toEqual(['ContactNumber.kt'])
    const swiftReaders = swift.filter((f) => f.text.includes('CNContactStore')).map((f) => f.name)
    expect(swiftReaders).toEqual(['ContactNumber.swift'])
  })
  it('문자는 기본 문자 앱으로 정한다', () => {
    const service = kotlin.find((f) => f.name === 'NoticeListenerService.kt')?.text ?? ''
    expect(service).toContain('Telephony.Sms.getDefaultSmsPackage')
    expect(service).toContain('NoticeExtractor.channelForPackage')
    // 읽을 앱인지 정하기 전에 알림 내용을 열지 않는다
    expect(service.indexOf('channelForPackage')).toBeLessThan(service.indexOf('NotificationReader.read(sbn)'))
  })
})

describe('로그 금지 (C-07)', () => {
  it.each([...kotlin, ...swift])('$name 에 로그 호출이 없다', ({ text }) => {
    expect(text).not.toMatch(/\bLog\.[a-z]\(|println\(|printStackTrace\(|\bprint\(|NSLog\(|os_log\(|Logger\(/)
  })
})

describe('세 플랫폼이 같은 한도·낱말', () => {
  const kt = kotlin.map((f) => f.text).join('\n')
  const sw = swift.map((f) => f.text).join('\n')
  it('본문 1,000자 · 한 번에 20건 · 대기열 1,000건 · 429 뒤 1분', () => {
    expect(kt).toMatch(new RegExp(`TEXT_MAX_CHARS = ${NOTICE_TEXT_MAX_CHARS}\\b`))
    expect(kt).toMatch(new RegExp(`BATCH_MAX = ${INBOX_BATCH_MAX}\\b`))
    expect(kt).toMatch(new RegExp(`QUEUE_MAX = ${NOTICE_QUEUE_MAX}\\b`))
    expect(kt).toMatch(/TOO_MANY_WAIT_MS = 60_000L/)
    expect(sw).toMatch(new RegExp(`textMaxChars = ${NOTICE_TEXT_MAX_CHARS}\\b`))
    expect(sw).toMatch(new RegExp(`batchMax = ${INBOX_BATCH_MAX}\\b`))
    expect(sw).toMatch(new RegExp(`queueMax = ${NOTICE_QUEUE_MAX}\\b`))
    expect(sw).toMatch(/tooManyWaitMs: Int64 = 60_000/)
    expect(TOO_MANY_WAIT_MS).toBe(60_000)
  })
  it('받기 꺼짐(403) 뒤 10분마다 다시 본다', () => {
    expect(INBOX_OFF_RECHECK_MS).toBe(600_000)
    expect(kt).toMatch(/INBOX_OFF_RECHECK_MS = 600_000L/)
    expect(sw).toMatch(/inboxOffRecheckMs: Int64 = 600_000/)
  })
  it('목록 받기 전 은행 대표번호(DP-9 1 표 사본)', () => {
    const list = DEFAULT_BANK_NUMBERS.map((w) => `"${w}"`).join(', ')
    expect(kt).toContain(`DEFAULT_BANK_NUMBERS = listOf(${list})`)
    expect(sw).toContain(`defaultBankNumbers = [${list}]`)
  })
  it('목록 받기 전 거를 낱말(R-26 3 사본)', () => {
    const list = DEFAULT_SKIP_WORDS.map((w) => `"${w}"`).join(', ')
    expect(kt).toContain(`DEFAULT_SKIP_WORDS = listOf(${list})`)
    expect(sw).toContain(`defaultSkipWords = [${list}]`)
  })
})
