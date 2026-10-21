// N4b 라운드 2 깨뜨리기 — 구매자 문서의 가게 글 이스케이프·계좌 없음·과입금, 메신저가 붙이는 주소 뒤 꼬리, 1분 60번,
// 판매자 쿠키가 함께 와도 같은 문서, 다른 메서드, 그림·PDF 파일 이름, 다른 기기와 엇갈린 끊기·만들기, 리허설 한 사람 파일 이름,
// 다른 기기 합치기의 실시간 줄 수 (AC-N4b-12·13·20·21·22·24·31·32·33) — test-e2e.
import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  anonymousPhone,
  buyerRow,
  CLIPBOARD_FAKE,
  CLOSED_TEXT,
  clipboard,
  downloadBytes,
  endBroadcast,
  endedDay,
  isBaselineJpeg,
  linkOf,
  login,
  openNewBroadcast,
  pay,
  phoneLike,
  postJson,
  receiptsPath,
  registerApi,
  resetShop,
  scopeView,
  setShop,
  uniq,
  uniqueDate,
  viewerClaim,
  writeEvent,
} from "./support.ts";

/** 모양이 틀린 /r 주소들 (AC-N4b-22·25) */
async function oddPaths(page: Page, browser: Browser): Promise<void> {
  await login(page);

  const day = await endedDay(page);
  const url = await makeLink(page, day.date, day.phoneBuyer);
  const origin = new URL(page.url()).origin;
  const buyer = await anonymousPhone(browser, page);
  try {
    const bodies: string[] = [];
    for (const path of [
      `${origin}/r`,
      `${origin}/r/`,
      `${url}/`,
      `${url}/other.jpg`,
      `${url}/receipt.png`,
    ]) {
      const res = await buyer.request.get(path);
      expect(res.status(), path).toBe(404);
      expect(res.headers()["content-type"], path).toBe(
        "text/html; charset=utf-8",
      );
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain(CLOSED_TEXT);
    expect(bodies[0]).not.toContain("<script");
  } finally {
    await buyer.context().close();
  }
}

const LATER_TEXT = "잠시 뒤 다시 열어 주세요.";

/** (날짜, 구매자) 링크를 API로 만든다 — 화면 주소(<화면 주소>/r/<토큰>) 그대로 */
async function makeLink(
  page: Page,
  date: string,
  buyer: string,
): Promise<string> {
  const made = await postJson(page, `/api/days/${date}/receipt-links`, {
    requestId: crypto.randomUUID(),
    buyer,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  return (made.body["link"] as { url: string }).url;
}

async function linkList(
  page: Page,
  date: string,
): Promise<{ buyer: string; status: string; url: string | null }[]> {
  const res = await page.request.get(`/api/days/${date}/receipt-links`);
  expect(res.status()).toBe(200);
  return (
    (await res.json()) as {
      links: { buyer: string; status: string; url: string | null }[];
    }
  ).links;
}

test.describe("AC-N4b-20 구매자 문서의 가게 글·계좌·입금 상태", () => {
  test.afterEach(async ({ page }) => {
    await resetShop(page);
  });

  test("가게 이름·은행·예금주·안내 문장의 HTML도 글자로 보이고 요소가 생기지 않는다", async ({
    page,
    browser,
  }) => {
    await login(page);
    const evil = {
      name: "<b>굵은가게</b>",
      bank: "<i>은행</i>",
      accountNumber: "123-45-6789",
      accountHolder: '"김&다육"',
      accountNote: "<script>alert(1)</script>안내",
    };
    await setShop(page, evil);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      const dialogs: string[] = [];
      buyer.on("dialog", (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      const res = await buyer.goto(url);
      expect(res?.status()).toBe(200);
      const body = buyer.locator("body");
      await expect(body).toContainText("<b>굵은가게</b>");
      await expect(body).toContainText('<i>은행</i> 123-45-6789 "김&다육"');
      await expect(body).toContainText("<script>alert(1)</script>안내");
      await expect(buyer.locator("main b, main i, script")).toHaveCount(0);
      expect(dialogs).toEqual([]);
    } finally {
      await buyer.context().close();
    }
  });

  test('계좌를 적지 않은 가게: 문서에 "입금 계좌" 칸이 없다 (D-I2-02)', async ({
    page,
    browser,
  }) => {
    await login(page);
    await resetShop(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      expect((await buyer.goto(url))?.status()).toBe(200);
      await expect(
        buyer.getByRole("heading", { level: 1, name: "구매 내역 확인서" }),
      ).toBeVisible();
      await expect(
        buyer.getByRole("heading", { name: "입금 계좌" }),
      ).toHaveCount(0);
    } finally {
      await buyer.context().close();
    }
  });

  test('더 많이 받은 구매자: 줄은 "과입금", 문서는 "과입금"과 환불할 금액', async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    await pay(page, day.date, day.phoneBuyer, 30000);
    await page.goto(receiptsPath(day.b));
    await expect(buyerRow(page, "문자찜")).toContainText("과입금");
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      await buyer.goto(url);
      const body = buyer.locator("body");
      await expect(body).toContainText("과입금");
      await expect(body).toContainText("환불할 금액");
      await expect(body).toContainText("8,000원");
    } finally {
      await buyer.context().close();
    }
  });
});

test.describe("AC-N4b-21·22·24 링크 주소·머리글·남용", () => {
  test("메신저가 주소 뒤에 붙이는 ?fbclid=… 꼬리가 있어도 같은 문서", async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      const res = await buyer.goto(`${url}?fbclid=IwAR0abc_def`);
      expect(res?.status()).toBe(200);
      await expect(
        buyer.getByRole("heading", { level: 1, name: "구매 내역 확인서" }),
      ).toBeVisible();
      await expect
        .poll(
          async () =>
            await buyer
              .getByRole("img", { name: "구매 내역 확인서 그림" })
              .evaluate(
                (el: HTMLImageElement) => el.complete && el.naturalWidth,
              ),
        )
        .toBe(1080);
    } finally {
      await buyer.context().close();
    }
  });

  test("판매자 세션 쿠키가 함께 와도 같은 문서 바이트, 쿠키를 새로 주지 않는다. HEAD는 본문 없이 같은 머리글", async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      const anon = await buyer.request.get(url);
      const mine = await page.request.get(url);
      expect(anon.status()).toBe(200);
      expect(mine.status()).toBe(200);
      expect((await mine.body()).equals(await anon.body())).toBe(true);
      expect(mine.headers()["set-cookie"]).toBeUndefined();
      expect(mine.headers()["cache-control"]).toBe("no-store");
      const head = await buyer.request.head(url);
      expect(head.status()).toBe(200);
      expect(head.headers()["x-robots-tag"]).toBe(
        "noindex, nofollow, noarchive",
      );
      expect(head.headers()["content-type"]).toBe("text/html; charset=utf-8");
      expect((await head.body()).length).toBe(0);
    } finally {
      await buyer.context().close();
    }
  });

  test("GET·HEAD 밖의 메서드는 405이고 링크는 그대로 열린다", async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const origin = new URL(page.url()).origin;
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const res = await page.request.fetch(url, {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        data: "{}",
      });
      expect(res.status(), method).toBe(405);
      expect(res.headers()["cache-control"]).toBe("no-store");
    }
    const buyer = await anonymousPhone(browser, page);
    try {
      expect((await buyer.goto(url))?.status()).toBe(200);
    } finally {
      await buyer.context().close();
    }
  });

  test('링크 하나에 1분 60번(문서·그림 합)을 넘으면 429 "잠시 뒤 다시 열어 주세요."(같은 머리글), 다른 링크는 그대로', async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const other = await makeLink(page, day.date, day.memoBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      for (let i = 0; i < 59; i++)
        expect(
          (await buyer.request.get(url)).status(),
          `문서 ${String(i + 1)}번째`,
        ).toBe(200);
      expect((await buyer.request.get(`${url}/receipt.jpg`)).status()).toBe(
        200,
      );
      const over = await buyer.request.get(url);
      expect(over.status()).toBe(429);
      expect(await over.text()).toContain(LATER_TEXT);
      expect(over.headers()["cache-control"]).toBe("no-store");
      expect(over.headers()["x-robots-tag"]).toBe(
        "noindex, nofollow, noarchive",
      );
      expect((await buyer.request.get(`${url}/receipt.pdf`)).status()).toBe(
        429,
      );
      expect((await buyer.request.get(other)).status()).toBe(200);
    } finally {
      await buyer.context().close();
    }
  });

  test('문서 안 그림은 inline, "그림 저장"·"PDF로 받기"는 확인서-YYYY-MM-DD-<이름> 이름의 내려받기', async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const buyer = await anonymousPhone(browser, page);
    try {
      await buyer.goto(url);
      const inline = await buyer.request.get(`${url}/receipt.jpg`);
      expect(inline.headers()["content-type"]).toBe("image/jpeg");
      expect(inline.headers()["content-disposition"]).toMatch(/^inline/);
      const saveHref = await buyer
        .getByRole("link", { name: "그림 저장" })
        .getAttribute("href");
      const save = await buyer.request.get(new URL(saveHref!, url).toString());
      expect(save.headers()["content-disposition"]).toMatch(/^attachment/);
      expect(
        decodeURIComponent(save.headers()["content-disposition"]!),
      ).toContain(`확인서-${day.date}-`);
      expect(
        decodeURIComponent(save.headers()["content-disposition"]!),
      ).toMatch(/\.jpg"?$/);
      expect(isBaselineJpeg(await save.body())).toBe(true);
      const pdfHref = await buyer
        .getByRole("link", { name: "PDF로 받기" })
        .getAttribute("href");
      const pdf = await buyer.request.get(new URL(pdfHref!, url).toString());
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect(
        decodeURIComponent(pdf.headers()["content-disposition"]!),
      ).toContain(`확인서-${day.date}-`);
      expect(decodeURIComponent(pdf.headers()["content-disposition"]!)).toMatch(
        /\.pdf"?$/,
      );
    } finally {
      await buyer.context().close();
    }
  });

  test('/r·/r/·끝에 / 붙인 주소·모르는 파일 이름은 모두 같은 "열 수 없음" 404 문서 (앱 화면이 아니다)', async ({
    page,
    browser,
  }) => {
    await oddPaths(page, browser);
  });

  test("@served 서버가 화면을 내는 묶음: /r·/r/·끝 /·모르는 파일 이름도 같은 404 문서, 다른 메서드 405", async ({
    page,
    browser,
  }) => {
    await oddPaths(page, browser);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    const res = await page.request.fetch(url, {
      method: "POST",
      headers: {
        Origin: new URL(page.url()).origin,
        "Content-Type": "application/json",
      },
      data: "{}",
    });
    expect(res.status()).toBe(405);
  });

  test('줄의 "링크 있음 · … HH:MM까지"와 구매자 문서의 "… HH:MM까지 열 수 있어요."는 같은 날짜·같은 분', async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const url = await makeLink(page, day.date, day.phoneBuyer);
    await page.goto(receiptsPath(day.b));
    const words = await buyerRow(page, "문자찜")
      .getByText(/^링크 있음 · /)
      .textContent();
    const m =
      /^링크 있음 · (\d{1,2})월 (\d{1,2})일 \(([일월화수목금토])\) (\d{2}:\d{2})까지$/.exec(
        words ?? "",
      );
    expect(m, words ?? "").not.toBeNull();
    const buyer = await anonymousPhone(browser, page);
    try {
      await buyer.goto(url);
      const line = await buyer
        .getByText(/^이 링크는 .+까지 열 수 있어요\.$/)
        .textContent();
      const d =
        /^이 링크는 \d{4}-(\d{2})-(\d{2}) \(([일월화수목금토])\) (\d{2}:\d{2})까지 열 수 있어요\.$/.exec(
          line ?? "",
        );
      expect(d, line ?? "").not.toBeNull();
      expect([Number(d![1]), Number(d![2]), d![3], d![4]]).toEqual([
        Number(m![1]),
        Number(m![2]),
        m![3],
        m![4],
      ]);
    } finally {
      await buyer.context().close();
    }
  });
});

test.describe("AC-N4b-12·13·33 다른 기기와 엇갈린 링크 조치", () => {
  test('두 기기가 동시에 "링크 만들기"·"링크 전부 만들기"를 보내도 쓸 수 있는 링크는 구매자마다 하나', async ({
    page,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const sends = [
      ...Array.from({ length: 4 }, () =>
        postJson(page, `/api/days/${day.date}/receipt-links`, {
          requestId: crypto.randomUUID(),
          buyer: day.phoneBuyer,
        }),
      ),
      ...Array.from({ length: 2 }, () =>
        postJson(page, `/api/days/${day.date}/receipt-links/all`, {
          requestId: crypto.randomUUID(),
        }),
      ),
    ];
    const answers = await Promise.all(sends);
    for (const a of answers) expect(a.status, JSON.stringify(a.body)).toBe(200);
    const urls = new Set<string>();
    for (const a of answers.slice(0, 4))
      urls.add((a.body["link"] as { url: string }).url);
    for (const a of answers.slice(4))
      for (const l of a.body["links"] as { buyer: string; url: string }[])
        if (l.buyer === day.phoneBuyer) urls.add(l.url);
    expect(urls.size).toBe(1);
    const created =
      answers.slice(0, 4).filter((a) => a.body["created"] === true).length +
      answers.slice(4).reduce((n, a) => n + (a.body["created"] as number), 0);
    expect(created).toBe(2);
    const links = await linkList(page, day.date);
    expect(links.map((l) => l.status)).toEqual(["ACTIVE", "ACTIVE"]);
    expect(links.find((l) => l.buyer === day.phoneBuyer)?.url).toBe(
      [...urls][0],
    );
  });

  test('다른 기기가 먼저 끊은 링크를 이 화면에서 끊어도 오류 없이 "링크를 끊었어요."·"링크 끊음"', async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const phone = await phoneLike(browser, page);
    try {
      await makeLink(page, day.date, day.phoneBuyer);
      await phone.goto(receiptsPath(day.b));
      const row = buyerRow(phone, "문자찜");
      await expect(row).toContainText("링크 있음");
      const revoked = await postJson(
        page,
        `/api/days/${day.date}/receipt-links/revoke`,
        { requestId: crypto.randomUUID(), buyer: day.phoneBuyer },
      );
      expect(revoked.status).toBe(200);
      await row.getByRole("button", { name: "링크 끊기" }).click();
      await phone
        .getByRole("dialog", { name: "링크 끊기" })
        .getByRole("button", { name: "1 링크 끊기" })
        .click();
      await expect(row.getByRole("status")).toHaveText("링크를 끊었어요.");
      await expect(row).toContainText("링크 끊음");
      await expect(
        row.getByRole("button", { name: "링크 만들기" }),
      ).toBeVisible();
      await expect(row.getByRole("alert")).toHaveCount(0);
    } finally {
      await phone.context().close();
    }
  });

  test('다른 기기가 새 링크를 만든 뒤 이 화면의 "링크 만들기"는 그 링크(새 링크를 하나 더 만들지 않는다)', async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    const phone = await phoneLike(browser, page);
    try {
      await phone.addInitScript(CLIPBOARD_FAKE);
      await phone.goto(receiptsPath(day.b));
      const row = buyerRow(phone, "문자찜");
      await expect(row).toContainText("링크 없음");
      const theirs = await makeLink(page, day.date, day.phoneBuyer);
      await row.getByRole("button", { name: "링크 만들기" }).click();
      await expect(row.getByRole("status")).toHaveText("링크를 만들었어요.");
      await row.getByRole("button", { name: "링크 복사" }).click();
      await expect.poll(async () => (await clipboard(phone)).length).toBe(1);
      expect(linkOf((await clipboard(phone))[0]!)).toBe(theirs);
      const links = await linkList(page, day.date);
      expect(links.find((l) => l.buyer === day.phoneBuyer)).toMatchObject({
        status: "ACTIVE",
        url: theirs,
      });
    } finally {
      await phone.context().close();
    }
  });

  test("다른 기기가 합치면 줄이 실시간으로 하나가 되고, 떼어 내면 다시 둘(링크 상태 그대로)", async ({
    page,
    browser,
  }) => {
    await login(page);
    const day = await endedDay(page);
    await makeLink(page, day.date, day.memoBuyer);
    const phone = await phoneLike(browser, page);
    try {
      await phone.goto(receiptsPath(day.b));
      const rows = phone
        .getByRole("list", { name: "구매자" })
        .getByRole("group");
      await expect(rows).toHaveCount(2);
      await expect(buyerRow(phone, "문자찜(가람이)")).toContainText(
        "링크 있음",
      );
      expect(
        (
          await writeEvent(
            page,
            {
              type: "buyer.merge",
              from: day.memoBuyer,
              into: day.phoneBuyer,
              reason: "같은 사람",
            },
            { date: day.date, rehearsal: false },
          )
        ).status,
      ).toBeLessThan(300);
      await expect(rows).toHaveCount(1, { timeout: 3000 });
      await expect(buyerRow(phone, "문자찜")).toContainText("상품 3개");
      await expect(buyerRow(phone, "문자찜")).toContainText("링크 없음");
      expect(
        (
          await writeEvent(
            page,
            { type: "buyer.unmerge", from: day.memoBuyer, reason: "다른 사람" },
            { date: day.date, rehearsal: false },
          )
        ).status,
      ).toBeLessThan(300);
      await expect(rows).toHaveCount(2, { timeout: 3000 });
      await expect(buyerRow(phone, "문자찜(가람이)")).toContainText(
        "링크 있음",
      );
    } finally {
      await phone.context().close();
    }
  });
});

test.describe("AC-N4b-31·32 리허설 한 사람 파일", () => {
  test('리허설 줄의 "이미지(JPG)"·"PDF" 이름은 리허설-확인서-YYYY-MM-DD-<이름>', async ({
    page,
  }) => {
    await login(page);
    const date = uniqueDate();
    const b = await openNewBroadcast(page, {
      date,
      rehearsal: true,
      title: "연습",
    });
    await registerApi(page, b, 15, "핑크프릴", 10000);
    await viewerClaim(page, b, "홍길동", "15", uniq("sim_r_"));
    await expect
      .poll(async () => (await scopeView(page, date, true)).settlements.length)
      .toBe(1);
    await endBroadcast(page, b);
    await page.goto(receiptsPath(b));
    const row = buyerRow(page, "홍길동");
    const [jpg] = await Promise.all([
      page.waitForEvent("download"),
      row.getByRole("button", { name: "이미지(JPG)" }).click(),
    ]);
    expect(jpg.suggestedFilename()).toBe(`리허설-확인서-${date}-홍길동.jpg`);
    expect(isBaselineJpeg(await downloadBytes(jpg))).toBe(true);
    const [pdf] = await Promise.all([
      page.waitForEvent("download"),
      row.getByRole("button", { name: "PDF" }).click(),
    ]);
    expect(pdf.suggestedFilename()).toBe(`리허설-확인서-${date}-홍길동.pdf`);
  });
});
