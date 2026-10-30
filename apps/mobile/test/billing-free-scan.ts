// 앱 정적 검사 도구 (PAY2 AC-PAY2-01, BILLING_RULES BL-11 1·AC1, BL-INV-9): 앱 소스의 문자열·JSX 글(주석 제외)에서 요금 낱말을 찾는다.
// 타입스크립트 구문 트리로 읽어 주석은 보지 않는다 — 주석에 "요금"이라고 써도 앱 화면에 나오지 않는다.
import ts from 'typescript'

/** 앱 소스의 문자열·JSX 글에 있으면 안 되는 글자 (BL-11 1) */
export const FORBIDDEN_TEXT: readonly string[] = ['/billing', '/pricing', '/api/billing', '요금', '결제', '구매하기', '이용권을 사', '부가세', '구독', '업그레이드']

/** 앱 의존성 이름에 있으면 안 되는 조각 (결제 SDK·앱 안 결제 모듈) */
export const FORBIDDEN_DEPENDENCY: readonly string[] = ['portone', 'toss', 'iap', 'purchase', 'billing', 'revenuecat']

/** 앱 설정·번들에 있으면 안 되는 결제 권한·모듈 글자 */
export const FORBIDDEN_NATIVE: readonly RegExp[] = [/com\.android\.vending\.BILLING/, /in-app-payments/i, /InAppPurchase/i, /StoreKit/i]
export const FORBIDDEN_BUNDLE: readonly RegExp[] = [/\/billing/, /\/pricing/, /\/api\/billing/, /portone/i, /iamport/i, /tosspayments/i, /react-native-iap/i, /revenuecat/i]

export interface Finding {
  readonly line: number
  readonly word: string
  readonly text: string
}

/** 소스 한 파일의 문자열·템플릿 글·JSX 글에서 금지 글자를 찾는다 (주석은 구문 트리에 글로 없으므로 보지 않는다) */
export function scanSource(fileName: string, source: string): Finding[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const found: Finding[] = []
  const check = (node: ts.Node, text: string) => {
    for (const word of FORBIDDEN_TEXT) {
      if (text.includes(word)) found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, word, text })
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      // import 경로(모듈 이름)는 화면 글이 아니다
      if (!(ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))) check(node, node.text)
    } else if (ts.isJsxText(node)) {
      check(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** 의존성 이름 중 금지 조각이 든 것 */
export function forbiddenDependencies(names: readonly string[]): string[] {
  return names.filter((name) => FORBIDDEN_DEPENDENCY.some((part) => name.toLowerCase().includes(part)))
}
