// 확인서 링크(/r/<토큰>)의 손님 장부 HTML 조각 (KP1, CUSTOMER_RULES CR-2·CR-3·CR-5). 스크립트 없는 서버 HTML — 모든 글은 이스케이프한다.
// - 동의 칸: 배송지 양식 안, 저장 버튼 위에 처음 빈 체크 칸 + 문구 판 CR-CONSENT-1.
// - 장부 칸(<section id="ledger">): 가린 이름·연락처 끝 4자리만(주소 원문 없음) + [저장한 정보 지우기]·[다른 계정도 잇기], 연결 코드·확인 기다림.
import { CR_CONSENT_1 } from './ledger-rules.ts'
import type { LinkLedgerView } from './ledger.ts'

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&#39;'))

/** 링크 장부 칸 위 한 문장 (?ledger=…) */
export const LEDGER_LINK_NOTICES = {
  deleted: '지웠어요.',
  linked: '계정을 이었어요.',
  unlinked: '잇지 않았어요. 필요하면 새 코드를 받아 주세요.',
  full: '잠시 뒤 다시 받아 주세요.',
} as const
export type LedgerLinkNotice = keyof typeof LEDGER_LINK_NOTICES

export const LEDGER_LINK_TEXT = {
  heading: '저장해 둔 배송지',
  saved: (name: string, last4: string) => `저장해 둔 배송지가 있어요 (받는 분 ${name} · 연락처 끝 ${last4})`,
  delete: '저장한 정보 지우기',
  confirmDelete: '저장한 배송지를 지울까요? 이번 주문 배송지는 그대로예요.',
  deleteButton: '지우기',
  keep: '그대로 두기',
  linkButton: '다른 계정도 잇기',
  codeIntro: '라이브 방송 채팅에 아래 두 낱말만 쳐 주세요. 24시간 동안 한 번 쓸 수 있어요.',
  codeUntil: (time: string) => `${time}까지`,
  claim: (platform: string, name: string, last4: string) => `${platform} '${name}'(끝 ${last4})이 코드를 쳤어요. 내 계정이 맞나요?`,
  yes: '네, 제 계정이에요',
  no: '아니에요',
  prefill: (name: string, last4: string) => `지난번 배송지로 보낼게요 (받는 분 ${name} · 연락처 끝 ${last4}). 바뀌었으면 다시 적어 주세요.`,
} as const

/** 배송지 양식 안의 동의 칸 (처음 빔 — checked는 틀려서 다시 그릴 때 손님이 고른 그대로) */
export function consentFieldHtml(consent: { shop: string; monthsWord: string }, checked = false): string {
  const e = escapeHtml
  return [
    '<div class="consent">',
    `<label for="f-keep" class="consent-label"><input id="f-keep" type="checkbox" name="keep" value="on"${checked ? ' checked' : ''} aria-describedby="keep-help"> ${e(CR_CONSENT_1.title)}</label>`,
    `<p class="muted" id="keep-help">${e(CR_CONSENT_1.body(consent.shop, consent.monthsWord))}</p>`,
    '</div>',
  ].join('\n')
}

/** 장부 칸 (줄이 없고 알릴 문장도 없으면 빈 글) */
export function ledgerSectionHtml(view: LinkLedgerView['line'], base: string, options: { confirmDelete: boolean; notice: LedgerLinkNotice | null; kstTime: (ms: number) => string }): string {
  const e = escapeHtml
  const notice = options.notice === null ? '' : `<p class="alert" role="status">${e(LEDGER_LINK_NOTICES[options.notice])}</p>`
  if (view === null) return notice === '' ? '' : ['<section class="card" id="ledger">', `<h2>${LEDGER_LINK_TEXT.heading}</h2>`, notice, '</section>'].join('\n')
  const parts = ['<section class="card" id="ledger">', `<h2>${LEDGER_LINK_TEXT.heading}</h2>`, notice, `<p>${e(LEDGER_LINK_TEXT.saved(view.name, view.last4))}</p>`]
  if (options.confirmDelete) {
    parts.push(
      `<p>${e(LEDGER_LINK_TEXT.confirmDelete)}</p>`,
      `<form method="post" action="${base}/ledger/delete">`,
      `<button class="button primary" type="submit">${LEDGER_LINK_TEXT.deleteButton}</button>`,
      '</form>',
      `<div class="actions"><a class="button" href="${base}#ledger">${LEDGER_LINK_TEXT.keep}</a></div>`,
    )
  } else if (view.claim !== null) {
    parts.push(
      `<p>${e(LEDGER_LINK_TEXT.claim(view.claim.platform, view.claim.name, view.claim.last4))}</p>`,
      `<form method="post" action="${base}/ledger/link">`,
      `<button class="button primary" type="submit" name="answer" value="yes">${LEDGER_LINK_TEXT.yes}</button>`,
      `<button class="button" type="submit" name="answer" value="no">${LEDGER_LINK_TEXT.no}</button>`,
      '</form>',
    )
  } else if (view.code !== null) {
    parts.push(
      `<p>${e(LEDGER_LINK_TEXT.codeIntro)}</p>`,
      `<p class="account">${e(view.code.code)}</p>`,
      `<p class="muted">${e(LEDGER_LINK_TEXT.codeUntil(options.kstTime(view.code.expiresAt)))}</p>`,
    )
  }
  if (!options.confirmDelete) {
    parts.push(
      '<div class="actions">',
      `<a class="button" href="${base}?ledger=delete#ledger">${LEDGER_LINK_TEXT.delete}</a>`,
      '</div>',
      `<form method="post" action="${base}/ledger/code">`,
      `<button class="button" type="submit">${LEDGER_LINK_TEXT.linkButton}</button>`,
      '</form>',
    )
  }
  parts.push('</section>')
  return parts.filter((line) => line !== '').join('\n')
}
