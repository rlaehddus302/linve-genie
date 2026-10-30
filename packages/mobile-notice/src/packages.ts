// 알림을 열어 볼 앱 (안드로이드, SMS3). 목록에 없는 앱의 알림은 내용을 열지 않고 바로 버린다.
// - 문자 앱 두 개는 늘 들어 있다(문자찜).
// - 은행 앱은 판매자가 고른 것만(setAllowedPackages). 개인 대화가 섞이는 메신저는 고를 수 없다.

/** 문자 앱 — 삼성 메시지·구글 메시지 */
export const SMS_PACKAGES = Object.freeze(['com.samsung.android.messaging', 'com.google.android.apps.messaging'] as const)

/**
 * 고를 수 없는 앱 — 개인 대화가 통째로 섞여 서버에 갈 수 있다(입금 알림톡이 와도 받지 않는다).
 * 은행 입금은 은행 앱 알림이나 은행 문자로 받는다.
 */
export const BLOCKED_PACKAGES = Object.freeze([
  'com.kakao.talk',
  'jp.naver.line.android',
  'org.telegram.messenger',
  'com.whatsapp',
  'com.facebook.orca',
  'com.instagram.android',
  'com.discord',
  'com.nhn.android.band',
] as const)

/**
 * 은행 앱 후보 (판매자 고르기 화면의 보기 — 실제 패키지 이름은 실물 확인 필요, HG-SMS).
 * 목록 밖 은행도 패키지 이름을 넣어 고를 수 있다.
 */
export const BANK_APP_CANDIDATES: readonly { readonly name: string; readonly packageName: string }[] = Object.freeze([
  { name: 'KB스타뱅킹', packageName: 'com.kbstar.kbbank' },
  { name: '신한 SOL뱅크', packageName: 'com.shinhan.sbanking' },
  { name: '우리WON뱅킹', packageName: 'com.wooribank.smart.npib' },
  { name: '하나원큐', packageName: 'com.kebhana.hanapush' },
  { name: 'NH스마트뱅킹', packageName: 'nh.smart.banking' },
  { name: 'IBK i-ONE뱅크', packageName: 'com.ibk.android.ionebank' },
  { name: '카카오뱅크', packageName: 'com.kakaobank.channel' },
  { name: '토스', packageName: 'viva.republica.toss' },
  { name: '케이뱅크', packageName: 'com.kbankwith.smartbank' },
].map((bank) => Object.freeze(bank)))

/** 고를 수 있는 은행 앱 수 */
export const BANK_PACKAGES_MAX = 20
/** 안드로이드 패키지 이름 모양 (점으로 나뉜 두 마디 이상, 각 마디는 영문자로 시작) */
export const PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

export type BankPackagesProblem = 'TOO_MANY' | 'INVALID_NAME' | 'BLOCKED' | 'SMS_APP'

export type BankPackagesCheck =
  | { readonly ok: true; readonly packages: readonly string[] }
  | { readonly ok: false; readonly problem: BankPackagesProblem; readonly packageName?: string }

/** 판매자가 고른 은행 앱 목록 검사 — 겹친 것은 하나로, 순서는 고른 순서 그대로 */
export function checkBankPackages(packages: readonly unknown[]): BankPackagesCheck {
  const out: string[] = []
  for (const value of packages) {
    if (typeof value !== 'string') return { ok: false, problem: 'INVALID_NAME' }
    const name = value.trim()
    if (name.length > 150 || !PACKAGE_NAME_PATTERN.test(name)) return { ok: false, problem: 'INVALID_NAME', packageName: name }
    if ((BLOCKED_PACKAGES as readonly string[]).includes(name)) return { ok: false, problem: 'BLOCKED', packageName: name }
    if ((SMS_PACKAGES as readonly string[]).includes(name)) return { ok: false, problem: 'SMS_APP', packageName: name }
    if (!out.includes(name)) out.push(name)
  }
  if (out.length > BANK_PACKAGES_MAX) return { ok: false, problem: 'TOO_MANY' }
  return { ok: true, packages: out }
}
