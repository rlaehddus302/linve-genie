// I2 적대 테스트 라운드 2 (test-domain): 수정 라운드 2(가게 이름 그대로 저장·등록 본문 상한 3 × 2MB + 64KB·여러 날짜 조회 캐시 밖 읽기)를 다시 공격한다.
// - TD-I2-009: 등록 본문 상한의 근거 "품종 JSON은 원래 파일 바이트의 3배를 넘지 않는다"가 제어 글자(U+0001 등 — R-3 공백이 아니라 정규화 뒤에도 남는다)에서 깨진다.
//   JSON은 제어 글자를 `\u0001`(6바이트)로 적어 1바이트가 6배가 된다. 그래서 2MB 안의 UTF-8 CSV가 미리 보기에서 R-18 결과 대신 413 "파일 안의 내용이 너무 많아요."가 된다(AC-I2-51).
// - 회귀: 가게 이름 그대로 저장(앞뒤 공백만 다른 값), 고친 긴 이름은 거절.
import { describe, expect, it } from "vitest";
import { createSellerAccount } from "../../../apps/server/src/accounts.ts";
import { post } from "../../../apps/server/test/i2-support.ts";
import {
  FAST_COST,
  ORIGIN,
  addSeller,
  createBroadcast,
  login,
  newWorld,
  rid,
} from "../../../apps/server/test/support.ts";

const D = "2026-10-19";

describe("TD-I2-009 제어 글자가 든 .csv — 2MB 안의 파일은 미리 보기·등록된다 (AC-I2-51, R-18 7)", () => {
  it('UTF-8 CSV 500줄(품종에 U+0001, 약 1.3MB): 미리 보기 200 "500개 등록하기" → 같은 줄 등록 성공', async () => {
    const world = await newWorld();
    const seller = await addSeller(world);
    const b = (await createBroadcast(world, seller, { date: D })).id;
    // 품종 = "핑크프릴" + U+0001 × 2,600 — R-3 정규화는 공백만 다룬다(U+0001은 공백이 아니라 그대로 남는다, R-18 7 "정규화한 글 그대로")
    const name = `핑크프릴${"\u0001".repeat(2600)}`;
    const lines: string[] = [];
    for (let i = 1; i <= 500; i++) lines.push(`${String(i)},${name},15000`);
    const file = Buffer.from(lines.join("\r\n"), "utf8");
    expect(file.byteLength).toBeLessThan(1.5 * 1024 * 1024);
    const preview = await post(
      world,
      seller,
      `/api/broadcasts/${b}/import/preview`,
      { file: { name: "상품목록.csv", data: file.toString("base64") } },
    );
    // 지금: 413 FILE_TOO_LARGE "파일 안의 내용이 너무 많아요. 번호·품종·가격 세 칸만 새 파일에 옮겨 다시 골라 주세요." — 파일은 2MB 안이고 칸도 셋뿐이다
    expect(preview.status, preview.text.slice(0, 300)).toBe(200);
    expect([preview.body.register, preview.body.problems]).toEqual([500, 0]);
    const rows = (
      preview.body.rows as { no: number; name: string; price: number }[]
    ).map(({ no, name: n, price }) => ({ no, name: n, price }));
    const registered = await post(
      world,
      seller,
      `/api/broadcasts/${b}/import`,
      { requestId: rid("imp"), rows },
    );
    expect(registered.status, registered.text.slice(0, 300)).toBe(200);
    expect(registered.body.registered).toBe(500);
  }, 120_000);

  it("붙여 넣은 글은 200,000글자 상한 안이면 제어 글자가 있어도 미리 보기가 R-18 결과를 준다 (회귀)", async () => {
    const world = await newWorld();
    const seller = await addSeller(world);
    const b = (await createBroadcast(world, seller, { date: D })).id;
    const lines: string[] = [];
    for (let i = 1; i <= 500; i++)
      lines.push(`${String(i)}\t핑크프릴${"\u0001".repeat(380)}\t15000`);
    const text = lines.join("\n");
    expect(text.length).toBeLessThanOrEqual(200_000);
    const preview = await post(
      world,
      seller,
      `/api/broadcasts/${b}/import/preview`,
      { text },
    );
    expect(preview.status, preview.text.slice(0, 300)).toBe(200);
    expect([preview.body.register, preview.body.problems]).toEqual([500, 0]);
  }, 120_000);
});

describe("SA-I2-006 회귀: 가게 이름 그대로 저장", () => {
  const longName = "초록다육 다육이 전문 농장 직영 라이브 판매 공식 가게 본점";
  const put = async (
    world: Awaited<ReturnType<typeof newWorld>>,
    cookie: string,
    body: Record<string, string>,
  ) =>
    world.server.app.request("/api/shop", {
      method: "PUT",
      headers: {
        Cookie: cookie,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const account = {
    bank: "농협",
    accountNumber: "302-9988-7766-11",
    accountHolder: "김판매",
    accountNote: "",
  };

  it("긴 이름 그대로(앞뒤 공백·탭 아닌 공백만 다름)는 저장되고, 한 글자라도 고친 긴 이름·안쪽 공백이 다른 이름은 거절", async () => {
    const world = await newWorld();
    const created = await createSellerAccount(
      world.database.db,
      Buffer.from(world.masterKey, "base64"),
      { shopName: longName, loginId: "longname2", password: "correct-horse-1" },
      { passwordCost: FAST_COST },
    );
    expect(created.ok).toBe(true);
    const cookie = await login(world, "longname2", "correct-horse-1");
    expect(
      (await put(world, cookie, { name: `  ${longName}\u3000`, ...account }))
        .status,
    ).toBe(200);
    const changed = await put(world, cookie, {
      name: `${longName}점`,
      ...account,
    });
    expect(changed.status).toBe(400);
    const spaced = await put(world, cookie, {
      name: longName.replace(" ", "  "),
      ...account,
    });
    expect(spaced.status).toBe(400);
  }, 60_000);
});
