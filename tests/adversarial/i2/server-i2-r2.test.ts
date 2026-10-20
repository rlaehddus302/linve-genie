// I2 적대 테스트 라운드 2 (test-domain): 수정 라운드 2(가게 이름 그대로 저장·등록 본문 상한 3 × 2MB + 64KB·여러 날짜 조회 캐시 밖 읽기)를 다시 공격한다.
// - TD-I2-009: 등록 본문 상한의 근거 "품종 JSON은 원래 파일 바이트의 3배를 넘지 않는다"가 제어 글자(U+0001 등 — R-3 공백이 아니라 정규화 뒤에도 남는다)에서 깨진다.
//   JSON은 제어 글자를 `\u0001`(6바이트)로 적어 1바이트가 6배가 된다. 그래서 2MB 안의 UTF-8 CSV가 미리 보기에서 R-18 결과 대신 413 "파일 안의 내용이 너무 많아요."가 된다(AC-I2-51).
//   판정 D-I2-17: 품종에 제어 글자(U+0000~001F, U+007F~009F)가 남으면 문제 줄 NAME_CONTROL — 등록할 줄에 오르지 않으니 등록 본문이 커지지 않는다.
//   그래서 기대값을 "미리 보기 200, 등록 0·문제 500, 줄마다 NAME_CONTROL, 413 아님"으로 바꾸었다(판정에 따른 교체).
// - 긴 이름 판매자(SA-I2-006 회귀): D-I2-18로 계정 만들기도 30자 상한이라, 30자 이름으로 만든 뒤 DB에서 이름을 바꿔 흉내 낸다.
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

/** 계정 만들기 상한(30자, D-I2-18) 전에 만든 판매자를 흉내 낸다 — DB에서 가게 이름만 바꾼다 */
async function renameSeller(
  world: Awaited<ReturnType<typeof newWorld>>,
  sellerId: string,
  name: string,
): Promise<void> {
  const pglite = world.database.pglite;
  if (pglite === null) throw new Error("PGlite 시험 DB가 아니에요");
  await pglite.query("update sellers set name = $1 where id = $2", [name, sellerId]);
}

type PreviewRow = {
  line: number;
  no?: number;
  name?: string;
  price?: number;
  error?: string;
};

describe("TD-I2-009 제어 글자가 든 .csv — 2MB 안의 파일은 413이 아니라 줄마다 NAME_CONTROL (AC-I2-51, R-18 7, D-I2-17)", () => {
  it("UTF-8 CSV 500줄(품종에 U+0001, 약 1.3MB): 미리 보기 200, 등록 0·문제 500, 줄마다 NAME_CONTROL", async () => {
    const world = await newWorld();
    const seller = await addSeller(world);
    const b = (await createBroadcast(world, seller, { date: D })).id;
    // 품종 = "핑크프릴" + U+0001 × 2,600 — R-3 정규화는 공백만 다룬다(U+0001은 공백이 아니라 그대로 남는다)
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
    // 413 FILE_TOO_LARGE "파일 안의 내용이 너무 많아요."가 나오면 안 된다 — 파일은 2MB 안이고 칸도 셋뿐이다
    expect(preview.status, preview.text.slice(0, 300)).not.toBe(413);
    expect(preview.status, preview.text.slice(0, 300)).toBe(200);
    expect([preview.body.register, preview.body.problems]).toEqual([0, 500]);
    const rows = preview.body.rows as PreviewRow[];
    expect(rows).toHaveLength(500);
    expect(rows.map((row) => row.error)).toEqual(
      Array.from({ length: 500 }, () => "NAME_CONTROL"),
    );
    expect(rows.map((row) => row.line)).toEqual(
      Array.from({ length: 500 }, (_, i) => i + 1),
    );
  }, 120_000);

  it("제어 글자 줄 250개와 제어 글자 없는 줄 250개를 섞은 CSV: 깨끗한 줄만 등록할 줄이 되고, 그 줄을 그대로 등록하면 200", async () => {
    const world = await newWorld();
    const seller = await addSeller(world);
    const b = (await createBroadcast(world, seller, { date: D })).id;
    const dirty = `핑크프릴${"\u0001".repeat(2600)}`;
    // 깨끗한 줄도 꽤 길게 — 등록 본문이 기본 상한(64KB)보다 커야 상한 경로까지 지난다
    const clean = (i: number) => `방울복랑 금 대품 ${"가".repeat(300)} ${String(i)}`;
    const lines: string[] = ["번호,품종,가격"];
    for (let i = 1; i <= 500; i++)
      lines.push(
        i % 2 === 0
          ? `${String(i)},${clean(i)},15000`
          : `${String(i)},${dirty},15000`,
      );
    const file = Buffer.from(lines.join("\r\n"), "utf8");
    expect(file.byteLength).toBeLessThan(2 * 1024 * 1024);
    const preview = await post(
      world,
      seller,
      `/api/broadcasts/${b}/import/preview`,
      { file: { name: "섞임.csv", data: file.toString("base64") } },
    );
    expect(preview.status, preview.text.slice(0, 300)).toBe(200);
    expect(preview.body.header).toBe(1);
    expect([preview.body.register, preview.body.problems]).toEqual([250, 250]);
    const rows = preview.body.rows as PreviewRow[];
    for (const row of rows) {
      // 줄 번호 = 파일 줄(머리글이 1) → 상품 번호 = 줄 - 1
      const no = row.line - 1;
      if (no % 2 === 0)
        expect(row, `줄 ${String(row.line)}`).toMatchObject({
          no,
          name: clean(no),
          price: 15000,
        });
      else expect(row, `줄 ${String(row.line)}`).toMatchObject({ error: "NAME_CONTROL" });
    }
    const register = rows
      .filter((row) => row.error === undefined)
      .map(({ no, name: n, price }) => ({ no, name: n, price }));
    expect(register).toHaveLength(250);
    const body = { requestId: rid("imp"), rows: register };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(64 * 1024);
    const registered = await post(
      world,
      seller,
      `/api/broadcasts/${b}/import`,
      body,
    );
    expect(registered.status, registered.text.slice(0, 300)).toBe(200);
    expect(registered.body.registered).toBe(250);
  }, 120_000);

  it("붙여 넣은 글은 200,000글자 상한 안이면 제어 글자가 있어도 미리 보기 200, 문제 500·줄마다 NAME_CONTROL (회귀)", async () => {
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
    expect([preview.body.register, preview.body.problems]).toEqual([0, 500]);
    expect((preview.body.rows as PreviewRow[]).map((row) => row.error)).toEqual(
      Array.from({ length: 500 }, () => "NAME_CONTROL"),
    );
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
    // D-I2-18: 계정 만들기도 30자 상한이다. 예전에 만든 긴 이름 판매자는 30자 이름으로 만든 뒤 DB에서 이름을 바꿔 흉내 낸다
    expect([...longName].length).toBeGreaterThan(30);
    const created = await createSellerAccount(
      world.database.db,
      Buffer.from(world.masterKey, "base64"),
      {
        shopName: [...longName].slice(0, 30).join(""),
        loginId: "longname2",
        password: "correct-horse-1",
      },
      { passwordCost: FAST_COST },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await renameSeller(world, created.sellerId, longName);
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
