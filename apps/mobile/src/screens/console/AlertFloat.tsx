// 떠 있는 오류 알림 (D-ALERTFLOAT-01 — 옛 탭 바 밑 알림 띠 AlertStrip·주황 상자 UnlistedClaims를 바꿈):
// 사용자 "오류 메시지는 맨위에 띄우지 말고, 오른쪽 아래에 플로팅 버튼 형식으로 … 폰트 크기도 좀 키우고. 메시지 너무 길게는 작성하지 말고. 스타일은 전부 빨간색, 오른쪽에 > 아이콘."
// - 화면 오른쪽 아래, (+)·인쇄 단추·매출 캡슐 위에 빨간 캡슐로 뜬다. 여럿이면 위아래로 놓는다(고르는 단추 묶음이 아니라 따로따로 처리하는 알림이라 D-UX4-01 좌우 규칙 밖, AUTO).
// - 같은 일을 하는 알림은 하나로: 출력 기기 없음 + 출력 멈춤 → 프린터 한 줄(까닭이 있으면 까닭 그대로), 보류 찜 + 등록 안 된 번호 → 한 줄, 충돌 + 승계 → "1등을 정해 주세요".
// - 뺀 것: 버릴 라벨(판매자가 직접 한 취소·무효에서만 생긴다 — 라벨 탭에 대기 중·출력됨만), 확인 필요(서버가 처리하지 못한 입력 — 판매자가 할 일이 없어 운영자 문자로).
import { View } from 'react-native'
import type { PrintIssue, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { AlertCounts } from '../../lib/derive.ts'
import { Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'

/** 누르면 할 일 — 라벨·프린터 화면 · 정하기 판 · 등록 안 된 번호 */
export type FloatAction = 'labels' | 'decide' | 'unlisted'

export interface FloatAlert {
  readonly key: 'printer' | 'decide' | 'cancel' | 'unlisted'
  readonly text: string
  readonly action: FloatAction
}

/** 라벨이 안 나가는 까닭 낱말 (짧게 — 출력 기기 앱·프린터가 알린 것) */
export const PRINT_ISSUE_TEXT: Readonly<Record<PrintIssue, string | null>> = {
  BLUETOOTH_OFF: '블루투스가 꺼져 있어요',
  BLUETOOTH_DENIED: '블루투스 권한을 켜 주세요',
  OUT_OF_RANGE: '프린터가 너무 멀어요',
  PRINTER_CLOSED: '프린터가 꺼져 있어요',
  LINK_LOST: '프린터 연결이 끊겼어요',
  APP_BACKGROUND: '출력 기기에서 앱을 켜 주세요',
  NO_RESPONSE: '프린터가 답하지 않아요',
  COVER_OPEN: '프린터 덮개가 열려 있어요',
  NO_PAPER: '라벨 용지가 없어요',
  LOW_BATTERY: '프린터 배터리가 부족해요',
  OVERHEAT: '프린터가 너무 뜨거워요',
  UNKNOWN: null,
}

export const PRINT_FLOAT_TEXT = {
  noDevice: '프린터를 연결해 주세요',
  deviceOff: '출력 기기에서 앱을 켜 주세요',
  lost: '프린터 연결이 끊겼어요',
  printerError: '프린터를 확인해 주세요',
  labelError: '라벨을 만들지 못했어요',
  seller: '라벨 출력을 멈췄어요',
} as const
export const DECIDE_FLOAT_TEXT = '1등을 정해 주세요'
export const cancelFloatText = (n: number): string => `취소 요청 ${String(n)}건`
export const unlistedFloatText = (n: number): string => `등록 안 된 번호에 찜 ${String(n)}건`

/** 라벨이 쌓이는데 출력 기기가 없거나 끊겼다 (실제 방송·라벨 켬·대기 있음) */
export function noStation(queue: QueueSummary | null, rehearsal: boolean, ended: boolean): boolean {
  if (rehearsal || ended || queue === null || !queue.labelsEnabled) return false
  if (queue.waiting + queue.printing === 0) return false
  return queue.device === null || !queue.device.live || !queue.device.printerConnected
}

/** 프린터 한 줄 (없으면 null): 판매자가 멈춤 → 라벨을 못 만듦 → 기기 없음 → 알린 까닭 → 기기 앱 꺼짐 → 끊김 → 프린터 오류 */
export function printerFloatText(queue: QueueSummary | null, rehearsal: boolean, ended: boolean): string | null {
  if (rehearsal || queue === null) return null
  const pause = queue.pause?.reason ?? null
  if (pause === 'SELLER') return PRINT_FLOAT_TEXT.seller
  if (pause === 'LABEL_ERROR') return PRINT_FLOAT_TEXT.labelError
  if (pause === null && !noStation(queue, rehearsal, ended)) return null
  if (queue.device === null) return PRINT_FLOAT_TEXT.noDevice
  const issue = queue.issue === undefined || queue.issue === null ? null : PRINT_ISSUE_TEXT[queue.issue]
  if (issue !== null) return issue
  if (!queue.device.live) return PRINT_FLOAT_TEXT.deviceOff
  if (!queue.device.printerConnected || pause === 'DISCONNECTED') return PRINT_FLOAT_TEXT.lost
  return PRINT_FLOAT_TEXT.printerError
}

/** 떠 있는 알림 (급한 것부터): 프린터 → 1등 정하기 → 취소 요청 → 등록 안 된 번호 */
export function floatAlerts(input: { readonly counts: AlertCounts; readonly queue: QueueSummary | null; readonly rehearsal: boolean; readonly ended: boolean; readonly unlisted: number }): FloatAlert[] {
  const out: FloatAlert[] = []
  const printer = printerFloatText(input.queue, input.rehearsal, input.ended)
  if (printer !== null) out.push({ key: 'printer', text: printer, action: 'labels' })
  if (input.counts.conflict + input.counts.succession > 0) out.push({ key: 'decide', text: DECIDE_FLOAT_TEXT, action: 'decide' })
  if (input.counts.cancelRequest > 0) out.push({ key: 'cancel', text: cancelFloatText(input.counts.cancelRequest), action: 'decide' })
  if (input.unlisted > 0) out.push({ key: 'unlisted', text: unlistedFloatText(input.unlisted), action: 'unlisted' })
  return out
}

/** 캡슐 높이·사이 (아래 단추와 같은 44) */
export const FLOAT_ALERT_HEIGHT = 44
export const FLOAT_ALERT_GAP = SPACE.sm

/** 오른쪽 아래 빨간 캡슐들 — bottom: 맨 아래 캡슐의 아래 자리 */
export function AlertFloat({ items, bottom, onAction }: { readonly items: readonly FloatAlert[]; readonly bottom: number; readonly onAction: (action: FloatAction) => void }) {
  const { p, tones } = useKit()
  if (items.length === 0) return null
  const pair = tones.danger
  return (
    <View aria-label="알림" role="region" testID="alert-float" pointerEvents="box-none" style={{ position: 'absolute', right: SPACE.xl, bottom, maxWidth: '86%', alignItems: 'flex-end', gap: FLOAT_ALERT_GAP }}>
      {items.map((item) => (
        <Tap
          key={item.key}
          role="button"
          aria-label={item.text}
          onPress={() => onAction(item.action)}
          pressScale={0.96}
          style={({ pressed }) => ({
            minHeight: FLOAT_ALERT_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SPACE.xs,
            paddingLeft: SPACE.lg,
            paddingRight: SPACE.md,
            borderRadius: RADIUS.pill, borderCurve: 'continuous',
            backgroundColor: pressed ? pressedFill(p, pair.bg) : pair.bg,
            shadowColor: '#000000',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 4,
          })}
        >
          <Txt step="bodyLarge" weight="bold" ink={pair.fg} numberOfLines={1}>{item.text}</Txt>
          <View aria-hidden style={{ width: 16, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevron" color={pair.fg} size={16} />
          </View>
        </Tap>
      ))}
    </View>
  )
}
