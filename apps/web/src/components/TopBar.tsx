// 화면 위 줄: 가게 이름, (콘솔이면) 방송 목록으로, 로그아웃 (AC-S05-01)
import { routePath, type Route } from '../lib/router.ts'

export interface TopBarProps {
  readonly shopName: string
  readonly onLogout: () => void
  readonly navigate?: (route: Route) => void
}

export function TopBar({ shopName, onLogout, navigate }: TopBarProps) {
  return (
    <header className="topbar">
      <p className="shop-name">{shopName}</p>
      <nav className="topbar-actions" aria-label="화면 이동">
        {navigate !== undefined ? (
          <a
            className="button"
            href={routePath({ name: 'home' })}
            onClick={(event) => {
              event.preventDefault()
              navigate({ name: 'home' })
            }}
          >
            방송 목록
          </a>
        ) : null}
        <button type="button" className="button" onClick={onLogout}>
          로그아웃
        </button>
      </nav>
    </header>
  )
}
