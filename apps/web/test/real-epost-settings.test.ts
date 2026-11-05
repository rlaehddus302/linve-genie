// D-REAL-04 설정 "택배" 우체국 칸: 우체국을 고르고 적었을 때만 인증키·보안키를 보낸다(빈 칸은 보내지 않아 저장한 값을 지우지 않는다), 저장한 값은 오지 않아 초안은 늘 빈 칸.
import { describe, expect, it } from 'vitest'
import type { ParcelSettings } from '../src/api/parcel-types.ts'
import { parcelBody, parcelDraftOf, sameParcelDraft } from '../src/lib/parcel-words.ts'

const settings: ParcelSettings = {
  carrier: 'EPOST',
  carrierName: '우체국택배',
  carriers: [{ code: 'EPOST', name: '우체국택배', autoBook: true }],
  customerNoLast4: '3344',
  epostReady: true,
  sender: { name: '다육이네', phone: '0311234567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' },
  shopName: '다육이네',
  box: '80',
  boxes: ['60', '80', '100', '120', '160'],
}

describe('D-REAL-04 우체국 설정 본문', () => {
  it('저장한 키는 초안에 오지 않고, 적은 칸만 보낸다', () => {
    const draft = parcelDraftOf(settings)
    expect(draft).toMatchObject({ epostKey: '', epostSecret: '' })
    expect(parcelBody(settings, draft)).not.toHaveProperty('epostKey')
    const typed = { ...draft, epostKey: 'key-1', epostSecret: 'secret-1' }
    expect(sameParcelDraft(draft, typed)).toBe(false)
    expect(parcelBody(settings, typed)).toMatchObject({ carrier: 'EPOST', epostKey: 'key-1', epostSecret: 'secret-1' })
    // 다른 택배사로 바꾸면 보내지 않는다
    expect(parcelBody(settings, { ...typed, carrier: 'CJ' })).not.toHaveProperty('epostSecret')
  })
})
