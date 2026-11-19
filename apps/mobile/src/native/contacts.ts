// 휴대폰 주소록 (D-CONTACT-02): [주소록에서 찾기]로 사람 하나 고르기, 아는 번호의 주소록 이름 알아보기.
// 주소록은 휴대폰 안에서만 읽는다 — 서버로 주소록을 올리지 않는다(고른 사람의 값만 판매자가 저장할 때 배송지로 간다).
// - 고르기: 아이폰은 시스템 사람 고르기 창(허용 없이도 열린다 — 이름 알아보기를 위해 처음 한 번 허용을 묻는다), 안드로이드는 주소록 허용 뒤 시스템 고르기 창.
// - 이름 알아보기: 이미 허용했을 때만 (묻지 않는다). 주소록 전체를 한 번 읽어 번호 → 이름 표를 휴대폰 메모리에만 5분 둔다.
// - 네이티브 모듈은 부를 때 불러온다(시험·웹 번들이 expo 모듈을 끌어오지 않게). 모듈이 없는 옛 앱은 단추를 숨긴다.
import { Platform } from 'react-native'
import type * as ContactsLegacy from 'expo-contacts/legacy'
import { nameIndex, personOf, type DeviceContact, type PickedPerson } from '../lib/contact-pick.ts'

export type PickResult = { readonly kind: 'picked'; readonly person: PickedPerson } | { readonly kind: 'cancelled' } | { readonly kind: 'denied' } | { readonly kind: 'failed' }

export interface NativeContacts {
  /** 이 앱에 주소록 모듈이 있나 (옛 앱·웹은 false) */
  available(): Promise<boolean>
  /** 시스템 주소록에서 사람 하나 고르기 */
  pick(): Promise<PickResult>
  /** 그 휴대폰 번호(숫자)의 주소록 이름 — 허용하지 않았거나 없거나 이름이 여럿이면 null */
  nameOf(digits: string): Promise<string | null>
}

const INDEX_TTL_MS = 5 * 60 * 1000
let index: { readonly at: number; readonly names: Map<string, string> } | null = null

type Legacy = typeof ContactsLegacy

async function load(): Promise<Legacy | null> {
  if (Platform.OS === 'web') return null
  try {
    const { requireOptionalNativeModule } = await import('expo')
    if (requireOptionalNativeModule('ExpoContacts') === null) return null
    return await import('expo-contacts/legacy')
  } catch {
    return null
  }
}

export const deviceContacts: NativeContacts = {
  async available() {
    return (await load()) !== null
  },
  async pick() {
    const C = await load()
    if (C === null) return { kind: 'failed' }
    try {
      const permission = await C.getPermissionsAsync()
      if (permission.status !== 'granted') {
        const asked = permission.canAskAgain ? await C.requestPermissionsAsync() : permission
        // 안드로이드는 허용해야 고른 사람의 번호를 읽는다. 아이폰 고르기 창은 허용 없이도 된다
        if (asked.status !== 'granted' && Platform.OS === 'android') return { kind: 'denied' }
      }
      index = null
      const contact = await C.presentContactPickerAsync()
      return contact === null ? { kind: 'cancelled' } : { kind: 'picked', person: personOf(contact as DeviceContact) }
    } catch {
      return { kind: 'failed' }
    }
  },
  async nameOf(digits) {
    const C = await load()
    if (C === null) return null
    try {
      if ((await C.getPermissionsAsync()).status !== 'granted') return null
      if (index === null || Date.now() - index.at > INDEX_TTL_MS) {
        const { data } = await C.getContactsAsync({ fields: [C.Fields.PhoneNumbers, C.Fields.Name, C.Fields.FirstName, C.Fields.LastName] })
        index = { at: Date.now(), names: nameIndex(data as DeviceContact[]) }
      }
      return index.names.get(digits) ?? null
    } catch {
      return null
    }
  },
}
