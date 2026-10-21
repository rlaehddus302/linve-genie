// 화면 위 줄 (AC-S05-01, AC-S06-01·51·52, AC-I1-20·34, AC-I3-44·63, AC-N4a-10·13·18, I2 AC-I2-02·35, AC-N3-40, AC-NAV-01~10): 가게 이름, 프린터 상태(누르면 라벨 화면),
// 메뉴(지금 화면은 aria-current="page"), 앱 설치 안내, 로그아웃, 새 버전 안내. 메뉴 항목·순서는 lib/menu.ts 한 곳에서 정한다.
// - PC(48rem 이상): 모든 메뉴가 위 줄에 링크로 — "방송"·"문자찜 입력"·"구매자"·"정산"·"입금 확인"·"포장"·"라벨"·"설정", 더보기 없음.
// - 휴대폰(48rem 미만, D-NAV-01): 아래 고정 막대 한 줄 다섯 칸 — 앞 네 칸 링크 + "더보기" 버튼(aria-expanded). 누르면 막대 바로 위에 나머지 목록.
//   다시 누르기·Esc(포커스는 "더보기"로)·목록 밖 누르기(아무 데도 가지 않는다)·항목 고르기·화면 바뀜이면 닫힌다. 닫힌 목록은 그리지 않는다(화면 읽기에도 없다).
//   지금 화면이 목록 안이면 "더보기"와 그 항목이 aria-current="page". "더보기"에는 수를 붙이지 않는다 — "입금 확인 3"은 목록 안에서 보인다.
// 확인 필요 입금이 있으면 "입금 확인 3"처럼 수를 글자로 붙인다(색만으로 알리지 않는다).
// 보조자 계정은 가게 이름 + "보조자", 메뉴는 "문자찜 입력"뿐이다(프린터 상태·더보기도 없다 — 보조자는 출력·입금 확인을 쓰지 않는다).
// 요금 기능이 켜져 있으면 판매자 메뉴에 "요금"(N5, AC-N5-50) — 새 메뉴 규칙(D-NAV-01 (9))대로 더보기 목록·PC 모두 "설정" 바로 앞(AC-NAV-09). 꺼져 있으면 메뉴가 그대로다.
// 라벨 기능이 꺼져 있거나 켬/끔을 아직 모르면 프린터 상태와 메뉴 "라벨"을 만들지 않는다(L-13 9) — "설정"을 비롯한 다른 메뉴는 그대로다.
// 라벨 켬/끔을 바꾸는 "설정"은 메뉴 항목 하나다(I3 AC-I3-44 — N4a의 위 줄 "설정" 링크는 합치며 메뉴 항목으로 모았다, D-N4a-07).
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { useInstallHint, useUpdateNotice } from '../pwa/pwa.ts'
import { printerStatusWord } from '../lib/print-words.ts'
import { menuAll, menuLayout, type MenuItem } from '../lib/menu.ts'
import { menuOf, routePath, type MenuKey, type Navigate, type Route } from '../lib/router.ts'
import { useWide } from '../lib/use-wide.ts'
import { useDepositReview } from './deposit-context.tsx'
import { useBillingConfig } from './billing-context.tsx'
import { useLabelsEnabled, usePrintApi, usePrintState } from './print-context.tsx'

export interface TopBarProps {
  readonly shopName: string
  /** 보조자 계정 (메뉴는 문자찜 입력뿐) */
  readonly assistant?: boolean
  readonly onLogout: () => void
  readonly route: Route
  readonly navigate: Navigate
}

type Go = (event: MouseEvent<HTMLAnchorElement>, to: Route) => void

export function TopBar({ shopName, assistant = false, onLogout, route, navigate }: TopBarProps) {
  const review = useDepositReview()
  const billing = useBillingConfig()?.enabled === true
  const labels = useLabelsEnabled() === true
  const wide = useWide()
  const go: Go = (event, to) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  const layout = menuLayout({ route, assistant, labels, review, billing })
  const current = menuOf(route)
  return (
    <>
      <UpdateBanner />
      <header className="topbar">
        <p className="shop-name">
          {shopName}
          {assistant ? <span className="tag tag-assistant">보조자</span> : null}
        </p>
        {assistant || !labels ? null : <PrinterStatus onOpen={(event) => go(event, { name: 'labels' })} />}
        {assistant ? (
          <nav className="menu menu-single" aria-label="메뉴">
            <MenuLinks items={layout.bar} current={current} go={go} />
          </nav>
        ) : wide ? (
          <nav className="menu" aria-label="메뉴">
            <MenuLinks items={menuAll(layout)} current={current} go={go} />
          </nav>
        ) : (
          <PhoneMenu bar={layout.bar} more={layout.more} current={current} go={go} routeKey={routePath(route)} />
        )}
        <div className="topbar-actions">
          <InstallButton />
          <button type="button" className="button" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>
      <IosInstallHint />
    </>
  )
}

function MenuLinks({ items, current, go, onPick }: { readonly items: readonly MenuItem[]; readonly current: MenuKey | null; readonly go: Go; readonly onPick?: () => void }) {
  return items.map((item) => (
    <a
      key={item.key}
      className="menu-link"
      href={routePath(item.to)}
      aria-current={item.key === current ? 'page' : undefined}
      onClick={(event) => {
        onPick?.()
        go(event, item.to)
      }}
    >
      {item.label}
      {item.count === undefined ? null : (
        <>
          {' '}
          <span className="menu-count">{item.count}</span>
        </>
      )}
    </a>
  ))
}

/**
 * 휴대폰 메뉴 (D-NAV-01, AC-NAV-01~07): 막대 다섯 칸 + "더보기" 목록.
 * 화면(주소)이 바뀌면(뒤로 가기 포함) 그리는 중에 바로 닫는다 — 바뀐 화면에 열린 목록이 한 번도 보이지 않는다.
 */
function PhoneMenu({ bar, more, current, go, routeKey }: { readonly bar: readonly MenuItem[]; readonly more: readonly MenuItem[]; readonly current: MenuKey | null; readonly go: Go; readonly routeKey: string }) {
  const [open, setOpen] = useState(false)
  const [shownAt, setShownAt] = useState(routeKey)
  if (shownAt !== routeKey) {
    setShownAt(routeKey)
    if (open) setOpen(false)
  }
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const here = more.some((item) => item.key === current)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    // Esc는 목록만 닫는다 — 콘솔 단축키 등 다른 Esc 동작으로 넘기지 않는다
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      {/* 목록 밖 누르기: 아래 화면을 덮어 아무 데도 가지 않고 닫는다 (마우스·손가락 전용 — 키보드는 Esc) */}
      {open ? <div className="menu-more-backdrop" aria-hidden="true" onClick={close} /> : null}
      <nav className={open ? 'menu menu-open' : 'menu'} aria-label="메뉴">
        <MenuLinks items={bar} current={current} go={go} />
        <button
          ref={button}
          type="button"
          className="menu-link menu-more"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-current={here ? 'page' : undefined}
          onClick={() => setOpen(!open)}
        >
          더보기
        </button>
        {open ? (
          <ul id={listId} className="menu-more-list">
            {more.map((item) => (
              <li key={item.key}>
                <MenuLinks items={[item]} current={current} go={go} onPick={close} />
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
    </>
  )
}

/** 프린터 상태 (AC-I1-34): "프린터 PC · 연결됨 · 대기 2장" / "출력 기기 없음 · 대기 3장" / "출력 멈춤 · 대기 5장" — 누르면 라벨 화면 */
function PrinterStatus({ onOpen }: { readonly onOpen: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const api = usePrintApi()
  const print = usePrintState()
  if (api === null) return null
  const queue = print.overview?.queue ?? null
  const paused = queue?.pause != null
  return (
    <a className={paused ? 'printer-status printer-status-alert' : 'printer-status'} href={routePath({ name: 'labels' })} onClick={onOpen}>
      {printerStatusWord(queue)}
    </a>
  )
}

/** "앱으로 설치" (브라우저가 설치를 제안할 수 있을 때만) */
function InstallButton() {
  const hint = useInstallHint()
  if (!hint.canInstall) return null
  return (
    <span className="install row">
      <button type="button" className="button" onClick={() => void hint.install()}>
        앱으로 설치
      </button>
      <button type="button" className="button" aria-label="앱 설치 안내 닫기" onClick={hint.dismiss}>
        닫기
      </button>
    </span>
  )
}

/** 아이폰 사파리: 공유 → 홈 화면에 추가 */
function IosInstallHint() {
  const hint = useInstallHint()
  if (!hint.iosHint) return null
  return (
    <div className="install-hint row" role="note">
      <p>사파리 아래 공유 버튼 → '홈 화면에 추가'를 눌러 주세요.</p>
      <button type="button" className="button" aria-label="앱 설치 안내 닫기" onClick={hint.dismiss}>
        닫기
      </button>
    </div>
  )
}

/** 새 버전 안내 (D-093): 저절로 다시 열지 않는다 */
function UpdateBanner() {
  const update = useUpdateNotice()
  if (!update.available) return null
  return (
    <div className="update-banner row" role="status">
      <p>새 버전이 있어요. 방송이 끝나면 새로고침해 주세요.</p>
      <button type="button" className="button" onClick={update.apply}>
        지금 새로고침
      </button>
    </div>
  )
}
