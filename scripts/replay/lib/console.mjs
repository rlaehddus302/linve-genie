// 화면 조작: 로그인 → 방송 콘솔 → 음성 켜기 (e2e 도우미와 같은 이름의 단추·칸)

export async function uiLogin(page, origin, password) {
  await page.goto(`${origin}/login`)
  const id = page.getByLabel('아이디')
  await id.waitFor({ timeout: 30_000 })
  await id.fill('practice')
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.getByRole('navigation', { name: '메뉴' }).waitFor({ timeout: 30_000 })
}

export async function openConsole(page, origin, b) {
  await page.goto(`${origin}/broadcasts/${encodeURIComponent(b)}`)
  await page.getByLabel('빠른 입력').waitFor({ timeout: 30_000 })
}

/** 음성이 꺼져 있나 (머리 줄에 "음성 켜기" 단추가 보이면 꺼짐) */
export async function voiceIsOff(page) {
  return (await page.getByRole('button', { name: '음성 켜기', exact: true }).count()) > 0
}

export async function turnOnVoice(page, timeout = 30_000) {
  await page.getByRole('button', { name: '음성 켜기', exact: true }).first().click({ timeout })
  // 안내 창이 나오면(미리 확인이 안 됐을 때) 창의 "음성 켜기"
  const dialog = page.getByRole('dialog', { name: '음성으로 상품 등록' })
  try {
    await dialog.waitFor({ timeout: 1500 })
    await dialog.getByRole('button', { name: '음성 켜기', exact: true }).click()
  } catch {
    // 창 없음
  }
  await page.getByRole('region', { name: '음성 등록' }).getByRole('button', { name: '음성 끄기' }).waitFor({ timeout })
}

/** 음성 칸 상태 글 (로그용) */
export async function voiceStatus(page) {
  try {
    const texts = await page.getByRole('region', { name: '음성 등록' }).getByRole('status').allInnerTexts()
    return texts.join(' | ').replace(/\s+/g, ' ').slice(0, 120)
  } catch {
    return ''
  }
}
