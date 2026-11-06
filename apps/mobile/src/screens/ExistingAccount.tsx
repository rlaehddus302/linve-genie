// "이미 가입한 적이 있어요" (D-UX3-59, 사용자 지시 2026-11-07 "이미 가입된 번호라고 하면 기존 계정과 연결해줘야지 … 이미 존재하는 소셜 계정 보여주고 각각의 이메일.
// 그리고 마지막 로그인 언젠지도 보여주고 … 제목에는 "이미 가입한 적이 있어요" 그 아래에는 "해당 계정에 연결하고 로그인할게요" 하고 그 아래에는 이미 존재하는 계정들 나열").
// 번호 확인과 같은 틀(‹·제목·아래 단추·왼쪽 끝 밀기). 아이디는 고르지 않는다 — [연결하기] 하나가 가장 최근에 쓴 간편 로그인으로 들어가 지금 공급자를 잇는다
// (번호만으로 잇지 않는다 — 다시 배정된 번호로 남의 판매자 계정을 가져가지 못하게, D-UX3-30).
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import {
  EXISTING_BODY,
  EXISTING_GO,
  EXISTING_TITLE,
  existingBody,
  lastLoginText,
  latestLogin,
  POPUP_CLOSE,
  PROVIDER_NAMES,
  START_OVER,
  VERIFY_LEAVE_GO,
  VERIFY_LEAVE_TEXT,
  VERIFY_LEAVE_TITLE,
  type ExistingLogin,
  type LoginProvider,
} from '@livejjim/web/src/lib/social-login.ts'
import { SOCIAL_LOGOS } from '@livejjim/web/src/lib/social-logos.ts'
import { BigButton, ErrorLine, PopupDialog, Txt, useKit, useWhiteTop } from '../ui/kit/index.ts'
import { SHEET_OUT_MS } from '../ui/kit/sheets.tsx'
import { PAGE, RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { QuestionPage } from './PhoneVerify.tsx'

export interface ExistingAccountProps {
  /** 가린 번호 (010-****-6666) — 간편 로그인이 없는 계정에서만 문장에 쓴다 */
  readonly phone: string
  /** 지금 가입하려던 공급자 */
  readonly provider: LoginProvider
  readonly accounts: readonly ExistingLogin[]
  /** 로그인하러 간 공급자 (그동안 단추가 바쁨) */
  readonly moving: LoginProvider | null
  readonly message: string | null
  readonly onLink: (provider: LoginProvider) => void
  /** 처음으로 */
  readonly onLeave: () => void
}

export function ExistingAccount({ phone, provider, accounts, moving, message, onLink, onLeave }: ExistingAccountProps) {
  useWhiteTop()
  const latest = latestLogin(accounts)
  // 뒤로(‹·왼쪽 끝 밀기)도 나가면 처음부터라 번호 확인과 같이 "다음에 할까요?"를 묻는다 (D-UX3-55)
  const [leave, setLeave] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  const askLeave = () => {
    if (moving === null) setLeave(true)
  }
  const goLeave = () => {
    setLeave(false)
    timer.current = setTimeout(onLeave, SHEET_OUT_MS + 40)
  }
  return (
    <>
      <QuestionPage
        title={EXISTING_TITLE}
        backLabel="뒤로"
        onBack={askLeave}
        testID="login-existing"
        footer={
          latest === null ? (
            <BigButton label={START_OVER} onPress={onLeave} />
          ) : (
            <BigButton label={EXISTING_GO} busy={moving !== null} onPress={() => onLink(latest.provider)} testID="existing-link" />
          )
        }
      >
        <View style={{ marginTop: SPACE.sm }}>
          <Txt step="body" color="textSub">
            {latest === null ? existingBody(phone, [], provider) : EXISTING_BODY}
          </Txt>
        </View>
        {accounts.length > 0 ? <AccountCard accounts={accounts} /> : null}
        {message !== null ? (
          <View style={{ marginTop: SPACE.lg }}>
            <ErrorLine>{message}</ErrorLine>
          </View>
        ) : null}
      </QuestionPage>
      <PopupDialog visible={leave} message={VERIFY_LEAVE_TITLE} description={VERIFY_LEAVE_TEXT} cancelLabel={POPUP_CLOSE} confirmLabel={VERIFY_LEAVE_GO} onCancel={() => setLeave(false)} onConfirm={goLeave} />
    </>
  )
}

/** 있는 계정 한 장: 공급자마다 로고·이름과 가린 이메일, 맨 아래 마지막 로그인 (토스 카드 — 흰 바탕·얇은 회색 테·모서리 20) */
function AccountCard({ accounts }: { readonly accounts: readonly ExistingLogin[] }) {
  const { p } = useKit()
  const latest = latestLogin(accounts)
  const last = latest?.lastLoginAt === null || latest === null ? null : lastLoginText(latest.lastLoginAt)
  return (
    <View
      testID="existing-accounts"
      style={{ marginTop: PAGE.titleGap, padding: SPACE.xl, gap: SPACE.md, borderRadius: RADIUS.xl, borderCurve: 'continuous', borderWidth: 1, borderColor: p.line, backgroundColor: p.surface }}
    >
      {accounts.map((account) => (
        <View key={account.provider} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Logo provider={account.provider} />
            <Txt step="meta" color="textSub">
              {PROVIDER_NAMES[account.provider]}
            </Txt>
          </View>
          <Txt step="body" weight="medium">
            {account.label === '' ? `${PROVIDER_NAMES[account.provider]} 계정` : account.label}
          </Txt>
        </View>
      ))}
      {last !== null ? (
        <Txt step="meta" color="textSub">
          {last}
        </Txt>
      ) : null}
    </View>
  )
}

function Logo({ provider }: { readonly provider: LoginProvider }) {
  const logo = SOCIAL_LOGOS[provider]
  return (
    <Svg width={16} height={16} viewBox={logo.viewBox} aria-hidden>
      {logo.paths.map((path) => (
        <Path key={path.d} d={path.d} fill={path.fill} />
      ))}
    </Svg>
  )
}
