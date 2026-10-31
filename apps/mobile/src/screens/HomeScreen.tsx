// 방송 목록·시작 (SPEC §7 화면 1, 웹 HomePage와 같은 흐름). 주 버튼은 하나(D-101): 새 방송 칸이 열리면 그 칸의 "이 방송 시작하기"가 주 버튼.
// 정산·구매자·택배 같은 화면은 앱 첫 판에 없다 — "웹으로 열기"(기기 브라우저)로 잇는다(APP-01).
import { useEffect, useRef, useState } from 'react'
import type { BroadcastItem, WriteResult } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { openWeb, WEB_SCREENS } from '../lib/open-web.ts'
import { OPEN_IN_WEB, RETRY_NOW } from '../lib/words.ts'
import { BigButton, Body, Card, Field, Hint, Loading, Notice, Row, Screen, SectionTitle, Stack } from '../ui/parts.tsx'

export interface HomeNavigation {
  readonly openConsole: (id: string) => void
  readonly openPacking: () => void
  readonly openLabels: () => void
  readonly openSettings: () => void
}

export function broadcastLine(item: BroadcastItem): string {
  const title = item.title.trim() === '' ? '제목 없음' : item.title
  return `${title} · ${dateWords(item.date)}${item.rehearsal ? ' · 리허설' : ''}${item.ended ? ' · 끝남' : ' · 진행 중'}`
}

/**
 * 방송 시작 거절 문장 (PAY2 BL-11 2, D-PAY-03): 이용권이 없다는 거절(`NO_PASS`)은 서버 문장 대신 앱 문장 하나만 — 링크·버튼 없음.
 * 다른 거절은 서버 문장 그대로.
 */
export function startErrorMessage(error: ApiError): string {
  return error.code === 'NO_PASS' ? APP_NO_PASS_MESSAGE : error.message
}

export function HomeScreen({ nav, sellerName }: { readonly nav: HomeNavigation; readonly sellerName: string }) {
  const [items, setItems] = useState<BroadcastItem[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)

  const load = async () => {
    setError(null)
    try {
      const { broadcasts } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
      setItems(broadcasts)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async (input: { title?: string; rehearsal?: boolean }) => {
    if (busy) return
    setBusy(true)
    setCreateError(null)
    const key = JSON.stringify(input)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    try {
      const result = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId, ...input }))
      pending.current = null
      const id = result.broadcast?.id
      if (id !== undefined) nav.openConsole(id)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setCreateError(caught)
    } finally {
      setBusy(false)
    }
  }

  const live = items?.filter((item) => !item.ended) ?? []
  const ended = items?.filter((item) => item.ended) ?? []

  return (
    <Screen title="어떤 방송을 열까요?" testID="home-screen">
      <Hint>{sellerName} 사장님</Hint>
      <Row wrap>
        <BigButton label="새 방송 시작" primary={!formOpen} onPress={() => setFormOpen((open) => !open)} />
        <BigButton label="리허설 해 보기" disabled={busy} onPress={() => void create({ rehearsal: true })} />
      </Row>
      {formOpen ? (
        <Card label="새 방송">
          <Field label="방송 제목 (비워도 돼요)" value={title} onChangeText={setTitle} placeholder="예: 10월 29일 저녁 방송" />
          {createError !== null ? <Notice tone="danger" alert>{startErrorMessage(createError)}</Notice> : null}
          <BigButton label="이 방송 시작하기" primary disabled={busy} onPress={() => void create(title.trim() === '' ? {} : { title: title.trim() })} />
        </Card>
      ) : createError !== null ? (
        <Notice tone="danger" alert>
          {startErrorMessage(createError)}
        </Notice>
      ) : null}

      <SectionTitle>진행 중인 방송</SectionTitle>
      {items === null && error === null ? <Loading /> : null}
      {error !== null ? (
        <Stack tight>
          <Notice tone="danger" alert>
            {error.message}
          </Notice>
          <BigButton label={RETRY_NOW} onPress={() => void load()} />
        </Stack>
      ) : null}
      {items !== null && live.length === 0 ? <Body muted>진행 중인 방송이 없어요.</Body> : null}
      {live.map((item) => (
        <BigButton key={item.id} label={broadcastLine(item)} ariaLabel={`콘솔 열기 — ${broadcastLine(item)}`} onPress={() => nav.openConsole(item.id)} />
      ))}
      {ended.length > 0 ? (
        <>
          <SectionTitle>끝난 방송</SectionTitle>
          {ended.slice(0, 10).map((item) => (
            <BigButton key={item.id} label={broadcastLine(item)} ariaLabel={`콘솔 열기 — ${broadcastLine(item)}`} onPress={() => nav.openConsole(item.id)} />
          ))}
        </>
      ) : null}

      <SectionTitle>할 일</SectionTitle>
      <Row wrap>
        <BigButton label="포장" onPress={nav.openPacking} />
        <BigButton label="라벨·프린터" onPress={nav.openLabels} />
        <BigButton label="설정" onPress={nav.openSettings} />
      </Row>
      <SectionTitle>{OPEN_IN_WEB}</SectionTitle>
      <Hint>아래 화면은 기기 브라우저에서 열려요. 로그인이 필요할 수 있어요.</Hint>
      <Row wrap>
        {WEB_SCREENS.map((screen) => (
          <BigButton key={screen.key} small label={screen.word} ariaLabel={`${screen.word} — ${OPEN_IN_WEB}`} onPress={() => void openWeb(screen.path)} />
        ))}
      </Row>
    </Screen>
  )
}
