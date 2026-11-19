// 올라간 감사 채팅 (D-THANKSFIX-01·02): 목록 · [지우기]는 한 번 묻고(왼쪽 취소 · 오른쪽 지우기) · [고쳐 다시 올리기]는 글을 고쳐 보낸다.
// 손님 닉네임이 든 글은 글자 그대로 보인다(해석하지 않음). 라이브가 끝났으면 단추가 없다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DELETE_QUESTION, EDIT_TITLE, THANKS_POSTS_TITLE, THANKS_TEXT_MAX, ThanksPosts, postClock, type ThanksPost, type ThanksPostsData } from '../src/screens/console/ThanksPosts.tsx'
import { makeWorld } from './screen-support.tsx'

const FIRST: ThanksPost = { key: 'outbox:g1', kind: 'THANKS', text: '15번 상광 10,000원 <b>가나다</b>님 구매 감사합니다', postedAt: '2026-10-29T11:05:00Z', gone: false, busy: false, note: null, canDelete: true, canEdit: true }

function world(data: ThanksPostsData) {
  const w = makeWorld()
  let current = data
  w.server.on('GET', /^\/api\/broadcasts\/b1\/thanks-posts$/, () => ({ body: current }))
  w.server.on('POST', /^\/api\/broadcasts\/b1\/thanks-posts\/delete$/, () => {
    current = { live: true, posts: [{ ...FIRST, busy: true, note: '지우는 중이에요', canDelete: false, canEdit: false }] }
    return { body: current }
  })
  w.server.on('POST', /^\/api\/broadcasts\/b1\/thanks-posts\/repost$/, () => {
    current = { live: true, posts: [{ ...FIRST, busy: true, note: '고친 글로 바꾸는 중이에요', canDelete: false, canEdit: false }] }
    return { body: current }
  })
  return w
}

describe('올라간 감사 채팅 화면', () => {
  it('글은 글자 그대로(이름 속 꺾쇠도) 보이고, [지우기]는 한 번 묻는다 — 취소는 아무것도 보내지 않고, 지우기는 그 글 열쇠로 보낸다', async () => {
    const w = world({ live: true, posts: [FIRST] })
    render(w.wrap(<ThanksPosts broadcastId="b1" onBack={() => undefined} />))
    expect(await screen.findByText(FIRST.text)).toBeTruthy()
    expect(screen.getByText(`${postClock(FIRST.postedAt)} · 감사`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(await screen.findByText(DELETE_QUESTION)).toBeTruthy()
    // 단추는 한 줄: 왼쪽 취소 · 오른쪽 지우기 (절대 규칙 8)
    const dialogButtons = screen.getAllByRole('button').filter((button) => ['취소', '지우기'].includes(button.getAttribute('aria-label') ?? ''))
    expect(dialogButtons.map((button) => button.getAttribute('aria-label')).slice(-2)).toEqual(['취소', '지우기'])
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(w.server.callsTo('POST', /thanks-posts\/delete/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    fireEvent.click((await screen.findAllByRole('button', { name: '지우기' })).at(-1)!)
    await waitFor(() => expect(w.server.callsTo('POST', /thanks-posts\/delete/)).toHaveLength(1))
    expect(w.server.callsTo('POST', /thanks-posts\/delete/)[0]?.body).toEqual({ key: 'outbox:g1' })
    expect(await screen.findByText('지우는 중이에요')).toBeTruthy()
  })

  it('[고쳐 다시 올리기]: 글을 고쳐 올린다. 너무 길면 올리기 단추가 꺼진다', async () => {
    const w = world({ live: true, posts: [FIRST] })
    render(w.wrap(<ThanksPosts broadcastId="b1" onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: EDIT_TITLE }))
    const sheet = await screen.findByTestId('thanks-edit-sheet')
    const field = within(sheet).getByLabelText('올릴 글')
    expect((field as HTMLTextAreaElement).value).toBe(FIRST.text)
    fireEvent.change(field, { target: { value: '가'.repeat(THANKS_TEXT_MAX + 1) } })
    expect(within(sheet).getByRole('button', { name: '올리기' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(field, { target: { value: ' 15번 성광 10,000원 가나다님 구매 감사합니다 ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '올리기' }))
    await waitFor(() => expect(w.server.callsTo('POST', /thanks-posts\/repost/)).toHaveLength(1))
    expect(w.server.callsTo('POST', /thanks-posts\/repost/)[0]?.body).toEqual({ key: 'outbox:g1', text: '15번 성광 10,000원 가나다님 구매 감사합니다' })
    expect(await screen.findByText('고친 글로 바꾸는 중이에요')).toBeTruthy()
  })

  it('라이브 채팅이 끝났거나 지운 글은 단추가 없다. 올라간 글이 없으면 빈 안내', async () => {
    const w = world({ live: false, posts: [{ ...FIRST, canDelete: false, canEdit: false }, { ...FIRST, key: 'outbox:g2', gone: true, note: '지웠어요', canDelete: false, canEdit: false }] })
    render(w.wrap(<ThanksPosts broadcastId="b1" onBack={() => undefined} />))
    expect(await screen.findByText('라이브 채팅이 끝나서 지우거나 고칠 수 없어요.')).toBeTruthy()
    expect(screen.getByText('지웠어요')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '지우기' })).toBeNull()
    expect(screen.queryByRole('button', { name: EDIT_TITLE })).toBeNull()
    const empty = world({ live: true, posts: [] })
    render(empty.wrap(<ThanksPosts broadcastId="b1" onBack={() => undefined} />))
    expect(await screen.findByText('아직 올라간 감사 채팅이 없어요')).toBeTruthy()
  })

  it('라이브 관리에 "올라간 감사 채팅" 줄이 있고 그 화면 경로로 간다', () => {
    const manage = readFileSync(join(__dirname, '../app/console/[id]/manage.tsx'), 'utf8')
    expect(manage).toContain("openThanks={() => router.push({ pathname: '/console/[id]/thanks', params: { id } })}")
    expect(THANKS_POSTS_TITLE).toBe('올라간 감사 채팅')
  })
})
