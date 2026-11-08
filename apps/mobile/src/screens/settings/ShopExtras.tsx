// 가게 설정의 바로 바뀌는 칸·보기 칸 (D-APPX-03 — 웹 AssistSection·BackupSection·ExportSection과 같은 문구).
// - AI 제안: 쓸 수 없으면 그 한 줄, 켜져 있으면 오늘 쓴 수·끄기, 꺼져 있으면 고지·동의 칸·켜기(동의해야 켜진다).
// - 연결: 구글·인스타그램·틱톡·밴드 로그인, 자동 게시 동의, 간편 로그인, 크롬 확장은 기기 브라우저의 설정 화면으로 연다.
// - 백업 상태(되돌리기는 운영자) · 전체 기록 파일·전체 판매대장(공유 시트로 — 손님 정보가 들어 있다는 경고와 함께).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { AssistSettings, BackupStatus, YoutubeConnectionResponse } from '@livejjim/web/src/api/types.ts'
import { ASSIST_CONSENT, ASSIST_NOTICE, ASSIST_OFF_BUTTON, ASSIST_OFF_STATE, ASSIST_ON, ASSIST_ON_BUTTON, ASSIST_SWITCH, ASSIST_TITLE, ASSIST_UNAVAILABLE } from '@livejjim/web/src/lib/assist-words.ts'
import { kstDateTimeLong } from '@livejjim/web/src/lib/kst.ts'
import { BACKUP_STOPPED, EXPORT_WARNING, RESTORE_HINT, backupStopped, sizeWords } from '@livejjim/web/src/lib/shop-words.ts'
import { get, getBytes, isApiError, put, type ApiError } from '../../api/client.ts'
import { openWeb } from '../../lib/open-web.ts'
import { OPEN_IN_WEB, RETRY_NOW } from '../../lib/words.ts'
import { nativeShareFile } from '../../native/index.ts'
import { BigButton, Card, ListRow, Section, ToggleRow, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { Loading, Notice } from '../../ui/parts.tsx'

export const FILE_FAILED = '파일을 넘기지 못했어요. 다시 눌러 주세요.'

/** 웹 설정의 그 칸으로 여는 줄 (바깥 로그인 창을 거치는 연결) */
export const WEB_CONNECTIONS: readonly { readonly title: string; readonly sub: string; readonly path: string }[] = [
  { title: '유튜브 연결', sub: '채널 연결, 채팅·댓글 자동 게시 동의', path: '/settings/youtube' },
  { title: '인스타그램 연결', sub: '인스타그램 라이브 댓글', path: '/settings/instagram' },
  { title: '틱톡 라이브(베타)', sub: '틱톡 라이브 댓글', path: '/settings/tiktok' },
  { title: '네이버 밴드', sub: '밴드 라이브 댓글', path: '/settings/band' },
  { title: '로그인 방법', sub: '카카오·네이버·구글 간편 로그인', path: '/settings' },
  { title: '크롬 확장', sub: '컴퓨터 크롬에서 유튜브 채팅 받기', path: '/settings' },
]

function useFile() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (path: string, name: string, mime: string) => {
    if (busy !== null) return
    setBusy(path)
    setError(null)
    try {
      const { bytes } = await getBytes(path)
      try {
        await nativeShareFile()(bytes, name, mime)
      } catch {
        setError(FILE_FAILED)
      }
    } catch (caught: unknown) {
      setError(isApiError(caught) ? caught.message : FILE_FAILED)
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run }
}

export function AssistCard() {
  const [current, setCurrent] = useState<AssistSettings | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    get<AssistSettings>('/api/assist/settings').then(
      (value) => {
        if (alive) setCurrent(value)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])
  const turn = async (enabled: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setCurrent(await put<AssistSettings>('/api/assist/settings', enabled ? { enabled, consent } : { enabled }))
      setConsent(false)
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  // 옵션 방송이 없는 판매자에게는 서버가 쓸 수 없다고 준다 — 칸은 그대로 두고 그 한 줄만
  if (loadError !== null && loadError.status === 403) return null
  return (
    <Section title={ASSIST_TITLE}>
      <Card>
        {loadError !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{loadError.message}</Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : null}
        {current === null && loadError === null ? <Loading /> : null}
        {current !== null && !current.available ? <Txt color="textSub">{ASSIST_UNAVAILABLE}</Txt> : null}
        {current !== null && current.available && current.enabled ? (
          <>
            <Txt>{ASSIST_ON(current.usedToday, current.dailyLimit)}</Txt>
            <BigButton kind="outline" label={ASSIST_OFF_BUTTON} ariaLabel={ASSIST_SWITCH} busy={busy} onPress={() => void turn(false)} />
          </>
        ) : null}
        {current !== null && current.available && !current.enabled ? (
          <>
            <Txt>{ASSIST_OFF_STATE}</Txt>
            <Notice tone="info">{ASSIST_NOTICE}</Notice>
            <ToggleRow title={ASSIST_CONSENT} on={consent} onChange={setConsent} />
            {!consent ? <Txt step="caption" color="textSub">동의 칸을 체크하면 켤 수 있어요.</Txt> : null}
            <BigButton label={ASSIST_ON_BUTTON} ariaLabel={ASSIST_SWITCH} busy={busy} disabled={!consent} onPress={() => void turn(true)} />
          </>
        ) : null}
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </Card>
    </Section>
  )
}

/**
 * 실시간 채팅 감사를 라이브지니 봇이 대신 올리는 판매자인가 (D-YT-SEND-18 — 연결 응답의 botThanks). 모르면(불러오는 중·유튜브 연동 없는 서버·오류) false.
 * 봇 판매자 화면은 구글 연결·게시 동의 대신 감사 스위치 하나만 보인다
 */
export function useBotThanks(): boolean {
  const [bot, setBot] = useState(false)
  useEffect(() => {
    let alive = true
    get<YoutubeConnectionResponse>('/api/youtube/connection').then(
      (result) => {
        if (alive) setBot(result.botThanks === true)
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [])
  return bot
}

export function ConnectionsCard() {
  const bot = useBotThanks()
  // 봇 판매자는 유튜브 구글 연결이 필요 없다 — 그 줄을 빼고 채팅 받기(방송 링크)만 쓴다
  const rows = bot ? WEB_CONNECTIONS.filter((row) => row.path !== '/settings/youtube') : WEB_CONNECTIONS
  return (
    <Section title="연결" description="바깥 로그인 창을 거치는 연결은 기기 브라우저에서 해요.">
      <Card>
        {rows.map((row) => (
          <ListRow key={row.title} title={row.title} subtitle={row.sub} value={OPEN_IN_WEB} ariaLabel={`${row.title} — ${OPEN_IN_WEB}`} onPress={() => void openWeb(row.path)} />
        ))}
      </Card>
    </Section>
  )
}

export function BackupCard() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    let alive = true
    get<BackupStatus>('/api/backups').then(
      (result) => {
        if (alive) setStatus(result)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  if (error !== null && error.status === 403) return null
  return (
    <Section title="백업">
      <Card>
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {status === null && error === null ? <Loading /> : null}
        {status !== null ? (
          <>
            {backupStopped(status) ? <Notice tone="warning" alert>{BACKUP_STOPPED}</Notice> : null}
            <Txt>{`마지막 자동 백업: ${status.lastSuccessAt === null ? '없음' : kstDateTimeLong(status.lastSuccessAt)}`}</Txt>
            <Txt>{`백업은 ${String(status.retentionDays)}일 동안 보관해요.`}</Txt>
            {status.backups.length === 0 ? <Txt color="textSub">보관 중인 백업이 없어요.</Txt> : null}
            {status.backups.map((backup) => (
              <Txt key={backup.createdAt} step="caption">{`${kstDateTimeLong(backup.createdAt)} · ${sizeWords(backup.size)}`}</Txt>
            ))}
            <Txt step="caption" color="textSub">{RESTORE_HINT}</Txt>
          </>
        ) : null}
      </Card>
    </Section>
  )
}

export function ExportCard() {
  const file = useFile()
  return (
    <Section title="전체 기록 내려받기">
      <Card>
        <Notice tone="warning">{EXPORT_WARNING}</Notice>
        <BigButton kind="outline" label="전체 기록 파일 (옮기기·보관용)" busy={file.busy === '/api/export/records.json.gz'} onPress={() => void file.run('/api/export/records.json.gz', 'livejjim-records.json.gz', 'application/gzip')} />
        <BigButton kind="outline" label="전체 판매대장(엑셀)" busy={file.busy === '/api/export/ledger.xlsx'} onPress={() => void file.run('/api/export/ledger.xlsx', 'livejjim-ledger.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')} />
        {file.busy !== null ? <Txt step="caption" color="textSub">만드는 중이에요…</Txt> : null}
        {file.error !== null ? <Notice tone="danger" alert>{file.error}</Notice> : null}
      </Card>
    </Section>
  )
}
