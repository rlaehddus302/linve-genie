// 휴대폰 주소록에서 고른 사람 → 손님 정보 칸 (D-CONTACT-02, 사용자 지시 2026-11-20 "이미 알고 있는 사람 주소록에서 찾기 버튼 눌러서 편하게 정보 넣기",
// "이미 주소록에 있는 사람도 인식했으면"). 순수 계산만 — 주소록은 휴대폰 안에서만 읽고 서버로 보내지 않는다.

/** 주소록 사람 하나에서 쓰는 것 (expo-contacts 연락처의 일부) */
export interface DeviceContact {
  readonly name?: string | undefined
  readonly firstName?: string | undefined
  readonly lastName?: string | undefined
  readonly phoneNumbers?: readonly { readonly number?: string | undefined; readonly digits?: string | undefined }[] | undefined
  readonly addresses?: readonly { readonly street?: string | undefined; readonly city?: string | undefined; readonly region?: string | undefined; readonly postalCode?: string | undefined }[] | undefined
}

/** 손님 정보에 넣을 값 (모르는 칸은 빈 글) */
export interface PickedPerson {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly zip: string
}

/** 번호 글 → 휴대폰 번호 숫자(01로 시작하는 10~11자리). +82·82 국가 번호는 0으로. 휴대폰 번호가 아니면 null */
export function mobileDigits(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('82') && raw.trim().startsWith('+')) digits = `0${digits.slice(2)}`
  else if (digits.startsWith('8210') && digits.length === 12) digits = `0${digits.slice(2)}`
  return /^01\d{8,9}$/.test(digits) ? digits : null
}

/** 사람의 휴대폰 번호 (여럿이면 처음 것 — 판매자가 확인 화면에서 고칠 수 있다). 없으면 빈 글 */
export function pickMobile(contact: DeviceContact): string {
  for (const entry of contact.phoneNumbers ?? []) {
    const found = mobileDigits(entry.number ?? entry.digits ?? '')
    if (found !== null) return found
  }
  return ''
}

/** 사람 이름: 주소록에 보이는 이름, 없으면 성 + 이름(한국식 — 띄우지 않는다) */
export function contactName(contact: DeviceContact): string {
  const shown = (contact.name ?? '').trim()
  if (shown !== '') return shown
  return `${(contact.lastName ?? '').trim()}${(contact.firstName ?? '').trim()}`.trim()
}

/** 첫 주소 → 한 줄 (시·도 → 시·군·구 → 길 순, 겹치는 말은 한 번만) + 우편번호 */
export function contactAddress(contact: DeviceContact): { readonly address: string; readonly zip: string } {
  const first = contact.addresses?.[0]
  if (first === undefined) return { address: '', zip: '' }
  const tidy = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
  const street = tidy(first.street)
  // 길 칸에 이미 들어 있는 시·도·시·군·구는 다시 붙이지 않는다 (주소 전체를 길 칸 하나에 적은 사람이 많다)
  const parts = [tidy(first.region), tidy(first.city)].filter((part, index, all) => part !== '' && all.indexOf(part) === index && !street.includes(part))
  return { address: [...parts, street].filter((part) => part !== '').join(' '), zip: (first.postalCode ?? '').replace(/\D/g, '').slice(0, 5) }
}

/** 고른 사람 → 손님 정보 값 */
export function personOf(contact: DeviceContact): PickedPerson {
  const { address, zip } = contactAddress(contact)
  return { name: contactName(contact).slice(0, 20), phone: pickMobile(contact), address: address.slice(0, 100), zip }
}

/** 주소록 전체 → 휴대폰 번호마다 이름 (한 번호에 이름이 둘 이상이면 누구인지 몰라 넣지 않는다) */
export function nameIndex(contacts: readonly DeviceContact[]): Map<string, string> {
  const out = new Map<string, string>()
  const mixed = new Set<string>()
  for (const contact of contacts) {
    const name = contactName(contact)
    if (name === '') continue
    for (const entry of contact.phoneNumbers ?? []) {
      const digits = mobileDigits(entry.number ?? entry.digits ?? '')
      if (digits === null || mixed.has(digits)) continue
      const before = out.get(digits)
      if (before === undefined) out.set(digits, name)
      else if (before !== name) {
        out.delete(digits)
        mixed.add(digits)
      }
    }
  }
  return out
}

/** 빈 칸만 채운다 (판매자가 적은 값은 덮지 않는다). 주소를 채우면 상세 주소·우편번호도 그 주소의 것으로 */
export function fillEmpty<T extends { readonly name: string; readonly phone: string; readonly address: string; readonly detail: string }>(
  now: T,
  found: { readonly name?: string; readonly phone?: string; readonly address?: string; readonly detail?: string },
): { readonly next: T; readonly filled: readonly ('name' | 'phone' | 'address')[] } {
  const filled: ('name' | 'phone' | 'address')[] = []
  let next = now
  if (now.name.trim() === '' && (found.name ?? '').trim() !== '') {
    next = { ...next, name: (found.name as string).trim() }
    filled.push('name')
  }
  if (now.phone === '' && (found.phone ?? '') !== '') {
    next = { ...next, phone: found.phone as string }
    filled.push('phone')
  }
  if (now.address.trim() === '' && (found.address ?? '').trim() !== '') {
    next = { ...next, address: (found.address as string).trim(), detail: now.detail.trim() === '' ? (found.detail ?? '').trim() : now.detail }
    filled.push('address')
  }
  return { next, filled }
}
