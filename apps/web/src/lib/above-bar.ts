// 휴대폰 아래 메뉴 막대 위로 보이게 (U-MOB1-01): 막대는 화면 아래에 붙어 있어(position: fixed) 브라우저는 그 뒤에 깔린 칸도 "보인다"고 여긴다 —
// 포커스를 옮기거나 Enter를 쳐도 화면이 움직이지 않아 큰 글씨 휴대폰에서 빠른 입력칸·"n번을 등록했어요 · 되돌리기"가 막대 뒤에서 보이지 않았다.
// 그래서 빠른 입력 묶음(입력칸부터 되돌리기 띠까지)의 아래 끝이 막대 위 끝보다 아래면 그만큼 화면을 올린다. 입력칸 위 끝은 화면 위로 넘기지 않는다
// (묶음이 화면보다 길면 입력칸이 먼저). 묶음이 위에 붙는 고정 영역(position: sticky) 안이면 그 영역이 위에 닿을 때까지만 올린다 —
// 닿은 뒤로는 올려도 묶음이 움직이지 않고 뒤 내용만 밀린다. PC(막대가 화면 아래에 붙지 않음)에서는 아무것도 하지 않는다.

import { useEffect, type RefObject } from 'react'

/** 막대와 칸 사이에 남길 틈(px) */
export const BAR_GAP = 8

/**
 * 올릴 거리(px, 0이면 그대로).
 * regionBottom: 보이게 할 묶음의 아래 끝, inputTop: 입력칸 위 끝, barTop: 막대 위 끝, stickyRoom: 고정 영역이 위에 닿기까지 남은 거리(없으면 무한) — 모두 화면(뷰포트) 좌표
 */
export function liftBy(regionBottom: number, inputTop: number, barTop: number, stickyRoom: number = Number.POSITIVE_INFINITY, gap: number = BAR_GAP): number {
  const need = regionBottom + gap - barTop
  if (need <= 0) return 0
  return Math.max(0, Math.round(Math.min(need, inputTop - gap, stickyRoom)))
}

/** 화면 아래에 붙은 메뉴 막대의 위 끝 (휴대폰). 막대가 없거나 붙어 있지 않으면 null */
export function fixedBarTop(doc: Document = document): number | null {
  const bar = doc.querySelector<HTMLElement>('nav.menu')
  if (bar === null) return null
  const view = doc.defaultView
  if (view === null || view.getComputedStyle(bar).position !== 'fixed') return null
  return bar.getBoundingClientRect().top
}

/** region(빠른 입력 묶음)이 막대 뒤에 깔리면 화면을 올린다. input: 그 안의 입력칸(없으면 묶음 위 끝) */
export function keepAboveBar(region: HTMLElement | null, input: HTMLElement | null): void {
  if (region === null || !region.isConnected) return
  const barTop = fixedBarTop(region.ownerDocument)
  if (barTop === null) return
  const box = region.getBoundingClientRect()
  const top = input?.isConnected === true ? input.getBoundingClientRect().top : box.top
  const view = region.ownerDocument.defaultView
  const sticky = region.closest<HTMLElement>('.console-sticky')
  const stickyRoom = sticky === null || view === null ? Number.POSITIVE_INFINITY : sticky.getBoundingClientRect().top - (Number.parseFloat(view.getComputedStyle(sticky).top) || 0)
  const lift = liftBy(box.bottom, top, barTop, stickyRoom)
  if (lift > 0) view?.scrollBy({ top: lift, left: 0, behavior: 'instant' })
}

/**
 * 빠른 입력 묶음을 막대 위에 둔다 (U-MOB1-01): 묶음 안으로 포커스가 들어올 때(콘솔을 열 때의 첫 포커스 포함), 포커스가 묶음 안에 있는 동안
 * 묶음·위 줄의 크기가 바뀔 때(되돌리기 띠·오류가 생김, 알림 띠가 늘어남)와 화면 높이가 바뀔 때(키보드). 그리고 나서 다음 그리기에서 잰다.
 * watch: 묶음 위에서 크기가 바뀌면 묶음을 밀어내는 요소(콘솔 위 줄)
 */
export function useKeepAboveBar(region: RefObject<HTMLElement | null>, input: RefObject<HTMLElement | null>, watch: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = region.current
    if (box === null) return
    const view = box.ownerDocument.defaultView
    if (view === null) return
    let frame: number | null = null
    const run = () => {
      if (frame !== null) return
      frame = view.requestAnimationFrame(() => {
        frame = null
        if (box.contains(box.ownerDocument.activeElement)) keepAboveBar(box, input.current)
      })
    }
    box.addEventListener('focusin', run)
    view.addEventListener('resize', run)
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(run) : null
    observer?.observe(box)
    if (watch.current !== null) observer?.observe(watch.current)
    run()
    return () => {
      box.removeEventListener('focusin', run)
      view.removeEventListener('resize', run)
      observer?.disconnect()
      if (frame !== null) view.cancelAnimationFrame(frame)
    }
  }, [region, input, watch])
}
