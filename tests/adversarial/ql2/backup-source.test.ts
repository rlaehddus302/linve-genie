// QL2 적대 시험 (test-domain, AC-QL2-33 · DAT-04 · D-QL2-08): 백업 복구·가져오기의 채팅 출처 되살리기를 공격한다.
// - 파일엔 출처 칸이 없다. 복구 때 리허설 범위면 rehearsal, 메시지 ID가 `ig:`·`tt:`로 시작하면 other, 그 밖(모르면)은 youtube(AI에 안 보냄·봉인 대상).
// - 실제 파일을 만들고 채팅의 메시지 ID만 비튼 뒤 이벤트 요약값·파일 요약값을 다시 맞춰 가져온다(형식 3과, 봉인 칸을 뺀 형식 2).
//   비튼 ID: `IG:`(대문자)·`sms:`·` ig:`(앞 공백)·`ig`(쌍점 없음)·`TT:`·전각 `ｉｇ:`·제로폭 `i\u200bg:`·`yt:ig:`
// - ID 칸이 없거나 빈 글인 채팅: 엔진이 다시 계산하지 못해 파일을 거절하거나(안전), 가져오면 youtube
// - 대조군: 비틀지 않은 `ig:`·`tt:` 줄은 other(AI로 감), 리허설 범위의 `ig:` 줄은 rehearsal
// - 범위의 유튜브 채팅 표시(봉인 대상)는 비튼 줄 하나라도 있으면 있음, 인스타·틱톡 줄만 남은 범위는 없음
// - 순수 함수 restoredChatSource는 무작위 ID로 참조 규칙과 대조한다
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import {
  FolderBackupStorage,
  backupDigest,
  backupEventDigest,
  createBackupBytes,
  restoreSeller,
  restoredChatSource,
  type BackupEvent,
  type BackupFile,
} from "../../../apps/server/src/backup.ts";
import { randomIds } from "../../../apps/server/src/ids.ts";
import {
  assistWorld,
  byText,
  enableAssist,
  reviews,
  sentTexts,
  shortsBroadcast,
  suggest,
} from "../../../apps/server/test/a1-support.ts";
import { kst } from "../../../apps/server/test/i2-support.ts";
import {
  addSeller,
  expectOk,
  fakeClock,
  type Seller,
  type TestServer,
} from "../../../apps/server/test/support.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "livejjim-ql2-adv-"));
  dirs.push(dir);
  return dir;
};

const pg = (world: TestServer) => {
  const db = world.database.pglite;
  if (db === undefined || db === null) throw new Error("PGlite가 아니다");
  return db;
};
const decode = (bytes: Uint8Array): BackupFile =>
  JSON.parse(gunzipSync(bytes).toString("utf8")) as BackupFile;
const encode = (file: BackupFile): Uint8Array =>
  new Uint8Array(
    gzipSync(
      Buffer.from(
        JSON.stringify({ ...file, digest: backupDigest(file) }),
        "utf8",
      ),
    ),
  );

const DAY = "2026-10-21";
const DAY_IG_ONLY = "2026-10-22";

/** 자리표시 ID → 비튼 ID (undefined = id 칸을 지운다) */
const TWISTS: readonly [
  placeholder: string,
  twisted: string | undefined,
  label: string,
][] = [
  ["ig:p-upper", "IG:x1", "대문자 IG:"],
  ["ig:p-sms", "sms:x2", "sms:"],
  ["ig:p-space", " ig:x3", "앞 공백"],
  ["ig:p-nocolon", "igx4", "쌍점 없음"],
  ["ig:p-ttupper", "TT:x5", "대문자 TT:"],
  ["ig:p-wide", "ｉｇ:x6", "전각"],
  ["ig:p-zw", "i​g:x7", "제로폭"],
  ["ig:p-nested", "yt:ig:x8", "앞에 다른 접두어"],
];
// 글에 S·M·L 같은 옵션 글자가 섞이면 주문으로 읽혀 확인 필요 항목이 안 생긴다 — 한글 낱말만 쓴다
const WORDS = [
  "가나",
  "다라",
  "마바",
  "사아",
  "자차",
  "카타",
  "파하",
  "거너",
  "더러",
  "머버",
];
const keyOf = (placeholder: string): string =>
  WORDS[TWISTS.findIndex(([p]) => p === placeholder)] ?? "서저";
const textOf = (placeholder: string): string =>
  `반바지 비틈${keyOf(placeholder)}`;
const KEEP_IG = "반바지 진짜인스타";
const KEEP_TT = "반바지 진짜틱톡";
const REHEARSAL_IG = "반바지 리허설인스타";
const ONLY_IG = "반바지 인스타만";

async function openChat(
  world: TestServer,
  seller: Seller,
  b: string,
  id: string,
  text: string,
): Promise<void> {
  const outcome = await world.server.service.ingestOpenChat(seller.sellerId, {
    b,
    id,
    ch: `UCbuyer-${id}`,
    nick: "댓글손님",
    text,
  });
  expect(outcome.status, id).toBe("recorded");
}

/** 원본: DAY 실제 범위(비틀 줄 + ig:·tt: 대조군), DAY 리허설 범위(ig:), DAY_IG_ONLY 실제 범위(ig:만) — 기록 때는 모두 인스타·틱톡 경로 */
async function makeSource() {
  const clock = fakeClock(kst(DAY, "10:00:00"));
  const s = await assistWorld({
    clock,
    server: { backupStorage: new FolderBackupStorage(tempDir()) },
  });
  const real = await shortsBroadcast(s.world, s.seller);
  expect(real.date).toBe(DAY);
  for (const [placeholder] of TWISTS)
    await openChat(
      s.world,
      s.seller,
      real.id,
      placeholder,
      textOf(placeholder),
    );
  await openChat(s.world, s.seller, real.id, "ig:keep-1", KEEP_IG);
  await openChat(s.world, s.seller, real.id, "tt:keep-2", KEEP_TT);
  const rehearsal = await shortsBroadcast(s.world, s.seller, {
    rehearsal: true,
  });
  await openChat(s.world, s.seller, rehearsal.id, "ig:reh-1", REHEARSAL_IG);
  clock.set(kst(DAY_IG_ONLY, "10:00:00"));
  const only = await shortsBroadcast(s.world, s.seller);
  expect(only.date).toBe(DAY_IG_ONLY);
  await openChat(s.world, s.seller, only.id, "ig:only-1", ONLY_IG);
  const bytes = await createBackupBytes(
    s.world.database.db,
    s.seller.sellerId,
    s.world.clock.now(),
  );
  return { ...s, clock, bytes };
}

/** 채팅의 메시지 ID를 비틀고 이벤트 요약값을 다시 맞춘다 */
function twist(
  file: BackupFile,
  twists: readonly (readonly [string, string | undefined, string])[] = TWISTS,
): BackupFile {
  const map = new Map(
    twists.map(([placeholder, twisted]) => [placeholder, twisted]),
  );
  let changed = 0;
  const scopes = file.scopes.map((scope) => ({
    ...scope,
    events: scope.events.map((event): BackupEvent => {
      if (event.type !== "chat") return event;
      const body = JSON.parse(event.body) as Record<string, unknown>;
      const id = body.id as string;
      if (!map.has(id)) return event;
      changed++;
      const twisted = map.get(id);
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (key !== "id") next[key] = value;
        else if (twisted !== undefined) next[key] = twisted;
      }
      const text = JSON.stringify(next);
      return {
        ...event,
        body: text,
        digest: backupEventDigest(
          scope.date,
          scope.rehearsal,
          event.seq,
          event.type,
          text,
          event.failed,
        ),
      };
    }),
  }));
  expect(changed).toBe(twists.length);
  return { ...file, scopes } as BackupFile;
}

/** 형식 2: 범위에 봉인 칸이 없다 */
function asVersion2(file: BackupFile): BackupFile {
  return {
    ...file,
    version: 2,
    scopes: file.scopes.map((scope) => {
      const { sealed, ...rest } = scope as unknown as Record<string, unknown>;
      expect(sealed ?? null).toBeNull();
      return rest;
    }),
  } as unknown as BackupFile;
}

interface ChatRow {
  readonly text: string;
  readonly rehearsal: boolean;
  readonly source: string | null;
}
async function chatRows(world: TestServer, seller: Seller): Promise<ChatRow[]> {
  const rows = await pg(world).query<ChatRow>(
    `select coalesce(r.text, e.body::json->>'text') as text, s.rehearsal, e.chat_source as source
       from events e join scopes s on s.id = e.scope_id
       left join chat_raw r on r.seller_id = e.seller_id and r.scope_id = e.scope_id and r.seq = e.seq
      where e.seller_id = $1 and e.type = 'chat' order by s.date, s.rehearsal, e.seq`,
    [seller.sellerId],
  );
  return rows.rows;
}
async function marks(
  world: TestServer,
  seller: Seller,
): Promise<[string, boolean, boolean][]> {
  const rows = await pg(world).query<{
    date: string;
    rehearsal: boolean;
    y: boolean;
  }>(
    "select date, rehearsal, youtube_chat as y from scopes where seller_id = $1 order by date, rehearsal",
    [seller.sellerId],
  );
  return rows.rows.map((row) => [row.date, row.rehearsal, row.y]);
}

const excludedOf = (row: unknown): unknown =>
  (row as Record<string, unknown>).excluded;

async function importAndCheck(bytes: Uint8Array, now: number): Promise<void> {
  const other = await assistWorld({ clock: fakeClock(now) });
  const target = await addSeller(other.world);
  const restored = await restoreSeller({
    db: other.world.database.db,
    sellerId: target.sellerId,
    bytes,
    replace: false,
    storage: null,
    clock: other.world.clock,
    ids: randomIds,
  });
  expect(restored.ok, restored.ok ? "" : restored.reason).toBe(true);

  const rows = await chatRows(other.world, target);
  const sourceOf = (text: string): string | null => {
    const found = rows.filter((row) => row.text === text);
    expect(found, text).toHaveLength(1);
    return (found[0] as ChatRow).source;
  };
  for (const [placeholder, , label] of TWISTS)
    expect(sourceOf(textOf(placeholder)), label).toBe("youtube");
  expect(sourceOf(KEEP_IG)).toBe("other");
  expect(sourceOf(KEEP_TT)).toBe("other");
  expect(sourceOf(REHEARSAL_IG)).toBe("rehearsal");
  expect(sourceOf(ONLY_IG)).toBe("other");
  expect(rows).toHaveLength(TWISTS.length + 4);

  // 봉인 대상 표시: 비튼 줄이 있는 실제 범위 = 있음, 리허설 = 없음, 인스타만 = 없음
  expect(await marks(other.world, target)).toEqual([
    [DAY, false, true],
    [DAY, true, false],
    [DAY_IG_ONLY, false, false],
  ]);

  // AI 거르기: 비튼 줄은 가짜 LLM에 가지 않고 YOUTUBE_POLICY, 대조군은 간다
  await enableAssist(other.world, target);
  expect(
    (await expectOk(suggest(other.world, target, { rehearsal: false }))).body
      .result,
  ).toBe("DONE");
  const sent = other.fake.requests.flatMap((_, index) =>
    sentTexts(other.fake, index),
  );
  const raw = other.fake.requests.map((request) => request.raw).join("\n");
  for (const [placeholder, , label] of TWISTS) {
    expect(sent, label).not.toContain(textOf(placeholder));
    expect(raw, label).not.toContain(`비틈${keyOf(placeholder)}`);
  }
  expect(sent).toContain(KEEP_IG);
  expect(sent).toContain(KEEP_TT);
  const list = await reviews(other.world, target);
  for (const [placeholder, , label] of TWISTS)
    expect(excludedOf(byText(list, textOf(placeholder))), label).toBe(
      "YOUTUBE_POLICY",
    );
  expect(excludedOf(byText(list, KEEP_IG))).toBeNull();
  expect(excludedOf(byText(list, KEEP_TT))).toBeNull();
}

describe("AC-QL2-33 모르면 유튜브 — 비튼 메시지 ID로 가져오기", () => {
  it("형식 3: IG:·sms:·앞 공백·쌍점 없음·TT:·전각·제로폭·다른 접두어 줄은 youtube(봉인 대상·AI 제외), ig:·tt: 대조군은 other, 리허설 ig:는 rehearsal", async () => {
    const s = await makeSource();
    const file = decode(s.bytes);
    expect(file.version).toBe(3);
    await importAndCheck(encode(twist(file)), s.clock.now());
  });

  it("형식 2 파일(봉인 칸 없음)도 같은 규칙", async () => {
    const s = await makeSource();
    const v2 = asVersion2(twist(decode(s.bytes)));
    expect(v2.version).toBe(2);
    await importAndCheck(encode(v2), s.clock.now());
  });

  it("비틀지 않은 파일은 그대로 가져와진다 — 기록 때 ig:·tt: 줄은 모두 other로 되살아남(늘 youtube로 넣는 구현을 잡는다)", async () => {
    const s = await makeSource();
    const other = await assistWorld({ clock: fakeClock(s.clock.now()) });
    const target = await addSeller(other.world);
    const restored = await restoreSeller({
      db: other.world.database.db,
      sellerId: target.sellerId,
      bytes: s.bytes,
      replace: false,
      storage: null,
      clock: other.world.clock,
      ids: randomIds,
    });
    expect(restored.ok, restored.ok ? "" : restored.reason).toBe(true);
    const rows = await chatRows(other.world, target);
    expect(
      rows
        .filter((row) => !row.rehearsal)
        .every((row) => row.source === "other"),
    ).toBe(true);
    expect(
      rows.filter((row) => row.rehearsal).map((row) => row.source),
    ).toEqual(["rehearsal"]);
    expect(await marks(other.world, target)).toEqual([
      [DAY, false, false],
      [DAY, true, false],
      [DAY_IG_ONLY, false, false],
    ]);
  });
});

describe("AC-QL2-33 메시지 ID 칸이 없거나 빈 글인 채팅", () => {
  // 엔진은 메시지 ID 없는·빈 채팅을 다시 계산하지 못한다(어느 서버도 그런 줄을 쓰지 않는다). 파일 전체를 거절하면 아무것도 AI에 가지 않아 안전 쪽이고,
  // 가져온다면 그 줄은 youtube여야 한다 — 둘 중 하나. 어느 쪽이든 other로 들어가거나 일부만 들어가면 안 된다.
  for (const [twisted, label] of [
    [undefined, "ID 없음"],
    ["", "빈 글"],
  ] as const) {
    it(`${label}: 거절(쉬운 까닭, 빈 판매자 그대로)이거나 youtube로 들어간다`, async () => {
      const s = await makeSource();
      const bytes = encode(
        twist(decode(s.bytes), [["ig:p-upper", twisted, label]]),
      );
      const other = await assistWorld({ clock: fakeClock(s.clock.now()) });
      const target = await addSeller(other.world);
      const restored = await restoreSeller({
        db: other.world.database.db,
        sellerId: target.sellerId,
        bytes,
        replace: false,
        storage: null,
        clock: other.world.clock,
        ids: randomIds,
      });
      if (!restored.ok) {
        expect(restored.reason).toMatch(/[가-힣]/u);
        expect(await chatRows(other.world, target)).toEqual([]);
        expect(await marks(other.world, target)).toEqual([]);
        return;
      }
      const rows = await chatRows(other.world, target);
      expect(
        rows.find((row) => row.text === textOf("ig:p-upper"))?.source,
      ).toBe("youtube");
    });
  }
});

describe("restoredChatSource 속성 (D-QL2-08)", () => {
  const reference = (rehearsal: boolean, id: unknown): string =>
    rehearsal
      ? "rehearsal"
      : typeof id === "string" && /^(ig|tt):/u.test(id)
        ? "other"
        : "youtube";
  const idArb = fc.oneof(
    fc.string(),
    fc
      .constantFrom(
        "ig:",
        "tt:",
        "IG:",
        "Ig:",
        "iG:",
        "TT:",
        " ig:",
        "\tig:",
        "ig",
        "tt",
        "ig;",
        "sms:",
        "yt:",
        "ｉｇ:",
        "i​g:",
        "​ig:",
      )
      .chain((prefix) => fc.string().map((rest) => `${prefix}${rest}`)),
    fc.constantFrom(undefined, null, 0, 7, true, {}, ["ig:x"]),
  );
  it("무작위 ID·리허설 여부에서 참조 규칙과 같다 — 결과는 rehearsal·other·youtube 셋 뿐", () => {
    fc.assert(
      fc.property(fc.boolean(), idArb, (rehearsal, id) => {
        const got = restoredChatSource(rehearsal, id);
        expect(["rehearsal", "other", "youtube"]).toContain(got);
        expect(got).toBe(reference(rehearsal, id));
      }),
      { numRuns: 500 },
    );
  });
});
