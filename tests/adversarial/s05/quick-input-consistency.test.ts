// S05 적대 테스트 (test-domain): 빠른 입력의 해석은 코어 parseQuickInput 결과와 같아야 한다 (AC-S05-10 "화면이 따로 해석하지 않는다").
// 번호 찾기 미리 보기(AC-S05-12)와 고치기 칸(AC-S05-11)은 화면이 번호를 따로 읽는다 — 코어가 번호로 읽는 줄을 화면이 못 읽는 길을 찾는다.
// (휴대폰 키보드·일부 입력기에서 나오는 전각 숫자 `１５`는 코어가 15로 읽는다 — S01 파서 골든)
//
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(console-store-race.test.ts와 같은 까닭).
import { parseQuickInput, resolveSettings } from '@livejjim/core'
import { describe, expect, it } from 'vitest'

// SRV1(D-APP-23·24): 번호 찾기 미리 보기·고치기 칸 읽기는 서버 읽기(packages/voice-session/src/read/quick.ts)로 옮겼다 — 화면은 그 결과를 보인다.
const QUICK_MODULE = '../../../packages/voice-session/src/read/quick.ts'

interface QuickModule {
  previewNumber(text: string): number | null
  quickSettings(settings: ReturnType<typeof resolveSettings>): { 'price.unit': string; 'claim.maxNumber': number }
  decideFixForm(input: { no: string; name: string; price: string }, settings: unknown, find: (no: number) => undefined): { kind: string; no?: number | null }
}

const settings = resolveSettings({})

describe('TD-S05-003 화면이 따로 읽는 번호가 코어 해석과 다르다 (AC-S05-10·11·12)', () => {
  it('코어가 번호 15로 읽는 줄(전각 숫자)이면 번호 찾기 미리 보기도 15다', async () => {
    const quick = (await import(/* @vite-ignore */ QUICK_MODULE)) as QuickModule
    for (const line of ['１５ 핑크프릴 10000', '１５', '１５번 핑']) {
      const core = parseQuickInput(line, quick.quickSettings(settings) as never)
      expect(core.no, line).toBe(15)
      expect(quick.previewNumber(line), line).toBe(15)
    }
  })

  it('고치기 칸의 번호도 빠른 입력과 같게 읽는다: 전각 `１５`는 15로 등록한다', async () => {
    const quick = (await import(/* @vite-ignore */ QUICK_MODULE)) as QuickModule
    const decided = quick.decideFixForm({ no: '１５', name: '핑크프릴', price: '1만' }, quick.quickSettings(settings), () => undefined)
    expect(decided).toMatchObject({ kind: 'register', no: 15 })
  })
})
