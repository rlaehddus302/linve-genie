// 라벨·프린터 (LBL-06·LBL-10, LABEL_RULES L-7·L-11, 웹 LabelsPage와 같은 낱말): 프린터 연결(판매자가 누를 때만) → "이 기기에서 출력" → 대기열 요약 →
// 출력 멈추기/다시 시작 → 테스트 인쇄 → 인쇄 농도. 아이폰 앱도 BLE로 바로 연결한다(APP-03 — UNSUPPORTED가 아니다).
import { useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { isApiError } from '../api/client.ts'
import { CONNECTION_STATE_WORD, PRINT_ACTION, RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import type { Tone } from '../ui/theme.ts'
import { BigButton, Body, Card, Field, Hint, Notice, Row, Screen, SectionTitle, Tag } from '../ui/parts.tsx'

const STATE_TONE: Readonly<Record<keyof typeof CONNECTION_STATE_WORD, Tone>> = { DISCONNECTED: 'danger', CONNECTING: 'info', CONNECTED: 'success', PRINTING: 'info' }
export const DEVICE_NAME_MAX = 20
export const KEEP_SCREEN_ON = '출력하는 동안 이 화면을 켜 두세요.'
export const TEST_QUESTION = '테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?'
export const replaceQuestion = (name: string): string => `지금은 다른 기기 '${name}'에서 출력하고 있어요. 이 기기로 바꿀까요?`

export function LabelsScreen({ onBack }: { readonly onBack: () => void }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [name, setName] = useState('내 휴대폰')
  const [taken, setTaken] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const queue = snapshot.queue

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
    <Screen title="라벨" testID="labels-screen">
      <BigButton small label="← 목록" ariaLabel="방송 목록으로" onPress={onBack} />
      {snapshot.loadError !== null ? (
        <Row wrap>
          <Notice tone="danger" alert>
            {snapshot.loadError.message}
          </Notice>
          <BigButton small label={RETRY_NOW} onPress={() => void labels.reload()} />
        </Row>
      ) : null}
      {queue !== null && !queue.labelsEnabled ? <Notice tone="info">라벨 쓰지 않음 — 설정에서 켤 수 있어요.</Notice> : null}

      <Card label="프린터">
        <SectionTitle>프린터</SectionTitle>
        <Row wrap>
          <Tag tone={STATE_TONE[snapshot.printer]}>{CONNECTION_STATE_WORD[snapshot.printer]}</Tag>
          <Body muted>{snapshot.job === null ? '' : '라벨을 찍는 중이에요'}</Body>
        </Row>
        <Row wrap>
          {snapshot.printer === 'DISCONNECTED' ? <BigButton label={labels.getSnapshot().printer === 'DISCONNECTED' && snapshot.printerError !== null ? PRINT_ACTION.reconnect : '블루투스로 연결'} primary disabled={busy} onPress={() => void run(() => labels.connect())} /> : null}
          {snapshot.printer === 'CONNECTED' ? <BigButton label="연결 끊기" disabled={busy} onPress={() => void run(() => labels.disconnect())} /> : null}
          {snapshot.printer === 'CONNECTED' ? (
            <BigButton
              label="테스트 인쇄"
              disabled={busy || snapshot.job !== null}
              onPress={() =>
                void run(async () => {
                  const ok = await labels.printTest()
                  if (ok) setMessage({ tone: 'info', text: TEST_QUESTION })
                })
              }
            />
          ) : null}
        </Row>
        {snapshot.printerError !== null ? (
          <Notice tone="danger" alert>
            {snapshot.printerError.message}
          </Notice>
        ) : null}
        <Row wrap>
          <Body>인쇄 농도</Body>
          {[1, 2, 3, 4, 5].map((level) => (
            <BigButton key={level} small primary={snapshot.density === level} label={String(level)} ariaLabel={`인쇄 농도 ${String(level)}`} onPress={() => labels.setDensity(level)} />
          ))}
        </Row>
      </Card>

      <Card label="출력 기기">
        <SectionTitle>출력 기기</SectionTitle>
        {queue === null ? <Hint>불러오는 중…</Hint> : queue.device === null ? <Body>출력 기기 없음</Body> : snapshot.mine ? <Body bold>{`이 기기가 출력 기기예요 · ${queue.device.name}`}</Body> : <Body>{`출력 기기: ${queue.device.name}${queue.device.live ? '' : ' (연결되어 있지 않아요)'}`}</Body>}
        {!snapshot.mine ? (
          <>
            <Field label="기기 이름" value={name} onChangeText={setName} maxLength={DEVICE_NAME_MAX} />
            <BigButton label={PRINT_ACTION.thisDevice} primary disabled={busy} onPress={() => void become(false)} />
            {taken !== null ? (
              <View role="dialog" aria-label="출력 기기 바꾸기" style={{ gap: 8 }}>
                <Body>{replaceQuestion(taken)}</Body>
                <Row>
                  <BigButton label="이 기기로 바꾸기" primary disabled={busy} onPress={() => void become(true)} />
                  <BigButton label="아니요" onPress={() => setTaken(null)} />
                </Row>
              </View>
            ) : null}
          </>
        ) : (
          <BigButton label={PRINT_ACTION.release} disabled={busy} onPress={() => void run(() => labels.release())} />
        )}
        {snapshot.mine ? <Hint>{KEEP_SCREEN_ON} 다른 앱으로 가 있어도 프린터 연결은 끊지 않아요.</Hint> : null}
      </Card>

      <Card label="대기열">
        <SectionTitle>대기열</SectionTitle>
        {queue === null ? (
          <Hint>불러오는 중…</Hint>
        ) : (
          <>
            <Body>{`대기 ${String(queue.waiting)}장 · 출력 중 ${String(queue.printing)}장 · 버릴 라벨 ${String(queue.discard)}장 · 이 앱에서 찍은 ${String(snapshot.printed)}장`}</Body>
            {queue.pause !== null ? (
              <Notice tone="danger" alert>
                {`출력 멈춤 · ${queue.pause.message}`}
              </Notice>
            ) : null}
            <Row wrap>
              {queue.pause === null ? <BigButton label={PRINT_ACTION.pause} disabled={busy} onPress={() => void run(() => labels.pause())} /> : <BigButton label={PRINT_ACTION.restart} primary disabled={busy} onPress={() => void run(() => labels.restart())} />}
            </Row>
          </>
        )}
      </Card>
      {message !== null ? (
        <Notice tone={message.tone} alert={message.tone === 'danger'}>
          {message.text}
        </Notice>
      ) : null}
    </Screen>
  )
}
