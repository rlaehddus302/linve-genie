// 상품 목록 가져오기 창 (AC-I2-52·51, R-18, D-I2-09) — test-e2e. 기대 문장은 acceptance.md 따옴표 그대로.
import { test, expect, type Page } from '@playwright/test'
import { board, boardItem, history, login, makeXlsx, noHorizontalScroll, openNewBroadcast, phoneLike, postJson, registerApi, uniqueDate } from './support.ts'

/** 글 → EUC-KR 바이트 (브라우저 없이: TextDecoder('euc-kr')로 2바이트 표를 거꾸로 만든다) */
function eucKr(text: string): Buffer {
  const dec = new TextDecoder('euc-kr')
  const table = new Map<string, number[]>()
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x41; lo <= 0xfe; lo++) {
      const ch = dec.decode(new Uint8Array([hi, lo]))
      if (ch.length === 1 && ch !== '�' && !table.has(ch)) table.set(ch, [hi, lo])
    }
  }
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x80) out.push(code)
    else {
      const pair = table.get(ch)
      if (pair === undefined) throw new Error(`EUC-KR에 없는 글자 ${ch}`)
      out.push(...pair)
    }
  }
  return Buffer.from(out)
}

async function openImport(page: Page) {
  await page.getByRole('button', { name: '상품 목록 가져오기' }).click()
  const dlg = page.getByRole('dialog', { name: '상품 목록 가져오기' })
  await expect(dlg.getByText('엑셀에서 번호·품종·가격 세 칸을 복사해 붙여 넣거나 파일을 골라 주세요.')).toBeVisible()
  await expect(dlg.getByRole('textbox', { name: '붙여 넣기' })).toBeFocused()
  return dlg
}

test.describe('상품 목록 가져오기 (AC-I2-52)', () => {
  test('엑셀 복사(머리글·금액 쉼표·문제 줄) → 미리 보기 표·문제 말 → n개 등록하기 → 보드에 공개 전, 닫으면 빠른 입력칸', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false, title: '1부' })
    await registerApi(page, b, 3, '기존', 1000)
    const dlg = await openImport(page)
    const text = ['번호\t품종\t가격', '1\t핑크프릴\t"10,000"', '2\t\t8000', '3\t이미있음\t5000', '4\t라울\t50원', '5\t010-1234-5678\t3000', '6\t블루\t', '1\t중복\t2000', '7\t칸둘'].join('\n')
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill(text)
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const pv = dlg.getByRole('region', { name: '미리 보기' })
    await expect(pv.getByText('머리글로 보고 뺀 줄: 1번 줄 (번호, 품종, 가격)')).toBeVisible()
    const table = pv.getByRole('table', { name: '가져올 상품' })
    // 문제 줄은 원래 줄 글 그대로 + 쉬운 말 (같은 번호 1은 두 줄 모두)
    await expect(table.getByRole('row').filter({ hasText: '핑크프릴' })).toContainText('목록에 같은 번호가 또 있어요.')
    await expect(table.getByRole('row').filter({ hasText: '8,000원' })).toContainText('품종 미입력')
    await expect(table).toContainText('이 방송에 이미 있는 번호예요.')
    await expect(table).toContainText('가격이 100원보다 적어요.')
    await expect(table).toContainText('품종에 전화번호처럼 보이는 숫자가 있어요.')
    await expect(table).toContainText('가격이 비었어요.')
    await expect(table).toContainText('번호, 품종, 가격 세 칸이 필요해요.')
    await expect(table).toContainText('목록에 같은 번호가 또 있어요.')
    // R-18: 같은 번호는 두 줄 모두 문제 — 등록할 것은 2번 하나
    await expect(pv.getByText('등록할 상품 1개 · 빼는 줄 7개')).toBeVisible()
    await expect(table.locator('tr[data-tone=warning]')).toHaveCount(7)
    await dlg.getByRole('button', { name: '1개 등록하기' }).click()
    await expect(dlg.getByText('1개를 공개 전 상품으로 등록했어요.')).toBeVisible()
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(boardItem(page, 2)).toContainText('공개 전')
    const reg = (await history(page, date, false)).filter((e) => e.type === 'product.register' && e.fields['no'] === 2)
    expect(reg).toHaveLength(1)
    expect(reg[0]!.fields['status']).toBe('READY')
  })

  test('.xlsx 파일(수 칸·머리글) → 미리 보기 → 등록', async ({ page }) => {
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '1부' })
    const dlg = await openImport(page)
    const xlsx = await makeXlsx([['번호', '품종', '가격'], [11, '핑크프릴', 10000], [12, '라울', 8500]])
    await dlg.getByLabel('파일 고르기').setInputFiles({ name: '목록.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx })
    await expect(dlg.getByText('고른 파일: 목록.xlsx')).toBeVisible()
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const table = dlg.getByRole('table', { name: '가져올 상품' })
    await expect(table.getByRole('row').filter({ hasText: '핑크프릴' })).toContainText('10,000원')
    await expect(table.getByRole('row').filter({ hasText: '라울' })).toContainText('8,500원')
    await dlg.getByRole('button', { name: '2개 등록하기' }).click()
    await expect(dlg.getByText('2개를 공개 전 상품으로 등록했어요.')).toBeVisible()
    await expect(board(page)).toContainText('핑크프릴')
    void b
  })

  test('한국어 윈도우 엑셀의 EUC-KR CSV → "핑크프릴"이 그대로', async ({ page }) => {
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '1부' })
    const dlg = await openImport(page)
    await dlg.getByLabel('파일 고르기').setInputFiles({ name: '목록.csv', mimeType: 'text/csv', buffer: eucKr('번호,품종,가격\r\n21,핑크프릴,10000\r\n22,라울,"8,000"\r\n') })
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const table = dlg.getByRole('table', { name: '가져올 상품' })
    await expect(table.getByRole('row').filter({ hasText: '21번' })).toContainText('핑크프릴')
    await expect(table.getByRole('row').filter({ hasText: '22번' })).toContainText('라울')
    await expect(dlg.getByRole('button', { name: '2개 등록하기' })).toBeEnabled()
  })

  test('미리 보기 뒤 다른 기기가 같은 번호를 등록하면 거절 → 새 미리 보기 + "그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.", 아무것도 기록하지 않음', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false, title: '1부' })
    const dlg = await openImport(page)
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill('1\t핑크프릴\t10000\n2\t라울\t8000')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('button', { name: '2개 등록하기' })).toBeEnabled()
    await registerApi(page, b, 2, '다른기기', 9000)
    await dlg.getByRole('button', { name: '2개 등록하기' }).click()
    await expect(dlg.getByText('그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.')).toBeVisible()
    await expect(dlg.getByRole('table', { name: '가져올 상품' })).toContainText('이 방송에 이미 있는 번호예요.')
    await expect(dlg.getByRole('button', { name: '1개 등록하기' })).toBeEnabled()
    expect((await history(page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(1)
  })

  test('목록 문제: 빈 글 → "가져올 상품이 없어요.", 501줄 → "한 번에 500개까지 가져올 수 있어요.", 휴대폰 폭에서 가로 스크롤 없음', async ({ page, browser }) => {
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '1부' })
    const phone = await phoneLike(browser, page)
    await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
    const dlg = await openImport(phone)
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill('번호\t품종\t가격\n\n')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByText('가져올 상품이 없어요.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '0개 등록하기' })).toBeDisabled()
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill(Array.from({ length: 501 }, (_, i) => `${String(i + 1)}\t품종${String(i + 1)}\t1000`).join('\n'))
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByText('한 번에 500개까지 가져올 수 있어요.')).toBeVisible()
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill('1\t아주아주긴품종이름입니다아주아주긴품종이름입니다아주아주긴품종이름\t10000\n2\t010-1234-5678 전화번호처럼\t100')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('table', { name: '가져올 상품' })).toBeVisible()
    await noHorizontalScroll(phone)
    await phone.context().close()
  })

  test('끝난 방송의 콘솔에는 "상품 목록 가져오기"가 없다', async ({ page }) => {
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '1부' })
    await expect(page.getByRole('button', { name: '상품 목록 가져오기' })).toBeVisible()
    const res = await postJson(page, `/api/broadcasts/${encodeURIComponent(b)}/end`, { requestId: crypto.randomUUID() })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    await page.reload()
    await expect(page.getByText('끝난 방송이에요')).toBeVisible()
    await expect(page.getByRole('button', { name: '상품 목록 가져오기' })).toHaveCount(0)
  })

  test('2MB 넘는 파일은 올리기 전에 "파일이 너무 커요(2MB까지).", 다른 형식은 서버 문장 "엑셀(.xlsx)이나 CSV 파일을 골라 주세요.", 깨진 xlsx는 "파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요."', async ({ page }) => {
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '1부' })
    const dlg = await openImport(page)
    let previews = 0
    page.on('request', (r) => {
      if (r.url().includes('/import/preview')) previews++
    })
    await dlg.getByLabel('파일 고르기').setInputFiles({ name: '큰목록.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0x41) })
    await expect(dlg.getByText('파일이 너무 커요(2MB까지).')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '미리 보기' })).toBeDisabled()
    expect(previews).toBe(0)
    await dlg.getByLabel('파일 고르기').setInputFiles({ name: '목록.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByText('엑셀(.xlsx)이나 CSV 파일을 골라 주세요.')).toBeVisible()
    await dlg.getByLabel('파일 고르기').setInputFiles({ name: '목록.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK\u0003\u0004broken') })
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByText('파일을 읽지 못했어요. 엑셀에서 다시 저장해 주세요.')).toBeVisible()
    await expect(dlg.getByText(/FILE_|UNREADABLE|PAYLOAD/)).toHaveCount(0)
  })
})
