// 라벨·프린터 (LBL-06·LBL-10, LABEL_RULES L-7·L-11, 웹 LabelsPage와 같은 낱말): 프린터 연결(판매자가 누를 때만) → "이 기기에서 출력" → 대기열 요약 →
// 출력 멈추기/다시 시작 → 테스트 인쇄 → 인쇄 농도. 아이폰 앱도 BLE로 바로 연결한다(APP-03 — UNSUPPORTED가 아니다).
// - "다시 연결"은 기억한 프린터로(앱을 다시 켠 뒤에도 고르기 창 없이), "블루투스로 연결"은 늘 고르기 창(다른 프린터로 바꾸는 길) — L-7.
// - 서버가 시험 모드일 때만 "시험용 프린터 — 실제로 출력되지 않아요"(L-11 15).
// - 저절로 다시 잇는 동안·그친 뒤 한 줄(웹과 같은 문장, L-11 8). 인쇄 농도 칸은 연결한 프린터의 범위(B1 1~5 · YXQ 1~3), 농도가 없는 프린터면 숨긴다.
// - 지원 단계 (PRN2 L-7): 연결 뒤 프린터 이름만 — '기본·실험'으로 나눠 보이지 않는다(D-UX3-19, 옛: 이름 뒤 "(실험)"과 안내 한 줄). 확인이 덜 된 기종이 이어져 있으면
//   "이 기기에서 출력"은 그 연결에서 테스트 인쇄를 하고 "예"를 누른 뒤에만 보인다. "제조사 앱으로 보내기"는 서버가 만든 그림 파일을 공유 창으로
//   (테스트 라벨, 그리고 이 기기가 받은 작업이 있으면 "찍는 중인 라벨" 칸에서 그 작업 — 상태·결과는 그대로, D-PRN2-28).
// - 토스식 다듬기 (D-UX3-94): 쪽 여백 20·흰 카드, 카드 이름은 회색 본문(상태 꼬리표는 오른쪽), 단추는 둘씩 좌우로(부정·보조 왼쪽, 주 단추 오른쪽 —
//   옛: "예" 왼쪽·"아니요" 오른쪽, 단추가 줄 넘김으로 쌓임), 곁길 일(시험용 프린터·테스트 라벨 보내기·다시 불러오기)은 글자 단추, 농도는 알약.
import { printerProfile, printerSupportStage } from '@livejjim/printer'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { isApiError } from '../api/client.ts'
import { awaitingTest } from '../lib/label-queue.ts'
import { testHelp } from '../lib/test-help.ts'
import { AUTO_RECONNECT_GAVE_UP, CONNECTION_STATE_WORD, EXPERIMENTAL_PAUSED, EXPERIMENTAL_RESUMED, EXPERIMENTAL_WAIT_TEST, EXPERIMENTAL_WAIT_TEST_MINE, PRINT_ACTION, RETRY_NOW, TEST_CONFIRMED_PAST, TEST_PRINTER_METHOD, autoReconnectingMessage } from '../lib/words.ts'
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

/** onBack이 없으면 아래 탭 화면(라벨 탭, D-UX3-01) — 뒤로 단추 없이 제목만 */
export function LabelsScreen({ onBack }: { readonly onBack?: () => void }) {
  const { labels } = useServices()
  const { p } = useKit()
  const room = useTabBarRoom()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [name, setName] = useState('내 휴대폰')
  const [taken, setTaken] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const queue = snapshot.queue
  const disconnected = snapshot.printer === 'DISCONNECTED'
  // 기억한 프린터가 있으면 "다시 연결"이 이 칸의 주 버튼 (고르기 창 없이 — L-7)
  const showReconnect = disconnected && snapshot.hasRemembered
  // 지원 단계 (L-7): 실험 기종이 이어져 있으면 테스트 인쇄 "예" 뒤에만 "이 기기에서 출력"
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const profile = linked && snapshot.profileId !== null ? printerProfile(snapshot.profileId) : undefined
  const experimental = linked && printerSupportStage(snapshot.profileId) === 'EXPERIMENTAL'
  const canBecome = !experimental || snapshot.testConfirmed
  // 이 기기의 실험 기종이 테스트 "예"를 기다리는 끊김 멈춤: 프린터는 이어져 있다 — 까닭과 할 일로 (D-PRN2-10)
  const waitTest = snapshot.mine && queue?.pause?.reason === 'DISCONNECTED' && awaitingTest(snapshot)
  // 테스트 결과 "아니요" (도움말을 보인다 — UX-PRN2-001). 테스트를 다시 하거나 결과가 사라지면 지운다
  const [answeredNo, setAnsweredNo] = useState(false)
  useEffect(() => {
    if (snapshot.testing || !snapshot.testPrinted) setAnsweredNo(false)
  }, [snapshot.testing, snapshot.testPrinted])
  const app = fallbackAppName(linked ? snapshot.profileId : null)
  const help = testHelp(snapshot.profileId, snapshot.testSize ?? profile?.defaultSize ?? '50x30')
  // 테스트 라벨 보내기는 쓸 때만: 끊겨 있거나(그림 파일로만 프린터) 실험 기종이 이어졌거나 "아니요"·프린터 오류 뒤 (UX-PRN2-007)
  const showTestShare = !linked || experimental || answeredNo || snapshot.printerError !== null
  // "예" 뒤 다른 까닭으로 다시 멈췄으면 "이어서 해요"는 지난 일 (UX-PRN2-006)
  const pausedAgain = queue?.pause != null && queue.pause.reason !== 'DISCONNECTED'
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
          {snapshot.autoReconnect?.kind === 'gaveUp' && disconnected ? (
            <Notice tone="danger" alert>
              {AUTO_RECONNECT_GAVE_UP}
            </Notice>
          ) : null}
          {/* 끊김: [블루투스로 연결] 왼쪽 · 기억한 프린터가 있으면 [다시 연결](주) 오른쪽. 이어짐: [연결 끊기] 왼쪽 · [테스트 인쇄] 오른쪽 */}
          {disconnected ? (
            <ButtonRow>
              <BigButton kind={showReconnect ? 'outline' : 'primary'} label={BLUETOOTH_METHOD} disabled={busy} onPress={() => void run(() => labels.connect('bluetooth'))} />
              {showReconnect ? <BigButton label={PRINT_ACTION.reconnect} disabled={busy} onPress={() => void run(() => labels.reconnect())} /> : null}
            </ButtonRow>
          ) : null}
          {snapshot.printer === 'CONNECTED' ? (
            <ButtonRow>
              <BigButton kind="outline" label="연결 끊기" disabled={busy} onPress={() => void run(() => labels.disconnect())} />
              <BigButton kind="secondary" label="테스트 인쇄" disabled={busy || snapshot.job !== null} onPress={printTest} />
            </ButtonRow>
          ) : null}
          {(disconnected && snapshot.testPrinter) || showTestShare ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: SPACE.xs }}>
              {/* 보이는 글은 짧게(한글이 낱말 가운데서 끊기지 않게), 뜻 전체는 이름과 아래 한 줄로 */}
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
              {snapshot.testConfirmed ? <Txt>{snapshot.mine && experimental ? (pausedAgain ? TEST_CONFIRMED_PAST : EXPERIMENTAL_RESUMED) : `좋아요. 이 기기에서 출력하려면 "${PRINT_ACTION.thisDevice}" 버튼을 눌러 주세요.`}</Txt> : null}
              {/* "아니요" 뒤 이 프린터에 맞는 도움말 — 실험 기종이면 맨 위가 제조사 앱으로 그림 파일 (웹과 같은 목록, UX-PRN2-001) */}
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
          {snapshot.densityRange !== null ? (
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

        <Card label="출력 기기">
          <CardHead title="출력 기기" />
          {queue === null ? null : queue.device === null ? <Txt step="bodyLarge" weight="book">출력 기기 없음</Txt> : snapshot.mine ? <Txt step="bodyLarge" weight="medium">{`이 기기가 출력 기기예요 · ${queue.device.name}`}</Txt> : <Txt step="bodyLarge" weight="book">{`출력 기기: ${queue.device.name}${queue.device.live ? '' : ' (연결되어 있지 않아요)'}`}</Txt>}
          {/* "이 기기에서 출력"이 왜 안 보이는지 — 핵심 문장이라 본문 크기 (UX-PRN2-008) */}
          {!snapshot.mine && !canBecome ? <Txt>{EXPERIMENTAL_WAIT_TEST}</Txt> : null}
          {/* 이미 출력 기기: 실험 기종은 이 연결에서 테스트 "예" 전까지 받지 않는다 (D-PRN2-10·15, 웹과 같다) */}
          {snapshot.mine && !canBecome ? <Txt>{EXPERIMENTAL_WAIT_TEST_MINE}</Txt> : null}
          {!snapshot.mine && canBecome ? (
            <>
              <Field label="기기 이름" value={name} onChangeText={setName} maxLength={DEVICE_NAME_MAX} />
              <BigButton label={PRINT_ACTION.thisDevice} disabled={busy} onPress={() => void become(false)} />
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
          ) : snapshot.mine ? (
            <BigButton kind="outline" label={PRINT_ACTION.release} disabled={busy} onPress={() => void run(() => labels.release())} />
          ) : null}
          {snapshot.mine ? <Txt step="caption" color="textSub">{`${KEEP_SCREEN_ON} 다른 앱으로 가 있어도 프린터 연결은 끊지 않아요.`}</Txt> : null}
        </Card>

        <Card label="대기열">
          <CardHead title="대기열" />
          {/* 불러오는 동안은 비워 둔다 (D-UX4-83) */}
          {queue === null ? null : (
            <>
              <Txt step="bodyLarge" weight="book">{`대기 ${String(queue.waiting)}장 · 출력 중 ${String(queue.printing)}장 · 버릴 라벨 ${String(queue.discard)}장 · 이 앱에서 찍은 ${String(snapshot.printed)}장`}</Txt>
              {queue.pause !== null ? (
                <Notice tone="danger" alert>
                  {`출력 멈춤 · ${waitTest ? EXPERIMENTAL_PAUSED : queue.pause.message}`}
                </Notice>
              ) : null}
              {/* 실험 기종 "예" 기다림: 멈춤 알림 바로 아래에서 테스트 인쇄(주, 오른쪽) (UX-PRN2-005) — 결과 "예/아니요"는 프린터 칸 */}
              <ButtonRow>
                {queue.pause === null ? <BigButton kind="outline" label={PRINT_ACTION.pause} disabled={busy} onPress={() => void run(() => labels.pause())} /> : <BigButton kind={waitTest ? 'outline' : 'primary'} label={PRINT_ACTION.restart} disabled={busy} onPress={() => void run(() => labels.restart())} />}
                {waitTest && snapshot.printer === 'CONNECTED' ? <BigButton label="테스트 인쇄" disabled={busy || snapshot.job !== null || snapshot.testing} onPress={printTest} /> : null}
              </ButtonRow>
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
