// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// D-UX4-73 (사용자 지시 2026-11-10 "버튼 안 텍스트는 버튼 정중앙에 와야 해 … 테스트로 자동으로 확인해 (예: 관리의 '자동 감사 채팅')"):
// 단추(button·switch·tab·checkbox·radio) 안 글자가 위아래 가운데(글자만 든 단추는 좌우도 가운데)에 오는지 짜임새로 확인한다.
// jsdom에는 배치 계산이 없어서, react-native-web이 붙인 CSS(getComputedStyle)를 단추에서 글자까지 내려가며 본다:
// - 단추가 남는 자리(최소 높이·늘어남)를 가지면 그 자리를 글자 쪽에서 가운데로 나눠야 한다(세로 틀이면 justify-content: center, 가로 틀이면 align-items: center).
// - 세로 틀 안에서 flex-grow로 위아래로 늘어난 칸은 스스로 가운데 맞춤을 해야 한다 — 옛 ToggleRow 설명 칸(이름이 위에 붙음)이 이 경우였다.
// - 위아래(글자만 든 단추는 좌우도) 안쪽 여백·테두리가 같고, 글자 쪽에 한쪽만 바깥 여백이 없다. 옆 칸이 혼자 늘어나 글자를 한쪽으로 밀지 않는다.
// 뒤로 가기(aria-label "뒤로")는 화살표 단추라 보지 않는다. 한글을 눈으로 맞추려 조금 올린 것(translateY, D-UX3-88·D-UX4-55)은 일부러라 보지 않는다.
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { HomeScreen } from '../src/screens/HomeScreen.tsx'
import { SettingsScreen } from '../src/screens/SettingsScreen.tsx'
import { SessionProvider } from '../src/services.tsx'
import { THANKS_TITLE, ThanksSwitch } from '../src/screens/console/Manage.tsx'
import { IconMenuRow, MenuGroup, MenuRow as ConsoleMenuRow, NamePill } from '../src/screens/console/parts.tsx'
import { AlertStrip } from '../src/screens/console/AlertStrip.tsx'
import { CheckText, TextButton as CustomerTextButton, TextChoices } from '../src/screens/customer-parts.tsx'
import { ChipButton, MenuRow as OrderMenuRow, TextLink } from '../src/screens/order-parts.tsx'
import { RowAction, TextAction } from '../src/screens/ParcelAddress.tsx'
import { DetailToggle, TextButton as SettingsTextButton } from '../src/screens/settings/Group.tsx'
import { DayPills, Pill } from '../src/ui/day-pills.tsx'
import { BigButton as OldBigButton } from '../src/ui/parts.tsx'
import { PasteButton } from '../src/native/paste.tsx'
import {
  AppHeader,
  BigButton,
  BottomCTA,
  ButtonRow,
  ConfirmSheet,
  HeaderTextButton,
  HeroButton,
  ListRow,
  NumberPad,
  PopupDialog,
  PressScale,
  SheetChoices,
  SmallButton,
  SoftChip,
  TabBar,
  TodoRow,
  Toast,
  ToggleRow,
  Txt,
} from '../src/ui/kit/index.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, flush, product } from './support.ts'

const ROLES = ['button', 'switch', 'tab', 'checkbox', 'radio'] as const
/** 보지 않는 단추: 뒤로 가기 화살표 */
const SKIP = new Set(['뒤로'])

const px = (value: string): number => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}
const style = (el: Element) => getComputedStyle(el)
const isText = (el: Element) => el.getAttribute('dir') === 'auto' || el.tagName === 'SPAN' || [...el.classList].some((name) => name.startsWith('css-text'))
const shown = (el: Element) => style(el).display !== 'none'
/** 글 하나이거나 글 하나만 감싼 칸 */
const textish = (el: Element): boolean => isText(el) || (el.children.length === 1 && textish(el.children[0]!))
const inFlow = (el: Element) => shown(el) && style(el).position !== 'absolute'
const grows = (el: Element) => px(style(el).flexGrow) > 0
const set = (value: string) => value !== '' && value !== 'auto' && px(value) > 0
const ownMinHeight = (el: Element) => set(style(el).minHeight) || set(style(el).height)
const ownMinWidth = (el: Element) => set(style(el).minWidth) || set(style(el).width)
const isRow = (el: Element) => style(el).flexDirection.startsWith('row')
const isFlex = (el: Element) => style(el).display.includes('flex')
const centered = (value: string) => value === 'center' || value === 'space-around' || value === 'space-evenly'
const alignOf = (parent: Element, child: Element) => {
  const self = style(child).alignSelf
  return self === '' || self === 'auto' ? style(parent).alignItems : self
}
const stretches = (value: string) => value === '' || value === 'stretch' || value === 'normal'

/** 단추 안 글자 자리(가장 바깥 글 요소)들. 그림 조각(aria-hidden — 프로필 사진 위 "라이브" 딱지 같은) 안 글자는 단추 글이 아니라 그림이라 보지 않는다 */
function textsOf(button: Element): Element[] {
  const out: Element[] = []
  const walk = (el: Element) => {
    for (const child of el.children) {
      if (!shown(child) || child.getAttribute('aria-hidden') === 'true') continue
      if (isText(child)) {
        if ((child.textContent ?? '').trim() !== '') out.push(child)
      } else walk(child)
    }
  }
  walk(button)
  return out
}

/** 글자 하나만 든 단추인가 (아이콘·점·스위치 같은 다른 조각도, 다른 글 줄도 없다) — 이때는 좌우 가운데도 본다 */
function labelOnly(button: Element): boolean {
  const walk = (el: Element): boolean =>
    [...el.children].every((child) => {
      if (!shown(child)) return true
      if (isText(child)) return true
      if (child.children.length === 0) return false
      return walk(child)
    })
  return textsOf(button).length === 1 && walk(button)
}

/** 단추가 처음부터 남는 자리를 가지는가 (스스로 최소 크기, 또는 부모가 늘림) */
function startSlack(button: Element): { v: boolean; h: boolean } {
  const parent = button.parentElement
  let v = ownMinHeight(button)
  let h = ownMinWidth(button)
  if (parent !== null && isFlex(parent) && inFlow(button)) {
    const siblings = [...parent.children].filter((el) => el !== button && inFlow(el)).length > 0
    if (isRow(parent)) {
      if (grows(button)) h = true
      if (siblings && stretches(alignOf(parent, button))) v = true
    } else {
      if (grows(button)) v = true
      if (stretches(alignOf(parent, button))) h = true
    }
  }
  return { v, h }
}

/** 이 글자가 단추 정가운데에 오지 않는 까닭 (없으면 null) */
function offCenter(button: Element, text: Element, both: boolean): string | null {
  const path: Element[] = []
  for (let el: Element | null = text; el !== null && el !== button; el = el.parentElement) path.unshift(el)
  path.unshift(button)
  let { v, h } = startSlack(button)
  for (let i = 0; i < path.length; i += 1) {
    const node = path[i]!
    const s = style(node)
    const where = i === 0 ? '단추' : node === text ? '글자 칸' : `${String(i)}단계 안쪽 칸`
    const at = `${where}: `
    if (px(s.paddingTop) !== px(s.paddingBottom)) return `${at}위(${s.paddingTop})·아래(${s.paddingBottom}) 안쪽 여백이 달라요`
    if (px(s.borderTopWidth) !== px(s.borderBottomWidth)) return `${at}위·아래 테두리 두께가 달라요`
    if (both && px(s.paddingLeft) !== px(s.paddingRight)) return `${at}왼쪽(${s.paddingLeft})·오른쪽(${s.paddingRight}) 안쪽 여백이 달라요`
    if (i > 0) {
      if (px(s.marginTop) !== px(s.marginBottom)) return `${at}위나 아래로만 바깥 여백이 있어요`
      if (both && px(s.marginLeft) !== px(s.marginRight)) return `${at}왼쪽이나 오른쪽으로만 바깥 여백이 있어요`
    }
    if (node === text) {
      if (v) return '글자 칸이 위아래로 늘어나 글자가 위에 붙어요'
      if (both && h && s.textAlign !== 'center') return `글자 칸이 좌우로 늘어났는데 글자가 가운데 정렬이 아니에요 (text-align: ${s.textAlign})`
      return null
    }
    const child = path[i + 1]!
    if (style(child).position === 'absolute') {
      const c = style(child)
      if (!(set(c.top) || c.top === '0px') || !(set(c.bottom) || c.bottom === '0px')) return `${i + 1 === path.length - 1 ? '글자 칸' : `${String(i + 1)}단계 안쪽 칸`}: 위나 아래 한쪽에만 붙어 있어요`
      v = true
      h = both ? true : h
      continue
    }
    if (!isFlex(node)) {
      v = ownMinHeight(child)
      h = ownMinWidth(child)
      continue
    }
    const others = [...node.children].filter((el) => el !== child && inFlow(el))
    const row = isRow(node)
    // 주축(가로 틀이면 가로, 세로 틀이면 세로)
    const mainSlack = row ? h : v
    const mainChecked = row ? both : true
    let nextMain = row ? ownMinWidth(child) : ownMinHeight(child)
    if (mainSlack && mainChecked) {
      if (grows(child)) nextMain = true
      else if (others.some(grows)) return `${at}옆 칸이 혼자 늘어나 글자를 ${row ? '한쪽' : '위나 아래'}으로 밀어요`
      else if (!centered(s.justifyContent)) return `${at}남는 ${row ? '폭' : '높이'}를 가운데로 나누지 않아요 (justify-content: ${s.justifyContent || '없음'})`
    } else if (mainSlack && grows(child)) nextMain = true
    // 교차축
    const crossSlack = (row ? v : h) || others.length > 0
    const crossChecked = row ? true : both
    let nextCross = row ? ownMinHeight(child) : ownMinWidth(child)
    if (crossSlack) {
      const align = alignOf(node, child)
      // 한 줄에 놓인 글들끼리 글자 밑줄(baseline)을 맞춘 것은 한 줄 글로 본다
      const textLine = row && align === 'baseline' && [child, ...others].every(textish)
      if (stretches(align)) nextCross = true
      else if (align !== 'center' && crossChecked && !textLine) return `${at}${row ? '세로' : '가로'} 가운데 맞춤이 아니에요 (align: ${align})`
    }
    if (row) {
      h = nextMain
      v = nextCross
    } else {
      v = nextMain
      h = nextCross
    }
  }
  return null
}

/** 마지막으로 본 단추 수 (검사가 헛돌지 않는지) */
let checked = 0

/** 화면 안 모든 단추를 보고 어긋난 것을 "이름: 까닭"으로 */
function offenders(root: ParentNode = document.body): string[] {
  const found: string[] = []
  const buttons = ROLES.flatMap((role) => [...root.querySelectorAll(`[role="${role}"]`)])
  checked = 0
  for (const button of buttons) {
    const name = button.getAttribute('aria-label') ?? (button.textContent ?? '').trim()
    if (SKIP.has(name) || !shown(button)) continue
    if (textsOf(button).length > 0) checked += 1
    const both = labelOnly(button)
    for (const text of textsOf(button)) {
      const why = offCenter(button, text, both)
      if (why !== null) found.push(`[${name}] "${(text.textContent ?? '').trim()}" — ${why}`)
    }
  }
  return [...new Set(found)]
}

const none = () => {}
function expectCentered(node: ReactNode | undefined, atLeast: number) {
  if (node !== undefined) render(<>{node}</>)
  const list = offenders()
  expect(list, `글자가 단추 정가운데에 있지 않아요:\n${list.join('\n')}`).toEqual([])
  expect(checked).toBeGreaterThanOrEqual(atLeast)
}

describe('단추 안 글자는 정가운데 (D-UX4-73)', () => {
  it('검사기 자체: 이름이 세로 틀에서 위아래로 늘어나면 잡는다 (옛 ToggleRow 설명 칸)', () => {
    render(
      <ButtonRow>
        <PressScale ariaLabel="좋은 단추" onPress={none} style={{ minHeight: 56, justifyContent: 'center' }}>
          <Txt>좋아요</Txt>
        </PressScale>
      </ButtonRow>,
    )
    expect(offenders()).toEqual([])
    const { unmount } = render(
      <div role="button" aria-label="나쁜 단추" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 56 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <div dir="auto">이름</div>
        </div>
      </div>,
    )
    expect(offenders().join('\n')).toContain('[나쁜 단추] "이름" — 1단계 안쪽 칸: 남는 높이를 가운데로 나누지 않아요')
    unmount()
  })

  it('큰 단추(주·보조·위험·회색, 그림·한 줄)·작은 회색 단추·옛 큰 단추', () => {
    expectCentered(
      <>
        <BottomCTA note="한 줄 도움말">
          <BigButton kind="outline" label="취소" onPress={none} />
          <BigButton label="확인" onPress={none} />
        </BottomCTA>
        <BigButton kind="secondary" label="보조" onPress={none} />
        <BigButton kind="danger" label="지우기" icon="✕" onPress={none} />
        <BigButton kind="outline" label="직접 넣기" oneLine onPress={none} />
        <BigButton label="막힘" disabled onPress={none} />
        <SmallButton label="링크를 모르겠어요" onPress={none} />
        <OldBigButton label="옛 단추" primary onPress={none} />
        <OldBigButton label="작은 옛 단추" small onPress={none} />
        <HeroButton title="라이브 시작하기" sub="유튜브 라이브를 연결해요" onPress={none} />
      </>,
    10,
    )
  })

  it('줄(ListRow·할 일 줄·설정 줄·아이콘 줄·주문 줄)', () => {
    expectCentered(
      <>
        <ListRow title="라벨 프린터" value="연결됨" onPress={none} />
        <ListRow title="부제 있는 줄" subtitle="설명" onPress={none} />
        <TodoRow count={3} tone="warn" title="입금 확인" sub="3명" onPress={none} />
        <TodoRow title="숫자 없는 줄" onPress={none} />
        <MenuGroup title="라이브">
          <ConsoleMenuRow title="라이브 연결" onPress={none} />
          <ConsoleMenuRow title="음성 설정" value="켜짐" onPress={none} />
        </MenuGroup>
        <IconMenuRow emoji="🗑" tint="#FF5A5F" title="휴지통" onPress={none} />
        <OrderMenuRow title="확인서 보내기" sub="3명" onPress={none} />
        <DetailToggle label="자세히" open={false} onPress={none} />
      </>,
    9,
    )
  })

  it('켜고 끄는 줄 — 설명(?) 없는 것·있는 것 (관리의 "자동 감사 채팅")', () => {
    expectCentered(
      <>
        <ToggleRow title="라벨 기능" on onChange={none} />
        <ToggleRow title="소리로 알려 주기" subtitle="새 찜이 들어오면 알려요." on={false} onChange={none} />
        <ToggleRow title="설명 있는 줄" on onChange={none} onHelp={none} />
        <ThanksSwitch on busy={false} onPress={none} />
      </>,
    4,
    )
    // 관리의 자동 감사 채팅 줄: 강조 바탕은 화면 끝에서 12, 글자는 24, 높이 56 이상 — 라이브 관리의 다른 줄(PlainRow)과 같다
    // (옛 기대: 카드 끝에서 8 · 글자 20 — D-UX4-94 흰 바탕 토스 설정 줄로 바뀜)
    const help = screen.getByRole('button', { name: `${THANKS_TITLE} 설명 보기` })
    const row = help.parentElement!
    const holder = row.parentElement!
    // D-UX4-100: 토스 사진과 나란히 재어 글자 22 · 켜고 끄는 줄 49 (옛 24 · 56)
    // D-UX4-130: 같은 휴대폰 사진 두 장으로 다시 재어 글자 24 · 켜고 끄는 줄 54 (옛 22 · 49) — 강조 바탕은 화면 끝에서 12
    expect(px(style(holder).paddingLeft) + px(style(row).marginLeft)).toBe(12)
    expect(px(style(holder).paddingLeft) + px(style(row).marginLeft) + px(style(row).paddingLeft)).toBe(24)
    expect(px(style(row).minHeight)).toBe(54)
  })

  it('칩·알약·글자 단추·머리 글자 단추·숫자판·탭', () => {
    expectCentered(
      <>
        <AppHeader title="라이브" right={<HeaderTextButton label="관리" ariaLabel="라이브 관리" onPress={none} />} onBack={none} />
        <SoftChip label="잔액 · 159,952원 입력" onPress={none} />
        <Pill on label="상품 3" ariaLabel="상품" onPress={none} />
        <Pill on={false} label="찜 기록 2" ariaLabel="찜 기록" onPress={none} />
        <DayPills days={['2026-10-29', '2026-10-30']} date="2026-10-29" onPick={none} />
        <NamePill text="꽃집언니" tone="win" ariaLabel="꽃집언니 찜" onPress={none} />
        <NamePill text="대기손님" tone="wait" ariaLabel="대기손님" square onPress={none} />
        <ChipButton label="보내기" onPress={none} />
        <ChipButton label="초록" green onPress={none} />
        <TextLink label="자세히 보기" onPress={none} />
        <CustomerTextButton label="고치기" onPress={none} />
        <TextChoices label="정렬" keys={['a', 'b'] as const} value="a" word={(key) => (key === 'a' ? '최근' : '이름')} spoken={(key) => key} onPick={none} />
        <CheckText label="단골만" on onPress={none} />
        <SettingsTextButton label="바꾸기" onPress={none} />
        <TextAction label="주소 고치기" onPress={none} />
        <RowAction label="복사" onPress={none} />
        <PasteButton onPaste={none} />
        <AlertStrip counts={{ pending: 2, conflict: 1 } as never} queue={null} rehearsal={false} ended={false} onAction={none} />
        <NumberPad value="12" onChange={none} />
        <TabBar active="home" onSelect={none} />
      </>,
    39,
    )
  })

  it('팝업·아래 판 단추·알림 줄 단추', () => {
    expectCentered(
      <>
        <PopupDialog visible message="지울까요?" confirmLabel="지우기" cancelLabel="아니요" onConfirm={none} onCancel={none} />
        <ConfirmSheet visible question="라이브를 끝낼까요?" confirmLabel="끝내기" onConfirm={none} onCancel={none} />
        <PopupDialog visible danger message="라이브 연결을 끊을까요?" confirmLabel="끊기" cancelLabel="취소" onConfirm={none} onCancel={none} />
        <SheetChoices label="화면 아래 창" choices={[{ value: 'a', label: '들린 말' }, { value: 'b', label: '비밀번호', description: '6자리 숫자', accent: '3단계' }]} value="a" onPick={none} />
        <Toast toast={{ id: 1, message: '지웠어요', actionLabel: '되돌리기', onAction: none }} onDismiss={none} />
      </>,
    5,
    )
  })

  it('진짜 화면: 라이브 화면과 라이브 관리(자동 감사 채팅 줄 포함)', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴' })] })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={none} />))
    await screen.findByTestId('console-screen')
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    expectCentered(undefined, 6)
    fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
    await screen.findByRole('dialog', { name: '라이브 관리' })
    expect(screen.getByRole('switch', { name: `${THANKS_TITLE} — 꺼짐` })).toBeTruthy()
    // 최소 단추 수 15 → 12 → 10: 방송 관리에서 문자찜 직접 넣기·댓글 붙여넣기·방송 끝내기(D-UX4-78·79), 휴대폰 마이크로 듣기·음성 설정(D-UX4-94) 줄을 없앴다
    // 10 → 9: 상품 미리 등록 줄을 없애고 라벨 프린트 줄은 라벨 줄로 꺼냈다(이 화면 안 관리 창에는 라벨 줄 없음, D-UX4-130)
    expectCentered(undefined, 9)
  })

  it('진짜 화면: 홈(지금 라이브 중·할 일 줄)과 설정(켜고 끄는 줄·줄)', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [BROADCAST] } }))
    world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'seller1', seller: { id: 's1', name: '김다육' } } }))
    world.server.on('GET', /^\/api\/settings\/labels$/, () => ({ body: { enabled: true, history: [], waiting: 0, rev: 1 } }))
    world.server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: {} } }))
    const nav = { openConsole: vi.fn(), openNewBroadcast: vi.fn(), openPacking: vi.fn(), openLabels: vi.fn(), openSettings: vi.fn() }
    const home = render(world.wrap(<HomeScreen nav={nav} sellerName="김다육" />))
    await screen.findByRole('button', { name: '지금 라이브 중' })
    expectCentered(undefined, 1)
    home.unmount()
    render(world.wrap(<SessionProvider services={world.services}><SettingsScreen onBack={none} /></SessionProvider>))
    await screen.findByRole('switch', { name: '라벨 기능 — 켜짐' })
    expectCentered(undefined, 6)
  })
})
