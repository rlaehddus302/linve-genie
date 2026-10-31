// 화면 위 줄 (AC-S05-01, AC-S06-01·51·52, AC-I1-20·34, AC-I3-44·63, AC-N4a-10·13·18, I2 AC-I2-02·35, AC-N3-40, AC-NAV-01~10): 가게 이름, 프린터 상태(누르면 라벨 화면),
// 메뉴(지금 화면은 aria-current="page"), 앱 설치 안내, 로그아웃(휴대폰 판매자는 "더보기" 맨 끝 — D-MOB1-05), 새 버전 안내. 메뉴 항목·순서는 lib/menu.ts 한 곳에서 정한다.
// - PC(48rem 이상): 모든 메뉴가 위 줄에 링크로 — "방송"·"문자찜 입력"·"구매자"·"정산"·"입금 확인"·"포장"·"라벨"·"설정", 더보기 없음.
// - 휴대폰(48rem 미만, D-NAV-01): 아래 고정 막대 한 줄 다섯 칸 — 앞 네 칸 링크 + "더보기" 버튼(aria-expanded). 누르면 막대 바로 위에 나머지 목록.
//   다시 누르기·Esc(포커스는 "더보기"로)·목록 밖 누르기(아무 데도 가지 않는다)·항목 고르기·화면 바뀜이면 닫힌다. 닫힌 목록은 그리지 않는다(화면 읽기에도 없다).
//   지금 화면이 목록 안이면 "더보기"와 그 항목이 aria-current="page". "더보기"에는 수를 붙이지 않는다 — "입금 확인 3"은 목록 안에서 보인다.
// 확인 필요 입금이 있으면 "입금 확인 3"처럼 수를 글자로 붙인다(색만으로 알리지 않는다).
// 보조자 계정은 가게 이름 + "보조자", 메뉴는 "문자찜 입력"뿐이다(프린터 상태·더보기도 없다 — 보조자는 출력·입금 확인을 쓰지 않는다).
// 요금 기능이 켜져 있으면 판매자 메뉴에 "요금"(N5, AC-N5-50) — 새 메뉴 규칙(D-NAV-01 (9))대로 더보기 목록·PC 모두 "설정" 바로 앞(AC-NAV-09). 꺼져 있으면 메뉴가 그대로다.
// 라벨 기능이 꺼져 있거나 켬/끔을 아직 모르면 프린터 상태와 메뉴 "라벨"을 만들지 않는다(L-13 9) — "설정"을 비롯한 다른 메뉴는 그대로다.
// 이 기기가 출력 기기이고 끊김으로 멈췄으면 프린터 상태 옆에 보통 버튼 "다시 연결" — 한 번 누르면 마지막으로 쓴 연결 방법으로 그 누름 안에서 다시 잇는다
// (D-WIZ-01, AC-WIZ-04). 다른 기기·그 방법이 없는 브라우저·손으로 푸는 멈춤이면 버튼 없이 상태를 눌러 라벨 화면으로 간다. 저절로 다시 잇지 않는다.
// 화면 안에 프린터 칸·출력 멈춤 띠가 떠 있으면(라벨 화면·마법사 4/5·"출력 멈춤" 창) 그쪽이 "다시 연결"을 맡아 위 줄 버튼은 숨는다 (QL2 D-QL2-03 (c)).
// 라벨 켬/끔을 바꾸는 "설정"은 메뉴 항목 하나다(I3 AC-I3-44 — N4a의 위 줄 "설정" 링크는 합치며 메뉴 항목으로 모았다, D-N4a-07).
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { useInstallHint, useUpdateNotice } from '../pwa/pwa.ts'
import { PRINT_ACTION, printerStatusWord } from '../lib/print-words.ts'
import { awaitingTest } from '../lib/printer-station.ts'
import { useReconnectOwned } from '../lib/reconnect-owner.ts'
import { barLabel, menuAll, menuLayout, type MenuItem } from '../lib/menu.ts'
import { menuOf, routePath, type MenuKey, type Navigate, type Route } from '../lib/router.ts'
import { useWide } from '../lib/use-wide.ts'
import { useDepositReview } from './deposit-context.tsx'
import { useBillingConfig } from './billing-context.tsx'
import { isAppTab } from '../lib/app-tab.ts'
import { LogoutButton } from './LogoutButton.tsx'
import { useLabelsEnabled, usePrintApi, usePrintState, useStationState } from './print-context.tsx'

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
  // 앱에서 연 탭에는 메뉴 "요금"이 없다 (PAY2 BL-11 3)
  const billing = useBillingConfig()?.enabled === true && !isAppTab()
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
            <MenuLinks items={layout.bar} current={current} go={go} short={!wide} />
          </nav>
        ) : wide ? (
          <nav className="menu" aria-label="메뉴">
            <MenuLinks items={menuAll(layout)} current={current} go={go} />
          </nav>
        ) : (
          <PhoneMenu bar={layout.bar} more={layout.more} current={current} go={go} routeKey={routePath(route)} onLogout={onLogout} />
        )}
        <div className="topbar-actions">
          <InstallButton />
          {/* 휴대폰 판매자는 "더보기" 목록 맨 끝에 (D-MOB1-05) — PC·보조자는 여기 그대로 */}
          {wide || assistant ? <LogoutButton onLogout={onLogout} assistant={assistant} className="button" /> : null}
        </div>
      </header>
      {/* 휴대폰 라이브 콘솔에서는 띄우지 않는다: 위 고정 영역을 밀어 스크롤 0에서 빠른 입력칸이 아래 메뉴에 가려진다(U-MOB2-01, D-MOB2-03).
          방송 목록 등 다른 화면에서는 그대로 보이고, 거기서 닫으면 이 기기에서 다시 보이지 않는다 */}
      {wide || route.name !== 'console' ? <IosInstallHint /> : null}
    </>
  )
}

function MenuLinks({ items, current, go, onPick, short = false }: { readonly items: readonly MenuItem[]; readonly current: MenuKey | null; readonly go: Go; readonly onPick?: () => void; readonly short?: boolean }) {
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
      {/* 휴대폰 막대 칸 이름은 barLabel 하나로 그린다 — 단위 시험이 검사하는 함수와 같은 길 (MOB1 D-MOB1-17 (4), AC-MOB1-04) */}
      {short ? barLabel(item) : item.label}
      {short || item.count === undefined ? null : (
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
function PhoneMenu({
  bar,
  more,
  current,
  go,
  routeKey,
  onLogout,
}: {
  readonly bar: readonly MenuItem[]
  readonly more: readonly MenuItem[]
  readonly current: MenuKey | null
  readonly go: Go
  readonly routeKey: string
  readonly onLogout: () => void
}) {
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
        <MenuLinks items={bar} current={current} go={go} short />
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
            {/* 로그아웃은 맨 끝("설정" 다음) 버튼 — 링크가 아니다(AC-NAV-02는 링크만 센다). 위험할 때만 확인 창(D-MOB1-05) */}
            <li>
              <LogoutButton onLogout={onLogout} assistant={false} className="menu-link menu-logout" />
            </li>
          </ul>
        ) : null}
      </nav>
    </>
  )
}

/**
 * 프린터 상태 (AC-I1-34): "프린터 PC · 연결됨 · 대기 2장" / "출력 기기 없음 · 대기 3장" / "출력 멈춤 · 대기 5장" — 누르면 라벨 화면.
 * 끊김 멈춤이고 이 기기가 출력 기기이며 마지막 연결 방법이 이 브라우저에 있으면 옆에 "다시 연결"(AC-WIZ-04)
 */
function PrinterStatus({ onOpen }: { readonly onOpen: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const api = usePrintApi()
  const print = usePrintState()
  const station = useStationState()
  const [busy, setBusy] = useState(false)
  /** 이 버튼으로 다시 이으려다 실패했다 — 그 오류 문장은 이 버튼 옆에만 보인다(라벨 화면 멈춤 띠의 같은 문장과 겹치지 않게) */
  const [mineError, setMineError] = useState<unknown>(null)
  // 화면 안 프린터 칸·출력 멈춤 띠가 "다시 연결"을 맡으면 위 줄은 숨는다 — 한 화면 하나 (QL2 D-QL2-03 (c))
  const owned = useReconnectOwned()
  if (api === null) return null
  const queue = print.overview?.queue ?? null
  const paused = queue?.pause != null
  // 실험 기종이 테스트 "예"를 기다리는 멈춤은 프린터가 이어져 있다 — "다시 연결"이 아니다 (D-PRN2-10)
  const canReconnect = !owned && queue?.pause?.reason === 'DISCONNECTED' && api.station.isMine(queue) && api.station.canReconnect && !(station !== null && awaitingTest(station))
  const reconnect = async () => {
    if (busy) return
    setBusy(true)
    try {
      const ok = await api.station.reconnect()
      setMineError(ok ? null : api.station.getSnapshot().connectError)
    } finally {
      setBusy(false)
    }
  }
  const failed = canReconnect && mineError !== null && station !== null && station.connectError === mineError ? station.connectError : null
  return (
    <span className="printer-status-group">
      <a className={paused ? 'printer-status printer-status-alert' : 'printer-status'} href={routePath({ name: 'labels' })} onClick={onOpen}>
        {printerStatusWord(queue)}
      </a>
      {canReconnect ? (
        <button type="button" className="button" disabled={busy || station?.connecting === true} onClick={() => void reconnect()}>
          {PRINT_ACTION.reconnect}
        </button>
      ) : null}
      {failed !== null ? (
        <span className="field-error printer-status-error" role="alert">
          {failed.message}
        </span>
      ) : null}
    </span>
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
