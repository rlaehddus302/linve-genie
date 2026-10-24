// 공개 소개 화면 (LND1, SPEC §7 화면 17, D-LND1-03~05·09): 로그아웃 상태의 `/`를 브라우저 탭에서 열면 보인다.
// 서비스 이름·한 줄 소개·"로그인"(`/login`)·"시작하기"(같은 화면의 "시작하려면" 절로)·판매자의 하루·구글 사용자 데이터 고지·정책 링크·운영 사업자.
// 위 줄 메뉴·로그아웃·그림 없음. 서버 요청을 보내지 않는다(로그인 확인 `/api/me`는 App이 이미 했다). 가입 화면·링크 없음(SYS-01).
import type { MouseEvent } from 'react'
import { SERVICE_NAME } from '../brand.ts'
import {
  contactEmail,
  LANDING_DAY_STEPS,
  LANDING_ENGLISH,
  LANDING_ENGLISH_CAPTION,
  LANDING_GOOGLE_ITEMS,
  LANDING_HEADINGS,
  LANDING_LIMITED_USE_AFTER,
  LANDING_LIMITED_USE_BEFORE,
  LANDING_LIMITED_USE_LINK,
  LANDING_LOGIN,
  LANDING_START_BUTTON,
  LANDING_START_LOGIN,
  LANDING_START_TEXT,
  LANDING_TAGLINE,
  operatorLines,
  USER_DATA_POLICY_URL,
} from '../lib/landing.ts'
import { OPERATOR, type Operator } from '../operator.ts'

const START_ID = 'landing-start'

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

export function LandingPage({ operator = OPERATOR, onLogin }: { readonly operator?: Operator; readonly onLogin: () => void }) {
  const email = contactEmail(operator)
  const toLogin = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return
    event.preventDefault()
    onLogin()
  }
  const toStart = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return
    // 기록·주소를 바꾸지 않고 "시작하려면" 절로 움직인다 (가입 화면이 아니다 — 계정 받는 법)
    event.preventDefault()
    const heading = document.getElementById(`${START_ID}-title`)
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }
  return (
    <main className="page landing stack">
      <h1>{SERVICE_NAME}</h1>
      <p className="landing-tagline">{LANDING_TAGLINE}</p>
      <div className="row landing-actions">
        <a
          className="button button-primary"
          href="/login"
          onClick={toLogin}
        >
          {LANDING_LOGIN}
        </a>
        <a className="button" href={`#${START_ID}`} onClick={toStart}>
          {LANDING_START_BUTTON}
        </a>
      </div>

      <section className="stack-tight" aria-labelledby="landing-day-title">
        <h2 id="landing-day-title">{LANDING_HEADINGS.day}</h2>
        <ol className="landing-list">
          {LANDING_DAY_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section id={START_ID} className="stack-tight" aria-labelledby={`${START_ID}-title`}>
        <h2 id={`${START_ID}-title`} tabIndex={-1}>
          {LANDING_HEADINGS.start}
        </h2>
        <p>{LANDING_START_TEXT}</p>
        {email !== null ? (
          <p>
            계정 문의: <a className="text-link" href={`mailto:${email}`}>{email}</a>
          </p>
        ) : null}
        <div className="row">
          <a className="button button-primary landing-start-login" href="/login" onClick={toLogin}>
            {LANDING_START_LOGIN}
          </a>
        </div>
      </section>

      <section className="stack-tight" aria-labelledby="landing-google-title">
        <h2 id="landing-google-title">{LANDING_HEADINGS.google}</h2>
        <ul className="landing-list">
          {LANDING_GOOGLE_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          {LANDING_LIMITED_USE_BEFORE}
          <a className="text-link text-link-inline" href={USER_DATA_POLICY_URL} rel="noopener noreferrer">
            {LANDING_LIMITED_USE_LINK}
          </a>
          {LANDING_LIMITED_USE_AFTER}
        </p>
        <p className="landing-english-caption">{LANDING_ENGLISH_CAPTION}</p>
        <p lang="en" className="landing-english">
          {LANDING_ENGLISH}
        </p>
      </section>

      <nav className="row policy-links" aria-label="약관">
        <a href="/privacy">개인정보처리방침</a>
        <a href="/terms">이용약관</a>
      </nav>

      <section className="stack-tight" aria-labelledby="landing-operator-title">
        <h2 id="landing-operator-title">{LANDING_HEADINGS.operator}</h2>
        <ul className="landing-operator">
          {operatorLines(operator).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
