// 올라간 감사 채팅 (D-THANKSFIX-01·02, 판매자 요청 2026-11-20 "잘못 올라간 감사 채팅 삭제, 수정 기능 … 수동으로도 되게"):
// 이 라이브에 올라간 유튜브 실시간 채팅 감사 글 목록. 하나를 골라 [지우기] 또는 [고쳐 다시 올리기].
// - 지우기는 한 번 묻는다(왼쪽 취소 · 오른쪽 지우기, 절대 규칙 8). 고쳐 올리기는 글을 고치는 아래 창(왼쪽 취소 · 오른쪽 올리기).
// - 서버는 줄만 넣고 바로 돌려준다 — 실제로 지우고 올리는 것은 서버 발송함이 곧 한다. 바뀌는 중인 글이 있으면 2초마다 다시 받는다.
// - 글은 손님 닉네임이 든 바깥 글이다 — 글자로만 그린다(Txt, 해석하지 않음, 절대 규칙 5).
import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { get, isApiError, post } from '../../api/client.ts'
import { BigButton, BottomSheet, ButtonRow, Card, ConfirmSheet, EmptyState, StackPage, TextField, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { Loading, Notice } from '../../ui/parts.tsx'

/** 라이브 관리의 줄 이름·이 화면 제목 */
export const THANKS_POSTS_TITLE = '올라간 감사 채팅'
export const THANKS_POSTS_HELP = '잘못 올라간 감사 채팅을 지우거나 고쳐서 다시 올릴 수 있어요.\n상품 정보를 고치면 이미 올라간 감사 채팅도 저절로 지우고 고친 글로 다시 올려요.'
/** 고쳐 올리는 글의 길이 — 서버 MANUAL_TEXT_MAX(실시간 채팅 200자 − "[수정] " 5자)와 같다 */
export const THANKS_TEXT_MAX = 195
export const DELETE_QUESTION = '이 감사 채팅을 지울까요?'
export const DELETE_DESCRIPTION = '유튜브 라이브 채팅에서 지워요. 지운 글은 되돌릴 수 없어요.'
export const EDIT_TITLE = '고쳐 다시 올리기'
export const EDIT_DESCRIPTION = '앞 글을 지우고 고친 글을 올려요. 앞 글을 지우지 못하면 고친 글 앞에 [수정]을 붙여요.'

export type ThanksPostKind = 'THANKS' | 'FIXED' | 'MANUAL'
export interface ThanksPost {
  readonly key: string
  readonly kind: ThanksPostKind
  readonly text: string
  readonly postedAt: string
  readonly gone: boolean
  readonly busy: boolean
  readonly note: string | null
  readonly canDelete: boolean
  readonly canEdit: boolean
}
export interface ThanksPostsData {
  readonly live: boolean
  readonly posts: readonly ThanksPost[]
}

const KIND_WORD: Record<ThanksPostKind, string> = { THANKS: '감사', FIXED: '고친 감사', MANUAL: '직접 고친 글' }

/** 올라간 시각 (오후 8:05 꼴 대신 20:05 — 채팅 시각과 같은 모양) */
export function postClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 글 길이 (서버와 같이 코드 포인트로 센다) */
export const textLength = (text: string): number => [...text].length

export function ThanksPosts({ broadcastId, onBack }: { readonly broadcastId: string; readonly onBack: () => void }) {
  const [data, setData] = useState<ThanksPostsData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [deleting, setDeleting] = useState<ThanksPost | null>(null)
  const [editing, setEditing] = useState<ThanksPost | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const path = `/api/broadcasts/${encodeURIComponent(broadcastId)}/thanks-posts`
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await get<ThanksPostsData>(path)
      if (!alive.current) return
      setData(next)
      setLoadError('')
    } catch (caught) {
      if (alive.current) setLoadError(isApiError(caught) ? caught.message : '감사 채팅을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.')
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  // 바꾸는 중인 글이 있으면 2초마다 다시 받는다 (서버 발송함이 곧 지우고 올린다)
  const working = data?.posts.some((item) => item.busy) === true
  useEffect(() => {
    if (!working) return
    const timer = setTimeout(() => void load(), 2000)
    return () => clearTimeout(timer)
  }, [working, data, load])

  const send = async (action: 'delete' | 'repost', target: ThanksPost, body: Record<string, unknown>) => {
    setBusy(true)
    setActionError('')
    try {
      const next = await post<ThanksPostsData>(`${path}/${action}`, { key: target.key, ...body })
      if (!alive.current) return
      setData(next)
      setDeleting(null)
      setEditing(null)
    } catch (caught) {
      if (!alive.current) return
      setActionError(isApiError(caught) ? caught.message : '보내지 못했어요. 다시 눌러 주세요.')
      // 지우기 창은 닫고 화면에 빨간 줄로 — 고치기 창은 적은 글을 잃지 않게 열어 둔다
      setDeleting(null)
      void load()
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const openEdit = (target: ThanksPost) => {
    setActionError('')
    setText(target.text.replace(/^\[수정\] /, '').replace(/\n/g, ' '))
    setEditing(target)
  }
  const length = textLength(text.trim())
  const tooLong = length > THANKS_TEXT_MAX

  return (
    <StackPage title={THANKS_POSTS_TITLE} name={THANKS_POSTS_TITLE} onBack={onBack} gray testID="thanks-posts">
      <Txt color="textSub">{THANKS_POSTS_HELP}</Txt>
      {data !== null && !data.live && data.posts.length > 0 ? <Notice tone="info">라이브 채팅이 끝나서 지우거나 고칠 수 없어요.</Notice> : null}
      {loadError !== '' ? <Notice tone="danger" alert>{loadError}</Notice> : null}
      {actionError !== '' && editing === null ? <Notice tone="danger" alert>{actionError}</Notice> : null}
      {data === null ? (loadError === '' ? <Loading /> : null) : data.posts.length === 0 ? (
        <EmptyState title="아직 올라간 감사 채팅이 없어요" description="찜이 1등으로 정해져 감사 채팅이 올라가면 여기에 보여요." />
      ) : (
        data.posts.map((item) => (
          <Card key={item.key} testID={`thanks-post-${item.key}`}>
            <View style={{ gap: SPACE.xs }}>
              <Txt step="meta" color="textSub">{`${postClock(item.postedAt)} · ${KIND_WORD[item.kind]}`}</Txt>
              <Txt step="bodyLarge" color={item.gone ? 'textSub' : 'text'}>{item.text}</Txt>
              {item.note !== null ? <Txt step="meta" color={item.gone ? 'textSub' : 'primaryText'}>{item.note}</Txt> : null}
            </View>
            {item.canEdit ? (
              // 지우기 왼쪽 · 고쳐 다시 올리기 오른쪽, 한 줄 (절대 규칙 8)
              <ButtonRow>
                {item.canDelete ? <BigButton kind="secondary" label="지우기" testID={`thanks-delete-${item.key}`} onPress={() => { setActionError(''); setDeleting(item) }} /> : null}
                <BigButton label={EDIT_TITLE} testID={`thanks-edit-${item.key}`} onPress={() => openEdit(item)} />
              </ButtonRow>
            ) : null}
          </Card>
        ))
      )}

      <ConfirmSheet
        visible={deleting !== null}
        question={DELETE_QUESTION}
        description={DELETE_DESCRIPTION}
        cancelLabel="취소"
        confirmLabel="지우기"
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null && !busy) void send('delete', deleting, {})
        }}
      />

      <BottomSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={EDIT_TITLE}
        description={EDIT_DESCRIPTION}
        testID="thanks-edit-sheet"
        actions={
          <>
            <BigButton kind="secondary" label="취소" onPress={() => setEditing(null)} />
            <BigButton label="올리기" busy={busy} disabled={length === 0 || tooLong} onPress={() => {
              if (editing !== null && !busy) void send('repost', editing, { text: text.trim() })
            }} />
          </>
        }
      >
        <TextField label="올릴 글" value={text} onChangeText={setText} multiline help={`${String(length)}/${String(THANKS_TEXT_MAX)}자`} error={tooLong ? `글은 ${String(THANKS_TEXT_MAX)}자까지 적을 수 있어요.` : actionError !== '' ? actionError : null} testID="thanks-edit-text" />
      </BottomSheet>
    </StackPage>
  )
}
