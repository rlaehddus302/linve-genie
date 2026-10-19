// 화면 위 줄 (AC-S05-01, AC-S06-01·51·52, AC-I1-20·34): 가게 이름, 프린터 상태(누르면 라벨 화면), 메뉴("방송"·"문자찜 입력"·"구매자"·"정산"·"라벨" —
// 지금 화면은 aria-current="page"), 앱 설치 안내, 로그아웃, 새 버전 안내. 메뉴는 PC에서 위 줄에, 휴대폰에서는 아래 고정 막대로 보인다(같은 메뉴, CSS가 자리만 바꾼다).
import type { MouseEvent } from 'react'
import { useInstallHint, useUpdateNotice } from '../pwa/pwa.ts'
import { printerStatusWord } from '../lib/print-words.ts'
import { menuOf, routePath, type Navigate, type Route } from '../lib/router.ts'
import { usePrintApi, usePrintState } from './print-context.tsx'

export interface TopBarProps {
  readonly shopName: string
  readonly onLogout: () => void
  readonly route: Route
  readonly navigate: Navigate
}

interface MenuItem {
  readonly key: ReturnType<typeof menuOf>
  readonly label: string
  readonly to: Route
}

/** 구매자·정산 사이를 오가면 고른 날짜·리허설을 이어 간다 */
function menuItems(route: Route): readonly MenuItem[] {
  const scope = route.name === 'buyers' || route.name === 'settlements' ? { ...(route.date === undefined ? {} : { date: route.date }), rehearsal: route.rehearsal } : { rehearsal: false }
  return [
    { key: 'broadcasts', label: '방송', to: { name: 'home' } },
    { key: 'sms', label: '문자찜 입력', to: { name: 'sms' } },
    { key: 'buyers', label: '구매자', to: { name: 'buyers', ...scope } },
    { key: 'settlements', label: '정산', to: { name: 'settlements', ...scope } },
    { key: 'labels', label: '라벨', to: { name: 'labels' } },
  ]
}

export function TopBar({ shopName, onLogout, route, navigate }: TopBarProps) {
  const current = menuOf(route)
  const go = (event: MouseEvent<HTMLAnchorElement>, to: Route) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <>
      <UpdateBanner />
      <header className="topbar">
        <p className="shop-name">{shopName}</p>
        <PrinterStatus onOpen={(event) => go(event, { name: 'labels' })} />
        <nav className="menu" aria-label="메뉴">
          {menuItems(route).map((item) => (
            <a key={item.key} className="menu-link" href={routePath(item.to)} aria-current={item.key === current ? 'page' : undefined} onClick={(event) => go(event, item.to)}>
              {item.label}
            </a>
          ))}
        </nav>
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
      <button type="button" className="button button-primary" onClick={() => void hint.install()}>
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
