// 출력 화면 낱말·문장 (D-088에 D-I1-08을 더함, LABEL_RULES L-7·L-8·L-11, AC-I1-24·34·60·61). 영어 상태값·코드는 화면에 보이지 않는다.
import { LABEL_MESSAGES, buyerText, doesNotFitMessage, formatLabelDate, type LabelBuyer } from '@livejjim/label'
import { PRINTER_MESSAGES, type PrinterErrorCode } from '@livejjim/printer'
import type { JobReason, JobView, LabelView, QueueSummary } from '../api/print-types.ts'
import { kstHm } from './kst.ts'

/** 알림 띠 낱말 (D-I1-08) */
export const PRINT_ALERT_WORD = {
  paused: '출력 멈춤',
  discard: '버릴 라벨',
} as const

/** 만든 까닭 */
export const REASON_WORD: Readonly<Record<JobReason, string>> = {
  auto: '자동',
  manual: '손으로',
  reprint: '다시 출력',
  packing: '포장',
}

/** 라벨 종류 */
export const KIND_WORD: Readonly<Record<'product' | 'packing', string>> = {
  product: '상품',
  packing: '포장',
}

/** 조치 낱말 (D-I1-08) */
export const PRINT_ACTION = {
  reconnect: '다시 연결',
  restart: '다시 시작',
  start: '출력 시작',
  pause: '출력 멈추기',
  release: '출력 그만하기',
  print: '라벨 출력',
  reprint: '다시 출력',
  discarded: '버렸어요',
  thisDevice: '이 기기에서 출력',
} as const

export const REHEARSAL_NO_LABELS = '리허설 방송은 라벨을 출력하지 않아요.'
export const KEEP_SCREEN_ON = '출력하는 동안 이 화면을 켜 두세요.'
export const TEST_QUESTION = '테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?'
export const SETTING_NEXT_BROADCAST = '다음에 시작하는 방송부터 적용돼요.'
export const NO_WINNER_LABEL = '1등이 없어 출력할 라벨이 없어요.'

/** 쌓인 라벨 안내 (L-11 10) */
export function backlogMessage(count: number): string {
  return `대기 중인 라벨 ${String(count)}장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요.`
}

/** 다른 기기에서 보는 출력 기기 안내 (AC-I1-23) */
export const deviceLostMessage = (name: string): string => `출력 기기 '${name}'와 연결이 끊겼어요.`
export const reconnectThereMessage = (name: string): string => `출력 기기 '${name}'에서 다시 연결해 주세요.`
export const replaceQuestion = (name: string): string => `지금은 '${name}'에서 출력하고 있어요. 이 기기로 바꿀까요?`

/** 라벨의 구매자 표시 (유튜브 닉네임, 문자찜은 `문자찜`) */
export function buyerWord(buyer: LabelBuyer): string {
  return buyerText(buyer)
}

/** 출력 오류 코드의 문장 (L-7 표 · 라벨 패키지 문장) */
export function printErrorMessage(error: { readonly code: string; readonly item: string | null }): string {
  if (Object.hasOwn(PRINTER_MESSAGES, error.code)) return PRINTER_MESSAGES[error.code as PrinterErrorCode]
  switch (error.code) {
    case 'DOES_NOT_FIT':
      return doesNotFitMessage(error.item ?? '')
    case 'INVALID_DATA':
      return `${LABEL_MESSAGES.invalidDataPrefix}${LABEL_MESSAGES.labelData}`
    case 'INVALID_TEMPLATE':
      return LABEL_MESSAGES.invalidTemplate
    case 'MIXED_SIZES':
      return LABEL_MESSAGES.mixedSizes
    case 'NO_LABELS':
      return LABEL_MESSAGES.noLabels
    case 'INVALID_IMAGE':
      return LABEL_MESSAGES.invalidImage
    default:
      return PRINTER_MESSAGES.PRINT_FAILED
  }
}

/** 작업의 번호 표시: 상품 `15번`, 포장 `포장 1/2쪽` */
export function jobNumberWord(job: Pick<JobView, 'kind' | 'label' | 'data' | 'page' | 'pages'>): string {
  if (job.kind === 'packing') return job.page === null || job.pages === null ? '포장' : `포장 ${String(job.page)}/${String(job.pages)}쪽`
  const no = job.data !== null && 'no' in job.data ? job.data.no : job.label.no
  return no === null ? '' : `${String(no)}번`
}

/** 작업의 품종 (상품, 지금 데이터 — 없으면 빈 글) */
export function jobNameWord(job: Pick<JobView, 'kind' | 'data'>): string {
  if (job.kind !== 'product' || job.data === null || !('name' in job.data)) return ''
  return job.data.name.trim() === '' ? '품종 미입력' : job.data.name
}

/** 버릴 라벨 안내 "15번 · 우주천사 · 26.10.18 라벨을 버려 주세요" (AC-I1-24) */
export function discardWord(job: Pick<JobView, 'kind' | 'label' | 'data' | 'page' | 'pages' | 'date'>): string {
  return `${jobNumberWord(job)} · ${buyerWord(job.label.buyer)} · ${formatLabelDate(job.date)} 라벨을 버려 주세요`
}

/** 출력 이력 "2번 출력 · 20:01 휴대폰 · 20:15 PC" (AC-I1-31) */
export function historyWord(label: Pick<LabelView, 'printed' | 'history'>): string {
  if (label.printed === 0) return '아직 출력하지 않았어요'
  return [`${String(label.printed)}번 출력`, ...label.history.map((item) => `${kstHm(item.at)} ${item.device}`)].join(' · ')
}

/** 프린터 상태 한 줄 (AC-I1-34): "프린터 PC · 연결됨 · 대기 2장" / "출력 기기 없음 · 대기 3장" / "출력 멈춤 · 대기 5장" */
export function printerStatusWord(queue: QueueSummary | null): string {
  if (queue === null) return '출력 기기 없음'
  const waiting = `대기 ${String(queue.waiting)}장`
  if (queue.pause !== null) return `${PRINT_ALERT_WORD.paused} · ${waiting}`
  if (queue.device === null) return queue.waiting === 0 && queue.printing === 0 ? '출력 기기 없음' : `출력 기기 없음 · ${waiting}`
  const connected = queue.device.live && queue.device.printerConnected
  return `프린터 ${queue.device.name} · ${connected ? '연결됨' : '끊김'} · ${waiting}`
}

/** 다른 기기에서 보는 출력 기기 "출력 기기: PC · 연결됨" */
export function deviceWord(queue: QueueSummary): string {
  if (queue.device === null) return '출력 기기 없음'
  return `출력 기기: ${queue.device.name} · ${queue.device.live ? '연결됨' : '끊김'}`
}
