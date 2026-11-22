// 라벨·프린터 (LBL-06·LBL-10, LABEL_RULES L-7·L-11, 웹 LabelsPage와 같은 낱말): 프린터 연결(판매자가 누를 때만) → "이 기기에서 출력" → 대기열 요약 →
// (멈췄으면) 다시 시작 → 테스트 인쇄 → 인쇄 농도. 아이폰 앱도 BLE로 바로 연결한다(APP-03 — UNSUPPORTED가 아니다).
// - "다시 연결"은 기억한 프린터로(앱을 다시 켠 뒤에도 고르기 창 없이), "블루투스로 연결"은 늘 고르기 창(다른 프린터로 바꾸는 길) — L-7.
// - 서버가 시험 모드일 때만 "시험용 프린터 — 실제로 출력되지 않아요"(L-11 15).
// - 저절로 다시 잇는 동안·그친 뒤 한 줄(웹과 같은 문장, L-11 8). 인쇄 농도 칸은 연결한 프린터의 범위(B1 1~5 · YXQ 1~3), 농도가 없는 프린터면 숨긴다.
// - 연결된 프린터는 테스트 없이 사용한다. 테스트 인쇄는 판매자가 원할 때 한 장만 요청한다.
// - 한 화면 두 칸으로 줄임 (D-PRNUX-01, 사용자 "블루투스로 연결·다시 연결이 뭔 차이인지, 출력 기기·대기열은 왜 있는지"):
//   프린터 칸은 주 단추 하나([다시 연결] — 기억한 프린터가 없으면 [프린터 연결]) + 글자 단추 "다른 프린터 고르기", 테스트 라벨 보내기는 문제가 있을 때만,
//   농도는 이어졌을 때만. 옛 "출력 기기"·"대기열" 칸은 "라벨 출력" 한 칸(누가 출력하는지 · 기다리는 장 수 · 멈춤), 기기 이름 칸 없음(기기 종류로),
//   끊김 멈춤에는 [다시 시작]을 두지 않는다(프린터를 이으면 저절로 풀리고, 끊긴 채 누르면 서버가 거절한다).
// - 토스식 다듬기 (D-UX3-94): 쪽 여백 20·흰 카드, 카드 이름은 회색 본문(상태 꼬리표는 오른쪽), 단추는 둘씩 좌우로(부정·보조 왼쪽, 주 단추 오른쪽 —
//   옛: "예" 왼쪽·"아니요" 오른쪽, 단추가 줄 넘김으로 쌓임), 곁길 일(시험용 프린터·테스트 라벨 보내기·다시 불러오기)은 글자 단추, 농도는 알약.
import { printerProfile, printerSupportStage } from '@livejjim/printer'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import { withPickWindow } from '../native/printer-pick.ts'
import { isApiError } from '../api/client.ts'
import { LOW_PAPER, labelPaper, useLabelPaper } from '../lib/label-paper.ts'
import { testHelp } from '../lib/test-help.ts'
import { keepReconnectingMessage } from '../lib/print-words.ts'
import { AUTO_RECONNECT_GAVE_UP, CONNECTION_STATE_WORD, PRINT_ACTION, RETRY_NOW, TEST_CONFIRMED_PAST, TEST_PRINTER_METHOD, autoReconnectingMessage } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import type { Tone } from '../ui/theme.ts'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, ButtonRow, Card, GUTTER, SPACE, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { Field, Notice, Tag } from '../ui/parts.tsx'
import { TextAction } from './ParcelAddress.tsx'

const STATE_TONE: Readonly<Record<keyof typeof CONNECTION_STATE_WORD, Tone>> = { DISCONNECTED: 'danger', CONNECTING: 'info', CONNECTED: 'success', PRINTING: 'info' }
export const DEVICE_NAME_MAX = 20
export const KEEP_SCREEN_ON = '출력하는 동안 이 화면을 켜 두세요.'
export const TEST_QUESTION = '테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?'
export const replaceQuestion = (name: string): string => `지금은 다른 기기 '${name}'에서 출력하고 있어요. 이 기기로 바꿀까요?`
export const BLUETOOTH_METHOD = '블루투스로 연결'
/** 기억한 프린터가 없을 때의 주 단추 (D-PRNUX-01) */
export const CONNECT_PRINTER = '프린터 연결'
/** 기억한 프린터가 있을 때 고르기 창으로 가는 글자 단추 (옛 [블루투스로 연결] — D-PRNUX-01) */
export const PICK_OTHER_PRINTER = '다른 프린터 고르기'
export const OUTPUT_CARD_TITLE = '라벨 출력'
/** 출력 기기 이름은 기기 종류로 (이름 칸 없음 — D-PRNUX-01) */
export const deviceDefaultName = (): string => (Platform.OS === 'ios' ? '아이폰' : '안드로이드 폰')
/** "라벨 출력" 칸 첫 줄 — 누가 출력하는지 (D-PRNUX-01) */
export function outputLine(device: { readonly name: string; readonly live: boolean } | null, mine: boolean): string {
  if (mine) return '이 휴대폰이 라벨을 받아 출력해요'
  if (device === null) return '라벨을 출력할 기기를 아직 정하지 않았어요'
  return `'${device.name}'에서 라벨을 출력해요${device.live ? '' : ' · 지금 꺼져 있어요'}`
}
/** "라벨 출력" 칸 장 수 줄 — 0장인 칸은 빼고 (D-PRNUX-01) */
export function countLine(queue: { readonly waiting: number; readonly printing: number; readonly discard: number }): string {
  const parts = [queue.waiting === 0 ? '기다리는 라벨 없음' : `기다리는 라벨 ${String(queue.waiting)}장`]
  if (queue.printing > 0) parts.push(`찍는 중 ${String(queue.printing)}장`)
  if (queue.discard > 0) parts.push(`버릴 라벨 ${String(queue.discard)}장`)
  return parts.join(' · ')
}
export const JOB_CARD_TITLE = '찍는 중인 라벨'
/** 이은 프린터의 제조사 앱 이름 (모르면 "제조사 앱") — 단추 글이 어디로 보내는지 말한다 (UX-PRN2-007) */
export const fallbackAppName = (profileId: string | null): string => (profileId === null ? undefined : printerProfile(profileId))?.fallbackApp ?? '제조사 앱'
/** 프린터 칸의 테스트 라벨 보내기 단추 글 (UX-PRN2-007) */
export const testShareLabel = (app: string): string => `테스트 라벨을 ${app}으로 보내기`
/** "찍는 중인 라벨" 칸의 작업 보내기 단추 글 — 무엇을(번호)·어디로 (UX-PRN2-007) */
export function jobShareLabel(job: { readonly kind: string; readonly label: { readonly no: number | null } }, app: string): string {
  return job.kind === 'product' && job.label.no !== null ? `이 라벨(${String(job.label.no)}번)을 ${app}으로 보내기` : `이 라벨을 ${app}으로 보내기`
}
export const JOB_SHARE_HINT = '잘 안 찍히면 이 라벨 그림을 제조사 앱으로 보내 인쇄할 수 있어요. 보내도 출력한 것으로 치지 않아요.'

/** 농도 단추 (범위 안의 정수) */
const densityLevels = (range: { readonly min: number; readonly max: number }): number[] => Array.from({ length: Math.max(0, range.max - range.min + 1) }, (_, i) => range.min + i)

function PaperSettings({ deviceId }: { readonly deviceId: string }) {
  const remaining = useLabelPaper(deviceId)
  const [text, setText] = useState('')
  const [error, setError] = useState(false)
  const save = async (value: number | null) => {
    try {
      await labelPaper.update(deviceId, value)
      setText('')
      setError(false)
    } catch { setError(true) }
  }
  return (
    <View style={{ gap: SPACE.sm }}>
      <Field label="남은 라벨 용지 (장)" hint="현재 장수를 입력하면 이 휴대폰에서 출력할 때마다 차감하고, 10장 이하일 때 알려드려요."
        value={text} keyboardType="number-pad" maxLength={5} onChangeText={setText} />
      {remaining !== null ? <Notice tone={remaining <= LOW_PAPER ? 'warning' : 'info'}>{`예상 잔량 약 ${remaining}장`}</Notice> : null}
      {error ? <Notice tone="danger">장수를 저장하지 못했어요. 다시 눌러 주세요.</Notice> : null}
      <ButtonRow>
        {remaining !== null ? <BigButton kind="outline" label="알림 끄기" onPress={() => void save(null)} /> : null}
        <BigButton label="장수 저장" disabled={!/^\d{1,5}$/.test(text)} onPress={() => void save(Number(text))} />
      </ButtonRow>
    </View>
  )
}

/** onBack이 없으면 아래 탭 화면(라벨 탭, D-UX3-01) — 뒤로 단추 없이 제목만 */
export function LabelsScreen({ onBack }: { readonly onBack?: () => void }) {
  const { labels } = useServices()
  const { p } = useKit()
  const room = useTabBarRoom()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const name = deviceDefaultName()
  const [taken, setTaken] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const queue = snapshot.queue
  const disconnected = snapshot.printer === 'DISCONNECTED'
  // 기억한 프린터가 있으면 "다시 연결"이 이 칸의 주 버튼 (고르기 창 없이 — L-7)
  const showReconnect = disconnected && snapshot.hasRemembered
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const profile = linked && snapshot.profileId !== null ? printerProfile(snapshot.profileId) : undefined
  const experimental = linked && printerSupportStage(snapshot.profileId) === 'EXPERIMENTAL'
  // 테스트 결과 "아니요" (도움말을 보인다 — UX-PRN2-001). 테스트를 다시 하거나 결과가 사라지면 지운다
  const [answeredNo, setAnsweredNo] = useState(false)
  useEffect(() => {
    if (snapshot.testing || !snapshot.testPrinted) setAnsweredNo(false)
  }, [snapshot.testing, snapshot.testPrinted])
  const app = fallbackAppName(linked ? snapshot.profileId : null)
  const help = testHelp(snapshot.profileId, snapshot.testSize ?? profile?.defaultSize ?? '50x30')
  // 테스트 라벨을 제조사 앱으로 보내기는 바로 찍기에 문제가 있을 때만 (실험 기종·테스트 "아니요"·프린터 오류 — D-PRNUX-01, 옛: 끊겨 있어도 늘)
  const showTestShare = experimental || answeredNo || snapshot.printerError !== null
  const printTest = () =>
    void run(async () => {
      await labels.printTest()
    })

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await work()
    } catch (caught) {
      setMessage({ tone: 'danger', text: isApiError(caught) ? caught.message : '하지 못했어요. 다시 눌러 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  const become = (replace: boolean) =>
    run(async () => {
      const trimmed = name.trim().slice(0, DEVICE_NAME_MAX)
      if (trimmed === '') {
        setMessage({ tone: 'danger', text: '기기 이름을 적어 주세요.' })
        return
      }
      const outcome = await labels.become(trimmed, replace)
      if (outcome.kind === 'taken') setTaken(outcome.name)
      else if (outcome.kind === 'error') setMessage({ tone: 'danger', text: outcome.error.message })
      else {
        setTaken(null)
        setMessage({ tone: 'success', text: `이제 이 기기('${trimmed}')에서 라벨을 출력해요. ${KEEP_SCREEN_ON}` })
      }
    })

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <AppHeader title="라벨·프린터" {...(onBack === undefined ? {} : { onBack })} />
      <ScrollView testID="labels-screen" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.lg }} scrollIndicatorInsets={{ bottom: room }} keyboardShouldPersistTaps="handled">
        {snapshot.loadError !== null ? (
          <View style={{ gap: SPACE.xs }}>
            <Notice tone="danger" alert>
              {snapshot.loadError.message}
            </Notice>
            <TextAction label={RETRY_NOW} chevron={false} onPress={() => void labels.reload()} />
          </View>
        ) : null}
        {queue !== null && !queue.labelsEnabled ? <Notice tone="info">라벨을 쓰지 않게 해 두었어요. 설정에서 켤 수 있어요.</Notice> : null}

        <Card label="프린터">
          <CardHead title="프린터" right={<Tag tone={STATE_TONE[snapshot.printer]}>{CONNECTION_STATE_WORD[snapshot.printer]}</Tag>} />
          {profile !== undefined || (snapshot.target === 'test' && snapshot.printer !== 'DISCONNECTED') || snapshot.job !== null ? (
            <View style={{ gap: 2 }}>
              {profile !== undefined ? <Txt step="bodyLarge" weight="book">{`프린터 이름: ${profile.displayName}`}</Txt> : null}
              {snapshot.target === 'test' && snapshot.printer !== 'DISCONNECTED' ? <Txt step="caption" color="textSub">시험용 프린터</Txt> : null}
              {snapshot.job !== null ? <Txt step="caption" color="textSub">라벨을 찍는 중이에요</Txt> : null}
            </View>
          ) : null}
          {snapshot.autoReconnect?.kind === 'trying' && snapshot.autoReconnect.total !== null ? <Notice tone="info">{autoReconnectingMessage(snapshot.autoReconnect.attempt, snapshot.autoReconnect.total)}</Notice> : null}
          {/* 방송 중에는 그치지 않는다 — 총 횟수 없이 몇 번째인지만 (F2, D-RETRO-42) */}
          {snapshot.autoReconnect?.kind === 'trying' && snapshot.autoReconnect.total === null && snapshot.live === true ? <Notice tone="info">{keepReconnectingMessage(snapshot.autoReconnect.attempt)}</Notice> : null}
          {snapshot.autoReconnect?.kind === 'gaveUp' && disconnected ? (
            <Notice tone="danger" alert>
              {AUTO_RECONNECT_GAVE_UP}
            </Notice>
          ) : null}
          {/* 끊김: 주 단추 하나 — 기억한 프린터가 있으면 [다시 연결](고르기 창 없이), 없으면 [프린터 연결](고르기 창). 다른 프린터는 아래 글자 단추 (D-PRNUX-01).
              이어짐: [연결 끊기] 왼쪽 · [테스트 인쇄] 오른쪽 */}
          {disconnected ? (
            showReconnect ? (
              <BigButton label={PRINT_ACTION.reconnect} disabled={busy} onPress={() => void run(() => withPickWindow(() => labels.reconnect()))} />
            ) : (
              <BigButton label={CONNECT_PRINTER} disabled={busy} onPress={() => void run(() => withPickWindow(() => labels.connect('bluetooth')))} />
            )
          ) : null}
          {snapshot.printer === 'CONNECTED' ? (
            <ButtonRow>
              <BigButton kind="outline" label="연결 끊기" disabled={busy} onPress={() => void run(() => labels.disconnect())} />
              <BigButton kind="secondary" label="테스트 인쇄" disabled={busy || snapshot.testing || snapshot.busy || snapshot.job !== null} onPress={printTest} />
            </ButtonRow>
          ) : null}
          {(disconnected && (snapshot.testPrinter || showReconnect)) || showTestShare ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: SPACE.xs }}>
              {/* 보이는 글은 짧게(한글이 낱말 가운데서 끊기지 않게), 뜻 전체는 이름과 아래 한 줄로 */}
              {showReconnect ? <TextAction label={PICK_OTHER_PRINTER} disabled={busy} onPress={() => void run(() => withPickWindow(() => labels.connect('bluetooth')))} /> : null}
              {disconnected && snapshot.testPrinter ? <TextAction label="시험용 프린터" ariaLabel={TEST_PRINTER_METHOD} disabled={busy} onPress={() => void run(() => labels.connect('test'))} /> : null}
              {showTestShare ? <TextAction label={testShareLabel(app)} disabled={busy} onPress={() => void run(async () => void (await labels.shareTest()))} /> : null}
            </View>
          ) : null}
          {disconnected && snapshot.testPrinter ? <Txt step="caption" color="textSub">시험용 프린터는 실제로 출력되지 않아요.</Txt> : null}
          {snapshot.testPrinted && linked ? (
            <View role="group" aria-label="테스트 인쇄 결과" style={{ gap: SPACE.md, padding: SPACE.lg, borderRadius: 16, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
              <Txt step="bodyLarge" weight="medium">{TEST_QUESTION}</Txt>
              {/* 아니요 왼쪽 · 예 오른쪽 (D-UX4-01 — 옛: 예 왼쪽) */}
              <ButtonRow>
                <BigButton
                  kind="outline"
                  label="아니요"
                  onPress={() => {
                    setAnsweredNo(true)
                    labels.answerTest(false)
                  }}
                />
                <BigButton kind={snapshot.testConfirmed ? 'primary' : 'secondary'} label="예" onPress={() => labels.answerTest(true)} />
              </ButtonRow>
              {snapshot.testConfirmed ? <Txt>{snapshot.mine ? TEST_CONFIRMED_PAST : `좋아요. 이 기기에서 출력하려면 "${PRINT_ACTION.thisDevice}" 버튼을 눌러 주세요.`}</Txt> : null}
              {answeredNo && !snapshot.testConfirmed ? (
                <View role="list" aria-label="테스트 인쇄 도움말" style={{ gap: SPACE.xs }}>
                  {help.lines.map((line) => (
                    <View key={line} role="listitem">
                      <Txt>{line}</Txt>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {snapshot.printerError !== null ? (
            <Notice tone="danger" alert>
              {snapshot.printerError.message}
            </Notice>
          ) : null}
          {labels.paperDeviceId != null ? <PaperSettings key={labels.paperDeviceId} deviceId={labels.paperDeviceId} /> : null}
          {/* 농도는 이어졌을 때만 (D-PRNUX-01) */}
          {linked && snapshot.densityRange !== null ? (
            <View style={{ gap: SPACE.sm }}>
              <Txt color="textSub">인쇄 농도</Txt>
              {/* 숫자 알약은 한 줄에 — 마지막 숫자만 다음 줄로 떨어지지 않게 */}
              <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                {densityLevels(snapshot.densityRange).map((level) => (
                  <Pill key={level} on={snapshot.density === level} label={String(level)} ariaLabel={`인쇄 농도 ${String(level)}`} onPress={() => labels.setDensity(level)} />
                ))}
              </View>
            </View>
          ) : null}
        </Card>

        {/* 옛 "출력 기기"·"대기열" 두 칸을 한 칸으로 (D-PRNUX-01): 누가 출력하는지 → 기다리는 장 수 → 멈춤 → 단추 */}
        <Card label={OUTPUT_CARD_TITLE}>
          <CardHead title={OUTPUT_CARD_TITLE} />
          {/* 불러오는 동안은 비워 둔다 (D-UX4-83) */}
          {queue === null ? null : (
            <>
              <View style={{ gap: 2 }}>
                <Txt step="bodyLarge" weight="medium">{outputLine(queue.device, snapshot.mine)}</Txt>
                <Txt color="textSub">{countLine(queue)}</Txt>
              </View>
              {/* 이 기기의 프린터가 끊겨 멈췄으면 위 [다시 연결]이 푸는 길 — 빨간 줄·[다시 시작] 대신 한 줄 안내 (D-PRNUX-01) */}
              {queue.pause !== null && snapshot.mine && queue.pause.reason === 'DISCONNECTED' ? (
                <Notice tone="warning">프린터를 다시 연결하면 이어서 출력해요.</Notice>
              ) : queue.pause !== null ? (
                <>
                  <Notice tone="danger" alert>
                    {`출력 멈춤 · ${queue.pause.message}`}
                  </Notice>
                  {/* [출력 멈추기]는 없앴다 — 라벨 출력 켜고 끄기로 대신한다 (D-PRINTOFF-01). 멈춰 있으면(실패·옛 멈춤) [다시 시작]만 */}
                  <BigButton kind="primary" label={PRINT_ACTION.restart} disabled={busy} onPress={() => void run(() => labels.restart())} />
                </>
              ) : null}
              {!snapshot.mine ? (
                <>
                  <BigButton kind={queue.pause === null ? 'primary' : 'secondary'} label={PRINT_ACTION.thisDevice} disabled={busy} onPress={() => void become(false)} />
                  {taken !== null ? (
                    <View role="dialog" aria-label="출력 기기 바꾸기" style={{ gap: SPACE.md }}>
                      <Txt>{replaceQuestion(taken)}</Txt>
                      {/* 아니요 왼쪽 · 바꾸기 오른쪽 (D-UX4-01 — 옛: 바꾸기 왼쪽) */}
                      <ButtonRow>
                        <BigButton kind="outline" label="아니요" onPress={() => setTaken(null)} />
                        <BigButton label="이 기기로 바꾸기" disabled={busy} onPress={() => void become(true)} />
                      </ButtonRow>
                    </View>
                  ) : null}
                </>
              ) : (
                <View style={{ gap: SPACE.xs }}>
                  <Txt step="caption" color="textSub">{`${KEEP_SCREEN_ON} 다른 앱으로 가 있어도 프린터 연결은 끊지 않아요.`}</Txt>
                  <TextAction label={PRINT_ACTION.release} chevron={false} disabled={busy} onPress={() => void run(() => labels.release())} />
                </View>
              )}
            </>
          )}
        </Card>

        {/* 이 기기가 받은 작업(지금 찍는 장)만: 그 라벨 그림을 제조사 앱으로 (D-PRN2-28). 보내도 출력한 것으로 치지 않는다(LBL-07 — 상태·결과 그대로) */}
        {snapshot.mine && snapshot.job !== null ? (
          <Card label={JOB_CARD_TITLE}>
            <CardHead title={JOB_CARD_TITLE} />
            <Txt>{JOB_SHARE_HINT}</Txt>
            <BigButton kind="outline" label={jobShareLabel(snapshot.job, app)} disabled={busy} onPress={() => void run(async () => void (await labels.shareJob()))} />
          </Card>
        ) : null}
        {message !== null ? (
          <Notice tone={message.tone} alert={message.tone === 'danger'}>
            {message.text}
          </Notice>
        ) : null}
      </ScrollView>
    </View>
  )
}

/** 카드 이름 (홈 "내 방송"처럼 회색 본문, D-UX3-94) + 오른쪽 조각 */
function CardHead({ title, right }: { readonly title: string; readonly right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, minHeight: 24 }}>
      <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
        {title}
      </Txt>
      {right}
    </View>
  )
}
