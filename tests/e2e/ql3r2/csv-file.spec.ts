// QL3R2 .csv가 아닌 파일 (AC-QL3R2-01, D-QL3R2-01, TE-QL3R1-001) — test-e2e.
// 사진 바이트·NUL이 든 ".csv" 이름 파일을 고르면 읽기 실패 문장만, 글 칸은 고르기 전 그대로, 미리 보기 요청 없음.
import { expect, test, type Page } from '@playwright/test'
import { D1440, D375, sellerOn, type Device } from './support.ts'
import { depositTab } from '../n3/support.ts'

const FILE_BUTTON = '은행 파일 고르기(.csv)'
const FILE_ERROR = '파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요.'
const NO_HEADER = '표의 첫 줄'

/** PNG 머리 바이트 + 그림 자료 (ql3r1/words.spec.ts TE-QL3R1-001과 같은 바이트) */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f00000000049454e44ae426082', 'hex')
/** 은행 머리 줄처럼 보이는 UTF-8 글 사이에 NUL 한 바이트 */
const NUL_CSV = Buffer.concat([Buffer.from('거래일시,입금자명,입금액\n2026-10-26 14:20,물주기'), Buffer.from([0x00]), Buffer.from('담당,24000\n')])

/** 미리 보기·넣기 요청을 센다 */
function pasteRequests(page: Page): string[] {
  const out: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/deposits/paste')) out.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  return out
}

const cases: readonly (readonly [Device, boolean])[] = [
  [D1440, false],
  [D375, true],
]

test.describe('AC-QL3R2-01 .csv가 아닌 파일은 읽기 실패 문장만', () => {
  for (const [device, big] of cases) {
    for (const [what, file] of [
      ['사진.png (PNG 바이트)', { name: '사진.png', mimeType: 'image/png', buffer: PNG }],
      ['NUL이 든 거래내역.csv', { name: '거래내역.csv', mimeType: 'text/csv', buffer: NUL_CSV }],
    ] as const) {
      test(`${device.label} 글자 ${big ? '150%' : '100%'}: ${what} — 글 칸 빈 상태·"가나다" 상태 모두 "${FILE_ERROR}", 글 칸 그대로, 미리 보기 요청 0, 깨진 글자 없음`, async ({ page, browser }) => {
        const s = await sellerOn(browser, page, device, big)
        try {
          const requests = pasteRequests(s.dev)
          await s.dev.goto('/deposits?tab=paste')
          await expect(depositTab(s.dev, /^붙여넣기$/)).toHaveAttribute('aria-selected', 'true')
          const field = s.dev.getByLabel('입금 내역')
          const insert = s.dev.getByRole('button', { name: '입금 내역 넣기' })
          // 빈 글 칸
          await s.dev.getByLabel(FILE_BUTTON, { exact: true }).setInputFiles({ ...file })
          await expect(s.dev.getByRole('alert').filter({ hasText: FILE_ERROR })).toBeVisible()
          await expect(field).toHaveValue('')
          await expect(insert).toBeDisabled()
          await expect(s.dev.getByText(NO_HEADER)).toHaveCount(0)
          expect(await s.dev.evaluate(() => document.body.innerText), '화면의 깨진 글자').not.toContain('�')
          // "가나다"가 적힌 글 칸
          await field.fill('가나다')
          await s.dev.getByLabel(FILE_BUTTON, { exact: true }).setInputFiles({ ...file })
          await expect(s.dev.getByRole('alert').filter({ hasText: FILE_ERROR })).toBeVisible()
          await expect(field).toHaveValue('가나다')
          await expect(s.dev.getByText(NO_HEADER)).toHaveCount(0)
          expect(await field.inputValue(), '글 칸의 깨진 글자').not.toContain('�')
          expect(await s.dev.evaluate(() => document.body.innerText), '화면의 깨진 글자').not.toContain('�')
          expect(requests, '미리 보기·넣기 요청').toEqual([])
        } finally {
          await s.close()
        }
      })
    }
  }

  test('1440×900: 같은 사진 파일을 두 번 연달아 골라도 매번 실패 문장, 그 뒤 은행 .csv(UTF-8)를 고르면 글 칸이 채워지고 읽어 본다', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      await s.dev.goto('/deposits?tab=paste')
      const field = s.dev.getByLabel('입금 내역')
      for (let i = 0; i < 2; i += 1) {
        await s.dev.getByLabel(FILE_BUTTON, { exact: true }).setInputFiles({ name: '사진.png', mimeType: 'image/png', buffer: PNG })
        await expect(s.dev.getByRole('alert').filter({ hasText: FILE_ERROR })).toBeVisible()
        await expect(field).toHaveValue('')
      }
      const now = new Date(Date.now() - 60_000 + 9 * 3_600_000).toISOString()
      const csv = `거래일시,입금자명,입금액\n${now.slice(0, 10)} ${now.slice(11, 16)},파일손님,3000\n`
      await s.dev.getByLabel(FILE_BUTTON, { exact: true }).setInputFiles({ name: '거래내역.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await expect(field).toHaveValue(csv)
      await expect(s.dev.getByRole('region', { name: '읽어 본 결과' })).toContainText('새 입금 1건')
    } finally {
      await s.close()
    }
  })
})
