// 떠 있는 오류 알림 (D-ALERTFLOAT-01 → D-PRINTOFF-01): 라이브 화면 왼쪽 아래 캡슐 — 매출·합계 캡슐과 같은 크기, 옅은 빨강 바탕에 빨간 글과 꺾쇠.
// 사용자 지시 2026-11-17 "문구를 다음 6가지 빼고는 다 지워. 관련 기능을 통합하고 싶어서":
//   라벨 출력 기능이 꺼져 있어요 · 블루투스가 꺼져 있어요 · 프린터와 연결이 끊겼어요 · 라벨 출력에 실패했어요 · 찜 취소 요청 n건 · 등록 안 된 번호에 찜 n건
// - 프린터 쪽은 한 줄만(급한 것부터): 라벨 출력 꺼짐 → 블루투스 꺼짐(이 폰이 찍는 폰일 때) → 연결 끊김 → 출력 실패.
// - 블루투스·연결은 이 폰이 직접 본 상태로 정한다 — 이 폰이 찍는 폰(출력 기기)이거나 아직 찍는 폰이 없으면 이 폰의 블루투스·프린터 연결,
//   다른 기기가 찍는 폰이면 서버가 아는 그 기기의 연결.
// - 여럿이면 위아래로 놓는다(고르는 단추 묶음이 아니라 따로 처리하는 알림이라 D-UX4-01 좌우 규칙 밖, AUTO).
// - 뺀 것: 1등 정하기(앱에서는 충돌이 생기지 않고 승계 결정은 없앴다, D-SUCCESSION-01), 출력 멈춤(출력 멈추기를 없앰), 까닭별 문구·기기 앱 꺼짐(한 줄로 합침),
//   버릴 라벨·확인 필요(D-ALERTFLOAT-01).
import { View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import type { QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { ConnectionState } from '@livejjim/printer'
import type { LinkRadio } from '../../lib/print-cause.ts'
import { Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { FLOAT_PILL_GAP, FLOAT_PILL_HEIGHT } from './float-layout.ts'

/** 누르면 할 일 — 라이브 관리(라벨 출력 켜기) · 라벨·프린터 화면 · 정하기 판(취소 요청) · 등록 안 된 번호 */
export type FloatAction = 'manage' | 'labels' | 'decide' | 'unlisted'

export interface FloatAlert {
  readonly key: 'printer' | 'cancel' | 'unlisted'
  readonly text: string
  readonly action: FloatAction
}

export const FLOAT_TEXT = {
  labelsOff: '라벨 출력 기능이 꺼져 있어요',
  bluetoothOff: '블루투스가 꺼져 있어요',
  lost: '프린터와 연결이 끊겼어요',
  failed: '라벨 출력에 실패했어요',
} as const
export const cancelFloatText = (n: number): string => `찜 취소 요청 ${String(n)}건`
export const unlistedFloatText = (n: number): string => `등록 안 된 번호에 찜 ${String(n)}건`

/** 이 폰이 본 프린터 사정 (LabelQueue 스냅샷) */
export interface HerePrinter {
  /** 이 폰이 찍는 폰(출력 기기)인가 */
  readonly mine: boolean
  /** 이 폰의 프린터 연결 */
  readonly printer: ConnectionState
  /** 이 폰의 블루투스 */
  readonly radio: LinkRadio
}

/** 프린터 한 줄 (없으면 null) — 연습 방송·끝난 방송·요약을 모르면 없다 */
export function printerFloat(queue: QueueSummary | null, here: HerePrinter, rehearsal: boolean, ended: boolean): FloatAlert | null {
  if (rehearsal || ended || queue === null) return null
  if (!queue.labelsEnabled) return { key: 'printer', text: FLOAT_TEXT.labelsOff, action: 'manage' }
  // 이 폰이 찍는다(또는 찍을 폰이 아직 없다) — 이 폰의 블루투스·프린터로 본다
  const thisPhone = here.mine || queue.device === null
  if (thisPhone && (here.radio === 'off' || here.radio === 'unauthorized')) return { key: 'printer', text: FLOAT_TEXT.bluetoothOff, action: 'labels' }
  const linked = thisPhone ? here.printer === 'CONNECTED' || here.printer === 'PRINTING' : queue.device !== null && queue.device.live && queue.device.printerConnected
  if (!linked || queue.pause?.reason === 'DISCONNECTED') return { key: 'printer', text: FLOAT_TEXT.lost, action: 'labels' }
  // 프린터 오류·라벨을 못 만듦(옛 판매자 멈춤도 — 출력 멈추기는 없앴지만 남은 멈춤은 [다시 시작]으로 푼다)
  if (queue.pause !== null) return { key: 'printer', text: FLOAT_TEXT.failed, action: 'labels' }
  return null
}

/** 떠 있는 알림 (급한 것부터): 프린터 → 찜 취소 요청 → 등록 안 된 번호 */
export function floatAlerts(input: { readonly cancelRequests: number; readonly queue: QueueSummary | null; readonly here: HerePrinter; readonly rehearsal: boolean; readonly ended: boolean; readonly unlisted: number }): FloatAlert[] {
  const out: FloatAlert[] = []
  const printer = printerFloat(input.queue, input.here, input.rehearsal, input.ended)
  if (printer !== null) out.push(printer)
  if (input.cancelRequests > 0) out.push({ key: 'cancel', text: cancelFloatText(input.cancelRequests), action: 'decide' })
  if (input.unlisted > 0) out.push({ key: 'unlisted', text: unlistedFloatText(input.unlisted), action: 'unlisted' })
  return out
}

/** 캡슐 높이·사이 — 매출·합계 캡슐과 같다 */
export const FLOAT_ALERT_HEIGHT = FLOAT_PILL_HEIGHT
export const FLOAT_ALERT_GAP = FLOAT_PILL_GAP

/** 알림 색: 옅은 빨강 바탕 + 빨간 글 (D-PRINTOFF-01 — 옛 진한 빨강 바탕은 "너무 빨갛고", 그 전 분홍은 너무 옅었다) */
export const ALERT_COLORS = { bg: '#FBD3D1', pressed: '#F5BCB9', fg: '#B8121C' } as const

/** 왼쪽 아래 빨간 캡슐들 (D-PRINTOFF-01 — 둥근 단추는 오른쪽 아래). bottom: 맨 아래 캡슐의 아래 자리, right: 오른쪽 끝(둥근 단추 자리를 비운다) */
export function AlertFloat({ items, bottom, right, onAction }: { readonly items: readonly FloatAlert[]; readonly bottom: number; readonly right: number; readonly onAction: (action: FloatAction) => void }) {
  if (items.length === 0) return null
  return (
    <View aria-label="알림" role="region" testID="alert-float" pointerEvents="box-none" style={{ position: 'absolute', left: SPACE.xl, right, bottom, alignItems: 'flex-start', gap: FLOAT_ALERT_GAP }}>
      {items.map((item) => (
        <Tap
          key={item.key}
          role="button"
          aria-label={item.text}
          onPress={() => onAction(item.action)}
          pressScale={0.96}
          style={({ pressed }) => ({
            maxWidth: '100%',
            minHeight: FLOAT_ALERT_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: SPACE.xs,
            paddingLeft: SPACE.lg,
            paddingRight: SPACE.md,
            borderRadius: RADIUS.pill, borderCurve: 'continuous',
            backgroundColor: pressed ? ALERT_COLORS.pressed : ALERT_COLORS.bg,
            shadowColor: '#000000',
            shadowOpacity: 0.1,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          })}
        >
          <Txt step="body" weight="bold" ink={ALERT_COLORS.fg} numberOfLines={1}>{item.text}</Txt>
          <View aria-hidden style={{ width: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevron" color={ALERT_COLORS.fg} size={14} />
          </View>
        </Tap>
      ))}
    </View>
  )
}

/** 알림 캡슐 묶음 높이 (맨 아래 캡슐 아래 자리부터 맨 위 캡슐 위까지) */
export const alertStackHeight = (count: number): number => (count <= 0 ? 0 : count * FLOAT_ALERT_HEIGHT + (count - 1) * FLOAT_ALERT_GAP)
/** 흐림 막이 알림 위로 더 올라가는 길이 */
export const SCRIM_OVER = 28

/**
 * 알림 뒤 흐림 막 (D-ALERTSCRIM-01, 사용자 "에러 문구와 그 뒤에 글자가 겹쳐서 에러 문구 가독성이 떨어진다"): 화면 아래에서 맨 위 알림보다 조금 위까지,
 * 위는 투명 → 알림 자리부터 화면 바탕색으로 덮어 뒤 목록 글자(빨간 "상품명을 인식하지 못했어요"·이름 알약 등)가 캡슐 사이·옆으로 비치지 않게 한다.
 * 누름은 막지 않는다(뒤 목록을 그대로 누르고 밀 수 있다). top: 막 위끝의 화면 아래에서의 높이
 */
export function FloatScrim({ top }: { readonly top: number }) {
  const { p } = useKit()
  if (top <= 0) return null
  const solid = Math.min(0.99, Math.max(0, (top - SCRIM_OVER) / top))
  const fade = 1 - solid
  return (
    <View testID="alert-scrim" aria-hidden pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: top }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="alert-scrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.surface} stopOpacity={0} />
            <Stop offset={String(fade)} stopColor={p.surface} stopOpacity={0.94} />
            <Stop offset="1" stopColor={p.surface} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#alert-scrim)" />
      </Svg>
    </View>
  )
}
