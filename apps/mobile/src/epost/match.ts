// 우체국 화면 글에서 송장번호 찾기 (D-UX3-37): 접수 완료·이용내역 화면의 줄 글에서 우체국 등기번호(숫자 13자리)와 받는 분 이름을 짝짓는다.
// 우체국 화면 모양을 모르므로 너그럽게 읽되, 확실한 짝만 낸다 — 한 줄에 이름이 하나로 정해질 때만, 같은 이름이 둘이면 전화번호 뒤 4자리로 가린다.
// 짝은 판매자가 확인한 뒤에야 서버에 적는다.

export interface InvoiceReceiver {
  readonly buyer: string
  readonly name: string
  /** 숫자만 */
  readonly phone: string
}

export interface InvoiceMatch {
  readonly buyer: string
  readonly name: string
  /** 숫자 13자리 */
  readonly invoice: string
}

/**
 * 글 속 우체국 등기번호 후보 (숫자 13자리). 숫자 덩어리(`-`로 이은 것은 한 덩어리)가 13자리면 후보,
 * 아니면 공백 하나로 떨어진 3~6자리 덩어리 2~4개를 이어 13자리가 되는 것(예: "60701 2345 6790"). 앞뒤 숫자와 붙은 것은 아니다
 */
export function invoiceCandidates(text: string): string[] {
  const tokens = [...text.matchAll(/[0-9]+(?:-[0-9]+)*/g)].map((found) => ({ digits: found[0].replace(/-/g, ''), start: found.index, end: found.index + found[0].length }))
  const out: string[] = []
  const add = (digits: string) => {
    if (!out.includes(digits)) out.push(digits)
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as { digits: string; start: number; end: number }
    if (token.digits.length === 13) {
      add(token.digits)
      continue
    }
    let joined = token.digits
    let last = token
    for (let j = i + 1; j < tokens.length && j < i + 4; j++) {
      const next = tokens[j] as { digits: string; start: number; end: number }
      const short = (part: string) => part.length >= 3 && part.length <= 6
      if (next.start !== last.end + 1 || text[last.end] !== ' ' || !short(token.digits) || !short(next.digits)) break
      joined += next.digits
      last = next
      if (joined.length === 13) {
        add(joined)
        i = j
        break
      }
      if (joined.length > 13) break
    }
  }
  return out
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 이름이 글에 있는지 (우체국이 가운데를 `*`·`○`로 가린 이름도 — 첫 글자는 그대로여야 한다) */
export function hasName(text: string, name: string): boolean {
  const chars = [...name.trim()]
  if (chars.length === 0) return false
  if (text.includes(name.trim())) return true
  if (chars.length < 2) return false
  const pattern = chars.map((char, index) => (index === 0 ? escape(char) : `(?:${escape(char)}|[*＊○●xX])`)).join('')
  return new RegExp(pattern).test(text)
}

/** 화면 줄 글들 → 확실한 짝 (묶음 하나·송장번호 하나는 한 번만), 짝을 못 지은 송장번호 */
export function matchInvoices(rows: readonly string[], receivers: readonly InvoiceReceiver[]): { readonly matches: InvoiceMatch[]; readonly unmatched: string[] } {
  const matches: InvoiceMatch[] = []
  const usedBuyers = new Set<string>()
  const usedInvoices = new Set<string>()
  const seen: string[] = []
  for (const raw of rows) {
    const row = raw.replace(/\s+/g, ' ')
    const invoices = invoiceCandidates(row)
    for (const invoice of invoices) if (!seen.includes(invoice)) seen.push(invoice)
    // 한 줄에 송장번호가 여럿이면 어느 이름의 것인지 모른다
    if (invoices.length !== 1) continue
    const invoice = invoices[0] as string
    if (usedInvoices.has(invoice)) continue
    let named = receivers.filter((receiver) => !usedBuyers.has(receiver.buyer) && hasName(row, receiver.name))
    if (named.length > 1) {
      const digits = row.replace(/[^0-9]/g, '')
      named = named.filter((receiver) => receiver.phone.length >= 4 && digits.includes(receiver.phone.slice(-4)))
    }
    if (named.length !== 1) continue
    const receiver = named[0] as InvoiceReceiver
    matches.push({ buyer: receiver.buyer, name: receiver.name, invoice })
    usedBuyers.add(receiver.buyer)
    usedInvoices.add(invoice)
  }
  return { matches, unmatched: seen.filter((invoice) => !usedInvoices.has(invoice)) }
}
