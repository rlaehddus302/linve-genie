// AC-O4-03 번호 방송(STRICT·LOOSE)의 생성기 메시지는 BASE(e44d535)와 글자까지 같다 (YT-09, CMT-07, D-O4-01).
// 기대 해시는 BASE 커밋의 ChatMaker로 만든 결과(종류·채널·닉네임·글·메시지 ID·방송자 표시, 순서대로)의 SHA-256이다 — 고정값이다.
import { createHash } from 'node:crypto'
import { DEFAULT_SETTINGS, type ProductStatus, type SaleSettings } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { ChatMaker, type GeneratorView } from '../src/generator.ts'

type Mode = 'STRICT' | 'LOOSE'

const PRODUCT_SETS: Record<string, readonly { no: number; status: ProductStatus }[]> = {
  empty: [],
  open3: [
    { no: 1, status: 'OPEN' },
    { no: 2, status: 'OPEN' },
    { no: 3, status: 'OPEN' },
  ],
  mixed: [
    { no: 1, status: 'OPEN' },
    { no: 2, status: 'SOLD' },
    { no: 3, status: 'READY' },
    { no: 4, status: 'HOLD' },
    { no: 5, status: 'OPEN' },
    { no: 7, status: 'CLOSED' },
    { no: 12, status: 'SOLD' },
  ],
}

function view(mode: Mode, set: string): GeneratorView {
  const settings: SaleSettings = { ...DEFAULT_SETTINGS, 'claim.parseMode': mode }
  // 번호 방송의 보기: 상품 번호·상태만 의미가 있다 (옵션 방송용 칸은 비어 있다)
  const products = (PRODUCT_SETS[set] ?? []).map((product) => ({ ...product, name: '구피', aliases: [], options: [], variants: [] }))
  return { products, settings, focus: null }
}

function digest(mode: Mode, set: string, seed: number): string {
  const maker = new ChatMaker('b1', seed, 7)
  const v = view(mode, set)
  const hash = createHash('sha256')
  for (let i = 0; i < 1000; i++) {
    const { kind, chat } = maker.next(v)
    hash.update(JSON.stringify([kind, chat.id, chat.ch, chat.nick, chat.text, chat.owner === true]))
    hash.update('\n')
  }
  return hash.digest('hex')
}

/** BASE(e44d535) ChatMaker 결과의 해시 — 바꾸지 않는다 */
const BASE_HASHES: Record<string, string> = {
  'LOOSE/empty/1': '55f8c262ef166a24cfb5b6985b21ec31c9c140bd06523e0381948ad53774fc0a',
  'LOOSE/empty/2147483647': 'eedeeb936b86cb86a09c53ff20e90d4ed2a9cf28b486e6b8d9b420ea25d5ad7b',
  'LOOSE/empty/42': '783466d2646763ba71c3db7a938361b4262cd5441e00764758e4ad84c07908bd',
  'LOOSE/mixed/1': '0ebdc2c025b1fb4d2618b6e82e26c3f861aa3600e6a83d7ee2f97a3ee71f97a0',
  'LOOSE/mixed/2147483647': '9830269e60243d582e63abcd8e386d7483c8b9adff1b8d2b37e503d45241a690',
  'LOOSE/mixed/42': '1536c55ee5fc50db6a13753feaed04374cb38451d8c05541384a7a6d0939f72b',
  'LOOSE/open3/1': 'cc3b3fff37ebaae14421be3b220c58deacde0d9e954e00917ac0021beb13b254',
  'LOOSE/open3/2147483647': '179471f38a03efee440cc07d83356781268c7e94707af7d09970796650597d91',
  'LOOSE/open3/42': '113a560bdad7cf3604c06ea0bbe107e4a519e93f83d13ff21a82269679d91e67',
  'STRICT/empty/1': 'd2d797d64a90a4ddc6cd0b1b39993156aa4cfffb32832dabee9b9d3cf828c462',
  'STRICT/empty/2147483647': 'a5b3bd1aa10a8142b972de99131e91dc19cfad619e4f8078bd90e7cf1b765f3a',
  'STRICT/empty/42': '8e2acdc5c3ab8b6f79baf08eb2fc474a4fff52642256a9642c2d2bf0f8d5b05b',
  'STRICT/mixed/1': '179a78b2708f6841b470babd5d14be9e2f43b4762071df9c6f8149afa2b5b897',
  'STRICT/mixed/2147483647': '840a7239ef496a75767ad030c5a84cdef1e7ceda9c6036d91da69ddffc641c2e',
  'STRICT/mixed/42': 'e62b80f6d83ed640174383de3942a82d84c9a79ccf0dde198af26f431dd540e0',
  'STRICT/open3/1': '31501a0bcdbe0002d23e0a8a9ae5ae6db050848be482dc1160bde96a09891272',
  'STRICT/open3/2147483647': '472e2ac68c4aa159887335933299f4456216e0bbeb2b1dddafe6d29f2de1e0df',
  'STRICT/open3/42': 'e27f490e8a5ae2d36c8db5c0db08e7998cb2737b49c714ad85f991562e4f6a75',
}

describe('AC-O4-03 번호 방송 생성기 메시지 = BASE (시드 1·42·2147483647, 보기 셋, STRICT·LOOSE)', () => {
  for (const mode of ['STRICT', 'LOOSE'] as const) {
    for (const set of Object.keys(PRODUCT_SETS)) {
      for (const seed of [1, 42, 2_147_483_647]) {
        const name = `${mode}/${set}/${String(seed)}`
        it(name, () => {
          expect(digest(mode, set, seed)).toBe(BASE_HASHES[name])
        })
      }
    }
  }
})
