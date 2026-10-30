// 설정 중 음성·라벨·휴대폰 알림 받기 (APP-01 화면 범위, SMS3 AC-SMS3-29). 나머지 설정은 "웹으로 열기". 로그아웃도 여기.
// - 음성: "번호와 가격이 들리면 바로 등록"(이 기기), 권한 설명 문장 보기.
// - 라벨: 라벨 기능 켬/끔(PUT /api/settings/labels), 1등 확정 때 라벨 자동 출력(PATCH /api/settings print.autoOnConfirm — 다음 방송부터).
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LabelSettings } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, patch, put } from '../api/client.ts'
import { openExternal, openWeb } from '../lib/open-web.ts'
import { OPEN_IN_WEB, VOICE_INSTANT_LABEL } from '../lib/words.ts'
import { useServices, useSession } from '../services.tsx'
import { BigButton, Body, Card, Hint, Notice, Row, Screen, SectionTitle } from '../ui/parts.tsx'
import { PhoneNoticeCard } from './PhoneNoticeCard.tsx'

export const SETTING_NEXT_BROADCAST = '다음에 시작하는 방송부터 적용돼요.'
export const PERMISSION_WORDS = {
  microphone: '방송 중 사장님 말(상품 번호·가격)을 듣고 상품을 등록하려고 마이크를 써요.',
  bluetooth: '라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요.',
  notification: '음성 듣는 중이라는 알림을 보여 드리려고 해요.',
} as const

export function SettingsScreen({ onBack, policyUrl }: { readonly onBack: () => void; readonly policyUrl?: string }) {
  const { voice } = useServices()
  const { session, logout } = useSession()
  const view = useSyncExternalStore(voice.subscribe, voice.getView)
  const [labels, setLabels] = useState<LabelSettings | null>(null)
  const [auto, setAuto] = useState<boolean | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    get<LabelSettings>('/api/settings/labels').then(setLabels, () => setLabels(null))
    get<{ settings: Record<string, unknown> }>('/api/settings').then(
      (response) => setAuto(response.settings['print.autoOnConfirm'] !== false),
      () => setAuto(null),
    )
  }, [])

  const run = async (work: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ tone: 'success', text: await work() })
    } catch (caught) {
      setMessage({ tone: 'danger', text: isApiError(caught) ? caught.message : '저장하지 못했어요. 다시 눌러 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="설정" testID="settings-screen">
      <BigButton small label="← 목록" ariaLabel="방송 목록으로" onPress={onBack} />
      <Card label="음성">
        <SectionTitle>음성</SectionTitle>
        <Row wrap>
          <Body>{VOICE_INSTANT_LABEL}</Body>
          <BigButton small primary={view.instant} label={view.instant ? '켜짐' : '꺼짐'} ariaLabel={`${VOICE_INSTANT_LABEL} — ${view.instant ? '켜짐' : '꺼짐'}`} onPress={() => voice.setInstant(!view.instant)} />
        </Row>
        <Hint>끄면 들린 말은 카드로만 보이고, 등록을 누를 때 등록돼요.</Hint>
        {view.problem !== null ? <Notice tone="danger">{view.problem}</Notice> : null}
        <Hint>{`마이크: ${PERMISSION_WORDS.microphone}`}</Hint>
        <Hint>{`블루투스: ${PERMISSION_WORDS.bluetooth}`}</Hint>
        <Hint>{`알림(안드로이드): ${PERMISSION_WORDS.notification}`}</Hint>
      </Card>
      <Card label="라벨">
        <SectionTitle>라벨</SectionTitle>
        {labels === null ? (
          <Hint>라벨 설정을 불러오지 못했어요.</Hint>
        ) : (
          <Row wrap>
            <Body>라벨 기능</Body>
            <BigButton
              small
              primary={labels.enabled}
              label={labels.enabled ? '켜짐' : '꺼짐'}
              ariaLabel={`라벨 기능 — ${labels.enabled ? '켜짐' : '꺼짐'}`}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const next = await put<LabelSettings & { changed: boolean }>('/api/settings/labels', { enabled: !labels.enabled })
                  setLabels(next)
                  return next.enabled ? '라벨 기능을 켰어요.' : `라벨 기능을 껐어요.${next.waiting > 0 ? ` 대기 중이던 ${String(next.waiting)}장은 출력하지 않아요.` : ''}`
                })
              }
            />
          </Row>
        )}
        {auto !== null ? (
          <Row wrap>
            <Body>1등 확정 때 라벨 자동 출력</Body>
            <BigButton
              small
              primary={auto}
              label={auto ? '켜짐' : '꺼짐'}
              ariaLabel={`1등 확정 때 라벨 자동 출력 — ${auto ? '켜짐' : '꺼짐'}`}
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const next = !auto
                  await patch<{ settings: Record<string, unknown> }>('/api/settings', { settings: { 'print.autoOnConfirm': next } })
                  setAuto(next)
                  return `${next ? '자동 출력을 켰어요.' : '자동 출력을 껐어요.'} ${SETTING_NEXT_BROADCAST}`
                })
              }
            />
          </Row>
        ) : null}
      </Card>
      {/* 휴대폰 알림 받기 (SMS3 AC-SMS3-29) */}
      <PhoneNoticeCard />
      {message !== null ? (
        <Notice tone={message.tone} alert={message.tone === 'danger'}>
          {message.text}
        </Notice>
      ) : null}
      <Card label="그 밖">
        <SectionTitle>그 밖 설정</SectionTitle>
        <Hint>가게·감사 메시지·플랫폼 연결 같은 설정은 웹에서 해요.</Hint>
        <BigButton label={`설정 전체 — ${OPEN_IN_WEB}`} onPress={() => void openWeb('/settings')} />
        {policyUrl !== undefined ? <BigButton small label="개인정보처리방침 (기기 브라우저)" onPress={() => void openExternal(policyUrl)} /> : null}
      </Card>
      <Card label="계정">
        <SectionTitle>계정</SectionTitle>
        {session.state === 'in' ? <Body>{`${session.me.seller.name} · ${session.me.loginId}`}</Body> : null}
        <BigButton label="로그아웃" danger onPress={() => void logout()} />
      </Card>
    </Screen>
  )
}
