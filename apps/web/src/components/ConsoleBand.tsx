// 콘솔의 "밴드" 칸 (SPEC §7 화면 2, PLT-04, D-BND1-07·09·10·12·15, AC-BND1-71~74·76·77).
// - 상태는 서버의 연결 보기(GET /api/broadcasts/:id/band · SSE `band` LINK) 그대로: 글 첫 줄, 상태 문장, "HH:MM:SS에 읽었어요", 받은 댓글 수,
//   넣지 못한 수의 문장, 기준선 문장, 알림 최근 20개(새것 위 — 확인하지 않은 것은 글자 "새 알림"), "확인했어요", "끊기"(확인 창).
// - 이을 수 없으면 서버의 막는 까닭 문장(+ 설정에서 고칠 것이면 "설정으로"). 읽을 수 없음·끝남이면 "다른 글 잇기"(읽을 수 없음은 먼저 끊는다).
// - 잇기 흐름(AC-BND1-72): "밴드 글 잇기" → 밴드 고르기(하나뿐이면 건너뜀, 기억한 밴드가 먼저 — 서버 차례) → 내 글 고르기("더 보기") → 확인 창 → "잇기".
//   "잇기"를 누르면 잠기고 "글을 읽는 중이에요…". 같은 글은 같은 요청 번호(응답이 늦어 다시 보내도 연결 하나). 거절은 서버 문장 그대로.
//   고르기 창의 "더 보기"·"잇기"는 창 아래 단추 줄(휴대폰에서는 화면 아래쪽 — 엄지 쪽)에 있다.
// - 휴대폰 폭(48rem 미만)에서는 "쓸 수 없음·설정으로"뿐인 칸을 그리지 않는다(D-MOB1-09). 이었거나 이을 수 있는 칸, 알림·오류가 있는 칸은 그린다.
// 서버 문장·글 첫 줄·밴드 이름·알림 글은 고치지 않고 글자로만 보인다(React 이스케이프).
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { BandItem, BandLinkView, BandPostItem, BandPostsPage } from '../api/types.ts'
import {
  BAND_LINK,
  BAND_LINK_BUSY,
  BAND_LINK_CONFIRM,
  BAND_LINK_OTHER,
  BAND_LINK_START,
  BAND_MORE,
  BAND_NEW_NOTICE,
  BAND_NO_LINK,
  BAND_NO_POSTS,
  BAND_PICK_AGAIN,
  BAND_POST_AGAIN,
  BAND_SEEN,
  BAND_UNLINK,
  BAND_UNLINK_QUESTION,
  bandCommentCountWords,
  bandLinkOpen,
  bandMemberWords,
  bandNeedsSettings,
  bandReadWords,
  bandSeenUpTo,
} from '../lib/band.ts'
import { kstDateTimeWords } from '../lib/kst.ts'
import { groupDigits } from '../lib/money.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import type { ConsolePlatforms } from './ConsolePlatforms.tsx'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

/** 밴드 칸 (알림 띠 "밴드 댓글이 들어오지 않아요."를 누르면 여기로) */
export const BAND_PANEL_ID = 'band-panel'
/** 밴드 알림 목록 (알림 띠 "확인하지 않은 밴드 알림이…"를 누르면 여기로) */
export const BAND_NOTICES_ID = 'band-notices'

export interface BandPanelProps {
  readonly live: ConsolePlatforms
  readonly broadcastId: string
  readonly navigate: Navigate
  readonly ended: boolean
  readonly sealed: boolean
  /** 휴대폰 폭: 쓸 수 없음·설정으로뿐인 칸은 그리지 않는다 */
  readonly hideIdle: boolean
}

function SettingsLink({ navigate }: { readonly navigate: Navigate }) {
  return (
    <a
      className="button"
      href={routePath({ name: 'settings', section: 'band' })}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey) return
        event.preventDefault()
        navigate({ name: 'settings', section: 'band' })
      }}
    >
      설정으로
    </a>
  )
}

/** 같은 조치는 같은 요청 번호 (다시 보내도 되는 실패만 남긴다 — 서버가 한 번만 처리한다) */
function useRequestIds() {
  const ids = useRef(new Map<string, string>())
  return {
    take(key: string): string {
      const known = ids.current.get(key)
      if (known !== undefined) return known
      const id = newRequestId()
      ids.current.set(key, id)
      return id
    },
    settle(key: string, error: unknown) {
      if (error === null || !isApiError(error) || !error.retryable) ids.current.delete(key)
    },
  }
}

type Picker =
  | { readonly step: 'bands'; readonly bands: readonly BandItem[] | null; readonly message: string | null; readonly error: ApiError | null }
  | {
      readonly step: 'posts'
      readonly band: BandItem
      readonly single: boolean
      readonly posts: readonly BandPostItem[]
      readonly cursor: string | null
      readonly more: boolean
      readonly loading: boolean
      readonly error: ApiError | null
    }
  | { readonly step: 'confirm'; readonly band: BandItem; readonly single: boolean; readonly post: BandPostItem; readonly back: Picker }

export function BandPanel({ live, broadcastId, navigate, ended, sealed, hideIdle }: BandPanelProps) {
  const link = live.bandLink
  const ids = useRequestIds()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [asking, setAsking] = useState(false)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<ApiError | null>(null)
  const alive = useRef(true)
  const pickVersion = useRef(0)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}/band`
  const writable = !ended && !sealed

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // 연결 상태가 바뀌면(SSE·응답) 앞선 조작의 오류 문장은 지운다
  const stateKey = link === null ? null : `${link.state}:${link.post?.postKey ?? ''}`
  useEffect(() => setError(null), [stateKey])

  const loadPosts = useCallback(async (band: BandItem, single: boolean, cursor: string | null, before: readonly BandPostItem[]) => {
    const mine = ++pickVersion.current
    setPicker({ step: 'posts', band, single, posts: before, cursor, more: cursor !== null, loading: true, error: null })
    try {
      const page = await get<BandPostsPage>(withQuery('/api/band/posts', cursor === null ? { band: band.bandKey } : { band: band.bandKey, cursor }))
      if (!alive.current || mine !== pickVersion.current) return
      setPicker({ step: 'posts', band, single, posts: [...before, ...page.posts], cursor: page.cursor, more: page.more && page.cursor !== null, loading: false, error: null })
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!alive.current || mine !== pickVersion.current) return
      setPicker({ step: 'posts', band, single, posts: before, cursor, more: cursor !== null, loading: false, error: caught })
    }
  }, [])

  const loadBands = useCallback(async () => {
    const mine = ++pickVersion.current
    setPicker({ step: 'bands', bands: null, message: null, error: null })
    try {
      const result = await get<{ bands: BandItem[]; chosenBand: string | null; message: string | null }>('/api/band/bands')
      if (!alive.current || mine !== pickVersion.current) return
      const only = result.bands.length === 1 ? result.bands[0] : undefined
      // 밴드가 하나뿐이면 고르기를 건너뛴다
      if (only !== undefined) void loadPosts(only, true, null, [])
      else setPicker({ step: 'bands', bands: result.bands, message: result.message, error: null })
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!alive.current || mine !== pickVersion.current) return
      setPicker({ step: 'bands', bands: null, message: null, error: caught })
    }
  }, [loadPosts])

  const openPicker = () => {
    setLinkError(null)
    setError(null)
    void loadBands()
  }

  const closePicker = () => {
    pickVersion.current++
    setPicker(null)
    setLinkError(null)
  }

  const runLink = async (band: BandItem, item: BandPostItem) => {
    if (linking) return
    const key = `link:${band.bandKey}:${item.postKey}`
    const requestId = ids.take(key)
    setLinking(true)
    setLinkError(null)
    const stamp = live.bandStamp()
    try {
      const result = await withRetry(() => post<{ link: BandLinkView }>(`${base}/link`, { requestId, bandKey: band.bandKey, postKey: item.postKey }))
      ids.settle(key, null)
      live.acceptBandLink(result.link, stamp)
      if (alive.current) {
        pickVersion.current++
        setPicker(null)
      }
    } catch (caught) {
      ids.settle(key, caught)
      if (!isApiError(caught)) throw caught
      if (alive.current) setLinkError(caught)
    } finally {
      if (alive.current) setLinking(false)
    }
  }

  const unlink = async (): Promise<boolean> => {
    if (busy) return false
    const key = 'unlink'
    const requestId = ids.take(key)
    setBusy(true)
    setError(null)
    const stamp = live.bandStamp()
    try {
      const result = await withRetry(() => post<{ link: BandLinkView }>(`${base}/unlink`, { requestId }))
      ids.settle(key, null)
      live.acceptBandLink(result.link, stamp)
      return true
    } catch (caught) {
      ids.settle(key, caught)
      if (!isApiError(caught)) throw caught
      if (alive.current) setError(caught)
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  /** 읽을 수 없는 글: 끊고 다시 고르기 */
  const linkOther = async () => {
    if (link !== null && bandLinkOpen(link)) {
      const done = await unlink()
      if (!done) return
    }
    if (alive.current) openPicker()
  }

  const open = bandLinkOpen(link)
  const hasNotices = link !== null && link.notices.items.length > 0
  // 이을 수 없는데 설정에서 고칠 것이거나 끝난 방송 — 휴대폰에서는 그리지 않는다 (D-MOB1-09)
  const idleBlock = link !== null && !open && !link.canLink && (bandNeedsSettings(link) || link.blockCode === 'ENDED' || link.blockCode === 'REHEARSAL')
  if (hideIdle && (link === null ? live.bandError === null : idleBlock && !hasNotices && error === null && picker === null)) return null
  if (link === null && live.bandError === null) {
    return (
      <section className="card stack-tight platform-panel band-panel" aria-label="밴드">
        <h2 className="section-title">밴드</h2>
        <p role="status">불러오는 중…</p>
      </section>
    )
  }

  const upTo = bandSeenUpTo(link)
  const canStart = writable && link !== null && link.state === 'NONE' && link.canLink
  // 읽을 수 없는 글은 끊고 다시 고르기, 끝난 연결은 이을 수 있으면 다시 고르기
  const canOther = writable && link !== null && (link.state === 'NO_ACCESS' || (link.state === 'FINISHED' && link.canLink))
  // 막는 까닭 문장 (이어진 동안은 "이미 이어져 있음"이라 보이지 않는다)
  const block = link !== null && !open && !link.canLink ? link.blockCode : null
  return (
    <section id={BAND_PANEL_ID} className="card stack platform-panel band-panel" aria-label="밴드" tabIndex={-1}>
      <h2 className="section-title">밴드</h2>
      {link === null && live.bandError !== null ? (
        <div className="stack-tight">
          <p className="warning">{live.bandError.message}</p>
          <div className="row">
            <button type="button" className="button" onClick={() => void live.reloadBandLink()}>
              다시 불러오기
            </button>
          </div>
        </div>
      ) : null}
      {link !== null && link.state !== 'NONE' ? (
        <div className="stack-tight" role="group" aria-label="밴드 댓글 받기">
          {link.post !== null ? (
            <p className="band-post-line">
              이은 글: <span>{link.post.firstLine}</span>
            </p>
          ) : null}
          {link.message !== null ? (
            <p className={link.state === 'READING' || link.state === 'FINISHED' ? undefined : 'warning'}>
              <strong>{link.message}</strong>
            </p>
          ) : null}
          {link.lastReadAt !== null && bandReadWords(link.lastReadAt) !== '' ? <p>{bandReadWords(link.lastReadAt)}</p> : null}
          <p>받은 댓글 {groupDigits(link.received)}개</p>
          {link.skipMessages.map((text, index) => (
            <p key={index} className="warning">
              {text}
            </p>
          ))}
          {link.baselineMessage !== null ? <p>{link.baselineMessage}</p> : null}
        </div>
      ) : null}
      {link !== null && link.state === 'NONE' && (block === 'ENDED' || (link.canLink && !writable)) ? <p>{BAND_NO_LINK}</p> : null}
      {link !== null && block !== null && block !== 'ENDED' && link.blockMessage !== null ? <p>{link.blockMessage}</p> : null}
      {link !== null && !sealed && (canStart || canOther || open || (writable && bandNeedsSettings(link))) ? (
        <div className="row">
          {writable && bandNeedsSettings(link) ? <SettingsLink navigate={navigate} /> : null}
          {canStart ? (
            <button type="button" className="button" disabled={busy || picker !== null} onClick={openPicker}>
              {BAND_LINK_START}
            </button>
          ) : null}
          {canOther ? (
            <button type="button" className="button" disabled={busy || picker !== null} onClick={() => void linkOther()}>
              {BAND_LINK_OTHER}
            </button>
          ) : null}
          {open ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setError(null)
                setAsking(true)
              }}
            >
              {BAND_UNLINK}
            </button>
          ) : null}
        </div>
      ) : null}
      {link !== null && hasNotices ? (
        <div className="stack-tight">
          <h3 className="band-notices-title">밴드 알림</h3>
          <ul id={BAND_NOTICES_ID} className="plain-list stack-tight band-notices" aria-label="밴드 알림" tabIndex={-1}>
            {link.notices.items.map((item) => (
              <li key={item.id} className={item.seen ? 'band-notice' : 'band-notice band-notice-new'}>
                {!item.seen ? <span className="tag tag-new">{BAND_NEW_NOTICE}</span> : null} <span>{item.message}</span>
                {kstDateTimeWords(item.at) !== '' ? <span className="hint band-notice-at"> {kstDateTimeWords(item.at)}</span> : null}
              </li>
            ))}
          </ul>
          {!sealed && link.notices.unseen > 0 && upTo !== null ? (
            <div className="row">
              <button type="button" className="button" aria-busy={live.bandSeenBusy} disabled={live.bandSeenBusy} onClick={() => void live.ackBandNotices(upTo)}>
                {BAND_SEEN}
              </button>
            </div>
          ) : null}
          {live.bandSeenError !== null ? <ErrorNote error={live.bandSeenError} /> : null}
        </div>
      ) : null}
      {error !== null && !asking ? <ErrorNote error={error} /> : null}
      {asking ? (
        <Modal
          title="밴드 연결 끊기"
          onClose={() => {
            setAsking(false)
            setError(null)
          }}
          actions={
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() =>
                void unlink().then((done) => {
                  if (done && alive.current) setAsking(false)
                })
              }
            >
              {BAND_UNLINK}
            </button>
          }
        >
          <p>{BAND_UNLINK_QUESTION}</p>
          {error !== null ? <ErrorNote error={error} /> : null}
        </Modal>
      ) : null}
      {picker !== null ? (
        <BandPicker
          picker={picker}
          linking={linking}
          linkError={linkError}
          onClose={closePicker}
          onBands={() => void loadBands()}
          onBand={(band, single) => void loadPosts(band, single, null, [])}
          onMore={(p) => void loadPosts(p.band, p.single, p.cursor, p.posts)}
          onPost={(p, item) => {
            setLinkError(null)
            setPicker({ step: 'confirm', band: p.band, single: p.single, post: item, back: p })
          }}
          onBack={(p) => {
            setLinkError(null)
            setPicker(p.back)
          }}
          onLink={(p) => void runLink(p.band, p.post)}
        />
      ) : null}
    </section>
  )
}

type PostsPicker = Extract<Picker, { step: 'posts' }>
type ConfirmPicker = Extract<Picker, { step: 'confirm' }>

interface BandPickerProps {
  readonly picker: Picker
  readonly linking: boolean
  readonly linkError: ApiError | null
  readonly onClose: () => void
  readonly onBands: () => void
  readonly onBand: (band: BandItem, single: boolean) => void
  readonly onMore: (picker: PostsPicker) => void
  readonly onPost: (picker: PostsPicker, post: BandPostItem) => void
  readonly onBack: (picker: ConfirmPicker) => void
  readonly onLink: (picker: ConfirmPicker) => void
}

/** 고르기 창: 밴드 → 내 글 → 확인 (창 하나에서 단계만 바뀐다) */
function BandPicker({ picker, linking, linkError, onClose, onBands, onBand, onMore, onPost, onBack, onLink }: BandPickerProps) {
  if (picker.step === 'bands') {
    return (
      <Modal title="밴드 고르기" onClose={onClose} phoneBottom>
        {picker.error !== null ? <ErrorNote error={picker.error} onRetry={onBands} retryLabel="다시 불러오기" /> : null}
        {picker.bands === null && picker.error === null ? <p role="status">불러오는 중…</p> : null}
        {picker.bands !== null && picker.bands.length === 0 ? <p>{picker.message ?? ''}</p> : null}
        {picker.bands !== null && picker.bands.length > 0 ? (
          <ul className="plain-list stack-tight band-choices" aria-label="가입한 밴드">
            {picker.bands.map((band) => (
              <li key={band.bandKey}>
                <button type="button" className="choice-button band-choice" onClick={() => onBand(band, false)}>
                  <strong>{band.name}</strong>
                  {band.memberCount !== null ? <span className="hint"> {bandMemberWords(band.memberCount)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
    )
  }
  if (picker.step === 'posts') {
    const empty = !picker.loading && picker.error === null && picker.posts.length === 0 && !picker.more
    return (
      <Modal
        title="내 글 고르기"
        onClose={onClose}
        phoneBottom
        actions={
          <>
            {picker.more ? (
              <button type="button" className="button" disabled={picker.loading} onClick={() => onMore(picker)}>
                {BAND_MORE}
              </button>
            ) : null}
            {!picker.single ? (
              <button type="button" className="button" onClick={onBands}>
                {BAND_PICK_AGAIN}
              </button>
            ) : null}
          </>
        }
      >
        <p className="band-picked">
          밴드: <strong>{picker.band.name}</strong>
        </p>
        {empty ? <p>{BAND_NO_POSTS}</p> : null}
        {picker.posts.length > 0 ? (
          <ul className="plain-list stack-tight band-choices" aria-label="내가 쓴 글">
            {picker.posts.map((item) => (
              <li key={item.postKey}>
                <button type="button" className="choice-button band-choice band-post-choice" onClick={() => onPost(picker, item)}>
                  {item.createdAt !== null ? <span className="hint">{kstDateTimeWords(item.createdAt)}</span> : null}
                  <strong className="band-post-first">{item.firstLine}</strong>
                  {item.commentCount !== null ? <span>{bandCommentCountWords(item.commentCount)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {picker.loading ? <p role="status">불러오는 중…</p> : null}
        {picker.error !== null ? <ErrorNote error={picker.error} /> : null}
      </Modal>
    )
  }
  return (
    <Modal
      title="이 글 잇기"
      onClose={onClose}
      phoneBottom
      closeDisabled={linking}
      actions={
        <>
          <button type="button" className="button" disabled={linking} onClick={() => onBack(picker)}>
            {BAND_POST_AGAIN}
          </button>
          <button type="button" className="button button-primary" aria-busy={linking} disabled={linking} onClick={() => onLink(picker)}>
            {BAND_LINK}
          </button>
        </>
      }
    >
      <p className="band-picked">
        밴드: <strong>{picker.band.name}</strong>
      </p>
      <p className="band-picked">
        글: <strong className="band-post-first">{picker.post.firstLine}</strong>
      </p>
      <p>{BAND_LINK_CONFIRM}</p>
      {linking ? <p role="status">{BAND_LINK_BUSY}</p> : null}
      {linkError !== null ? <ErrorNote error={linkError} /> : null}
    </Modal>
  )
}
