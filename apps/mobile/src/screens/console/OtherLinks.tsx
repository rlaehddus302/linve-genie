// 틱톡·밴드를 링크로 잇기 (D-UX3-14, 사용자 지시 2026-11-03 "틱톡과 밴드도 링크로 할 수 있게").
// - 틱톡: 서버가 링크(짧은 공유 링크는 풀어서)에서 틱톡 아이디를 읽어 잇는다. 동의를 아직 안 했으면 안내를 여기서 보이고 [동의하고 잇기].
// - 밴드: 공식 방법(밴드 Open API)은 글 링크로 글을 찾을 수 없다 — 밴드 링크를 넣으면 내 밴드의 최근 내 글을 보이고 한 번 눌러 고른다.
//   밴드 계정을 아직 잇지 않았으면 서버 문장(설정에서 먼저 연결) 그대로.
import { useEffect, useState } from 'react'
import { get, isApiError, newRequestId, post } from '../../api/client.ts'
import { Body, BigButton, Card, Notice, Row, Stack } from '../../ui/parts.tsx'

export interface TiktokNotice {
  readonly version: string
  readonly title: string
  readonly lines: readonly string[]
  readonly checkbox: string
}

/** 틱톡 안내를 읽고 동의 켜기 — 켜면 onAgreed (그다음 잇기를 다시 한다) */
export function TiktokConsentCard({ onAgreed, onCancel, disabled }: { readonly onAgreed: () => void; readonly onCancel: () => void; readonly disabled?: boolean }) {
  const [notice, setNotice] = useState<TiktokNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    get<{ tiktok: { notice: TiktokNotice } }>('/api/tiktok').then(
      (body) => {
        if (alive) setNotice(body.tiktok.notice)
      },
      () => {
        if (alive) setError('안내를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.')
      },
    )
    return () => {
      alive = false
    }
  }, [])
  const agree = async () => {
    if (notice === null || busy) return
    setBusy(true)
    setError(null)
    try {
      await post('/api/tiktok/consent', { requestId: newRequestId(), on: true, version: notice.version })
      onAgreed()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card label="틱톡 안내">
      <Body bold>{notice?.title ?? '틱톡 안내'}</Body>
      {(notice?.lines ?? []).map((line) => (
        <Body key={line} muted>
          {`· ${line}`}
        </Body>
      ))}
      {error === null ? null : (
        <Notice tone="danger" alert>
          {error}
        </Notice>
      )}
      {/* 단추는 한 줄에 부정 왼쪽·긍정 오른쪽 (CLAUDE.md 절대 규칙 8, D-UX4-01) */}
      <Row>
        <BigButton small label="취소" disabled={busy} onPress={onCancel} />
        <BigButton small primary label="동의하고 잇기" ariaLabel={notice?.checkbox ?? '동의하고 잇기'} disabled={notice === null || disabled === true || busy} onPress={() => void agree()} />
      </Row>
    </Card>
  )
}

interface BandItem {
  readonly bandKey: string
  readonly name: string
}
interface BandPost {
  readonly postKey: string
  readonly createdAt: string | null
  readonly firstLine: string
  readonly commentCount: number | null
}

/** 글 줄: 첫 줄 · 올린 날(월/일 시:분) */
export function bandPostLine(post: BandPost): string {
  const first = post.firstLine.trim() === '' ? '(내용 없는 글)' : post.firstLine.trim()
  if (post.createdAt === null) return first
  const at = new Date(post.createdAt)
  const kst = new Date(at.getTime() + 9 * 3_600_000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${first} · ${String(kst.getUTCMonth() + 1)}/${String(kst.getUTCDate())} ${two(kst.getUTCHours())}:${two(kst.getUTCMinutes())}`
}

/** 내 밴드 글 고르기 — 밴드가 여럿이면 밴드부터 */
export function BandPostPicker({ onPick, onCancel, disabled }: { readonly onPick: (bandKey: string, postKey: string) => void; readonly onCancel: () => void; readonly disabled?: boolean }) {
  const [problem, setProblem] = useState<string | null>(null)
  const [bands, setBands] = useState<readonly BandItem[] | null>(null)
  const [band, setBand] = useState<BandItem | null>(null)
  const [posts, setPosts] = useState<readonly BandPost[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { band: account } = await get<{ band: { status: string; message: string | null } }>('/api/band')
        if (account.status !== 'CONNECTED') {
          if (alive) setProblem(account.message ?? '설정에서 밴드를 먼저 연결해 주세요.')
          return
        }
        const listed = await get<{ bands: BandItem[]; message: string | null }>('/api/band/bands')
        if (!alive) return
        if (listed.bands.length === 0) setProblem(listed.message ?? '내 밴드가 없어요.')
        setBands(listed.bands)
        if (listed.bands.length === 1) setBand(listed.bands[0] ?? null)
      } catch (caught) {
        if (!isApiError(caught)) throw caught
        if (alive) setProblem(caught.message)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (band === null) return
    let alive = true
    setPosts(null)
    get<{ posts: BandPost[] }>(`/api/band/posts?band=${encodeURIComponent(band.bandKey)}`).then(
      (body) => {
        if (alive) setPosts(body.posts)
      },
      (caught: unknown) => {
        if (alive) setProblem(isApiError(caught) ? caught.message : '글을 불러오지 못했어요.')
      },
    )
    return () => {
      alive = false
    }
  }, [band])

  return (
    <Card label="밴드 글 고르기">
      <Body bold>{band === null ? '어느 밴드인가요?' : '방송하는 글을 골라 주세요'}</Body>
      {problem === null ? null : (
        <Notice tone="warning" alert>
          {problem}
        </Notice>
      )}
      {band === null && problem === null && bands === null ? <Body muted>불러오는 중이에요</Body> : null}
      {band === null
        ? (bands ?? []).map((item) => <BigButton key={item.bandKey} label={item.name} disabled={disabled} onPress={() => setBand(item)} />)
        : null}
      {band !== null && posts === null && problem === null ? <Body muted>불러오는 중이에요</Body> : null}
      {band !== null && posts !== null && posts.length === 0 ? <Body muted>내가 쓴 글이 없어요.</Body> : null}
      {band !== null
        ? (posts ?? []).map((item) => {
            const line = bandPostLine(item)
            return (
              <Stack tight key={item.postKey}>
                <Body>{line}</Body>
                <Row>
                  <BigButton small primary label="이 글로 잇기" ariaLabel={`${line} 잇기`} disabled={disabled} onPress={() => onPick(band.bandKey, item.postKey)} />
                </Row>
              </Stack>
            )
          })
        : null}
      <Row wrap>
        {band !== null && (bands ?? []).length > 1 ? <BigButton small label="다른 밴드" disabled={disabled} onPress={() => setBand(null)} /> : null}
        <BigButton small label="취소" onPress={onCancel} />
      </Row>
    </Card>
  )
}
