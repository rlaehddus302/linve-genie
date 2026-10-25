// SMS2 적대 시험 (test-domain): 연습 모드 전용 문자 자동 수신 시험 도구(/_try/sms-test)를 공격한다.
// - 요약(빠진 번호·늦게 온 번호·다음에 보낼 글·늦은 정도)을 무작위 열로 참조 모형과 대조한다 (AC-SMS2-05·10·11·12).
// - 상자에 받기·지우기·보기를 무작위로 섞어 줄 수·줄 번호·겹침·50건 넘침을 모형과 대조한다 (AC-SMS2-07·08·13·14).
// - 원문 번호·연락처 이름이 응답·화면·entries()·console 어디에도 없는지 (AC-SMS2-40).
// - 본문·기기 이름·receivedAt의 믿을 수 없는 값, 기기 50가지, 1000번 겹침, 동시 요청 (AC-SMS2-41·08).
// - 지우기 보호 표, 같은 와이파이 http 받는 곳의 경로 변형 (AC-SMS2-15·17).
// - 서버 시간대를 바꿔도 같은 결과 (AC-SMS2-02).
import type { AddressInfo } from "node:net";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSmsTestBox,
  createSmsTestHttpServer,
  delayLabel,
  parsePhoneAt,
  readSerial,
  SMS_TEST_LIMIT,
  SMS_TEST_PATH,
  summarizeDevice,
} from "../../../apps/server/src/try/sms-test.ts";

const TOKEN = "abcd-efgh-jk23";
const BASE = `https://192.168.0.10:7701${SMS_TEST_PATH}`;
const SERVER_AT = new Date("2026-10-26T05:03:08.000Z");
const SERVER_MS = SERVER_AT.getTime();

type Box = ReturnType<typeof createSmsTestBox>;

function post(body: unknown, token: string | null = TOKEN, query = ""): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-try-token"] = token;
  return new Request(`${BASE}${query}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function must(box: Box, request: Request): Promise<Response> {
  const response = await box.handle(request);
  if (response === null) throw new Error("응답 없음");
  return response;
}

async function view(box: Box, query = ""): Promise<string> {
  const response = await must(box, new Request(`${BASE}?t=${TOKEN}${query}`));
  expect(response.status).toBe(200);
  return response.text();
}

/** 태그를 빼고 화면에 보이는 글 */
function visible(page: string): string {
  return page
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function groupOf(page: string, device: string): string {
  const groups = page.split('<div class="group">').slice(1);
  const found = groups.find((g) => visible(g).trimStart().startsWith(`${device} — `));
  if (found === undefined) throw new Error(`덩어리 없음: ${device}`);
  return visible(found.split("</div>")[0] ?? "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ───────────────────────────── 참조 모형 ─────────────────────────────

function refList(numbers: readonly number[]): string {
  const shown = numbers.slice(0, 20).join(", ");
  return numbers.length > 20 ? `${shown} 외 ${numbers.length - 20}개` : shown;
}

/** 스펙 문장 그대로 다시 쓴 요약 (AC-SMS2-05·09~12). 시각은 지연 ms(null = 없음)로 받는다 */
function refSummary(rows: readonly { serial: number | null; count: number; delay: number | null }[]): string[] {
  const out: string[] = [];
  const extra = rows.reduce((s, r) => s + r.count, 0) - rows.length;
  out.push(extra === 0 ? "겹쳐 온 것: 없음" : `겹쳐 온 것: ${extra}번 (한 번으로 셌어요)`);
  const measured = rows.filter((r) => r.delay !== null && r.delay >= -1000).map((r) => Math.max(r.delay as number, 0));
  const off = rows.filter((r) => r.delay !== null && r.delay < -1000).length;
  const none = rows.filter((r) => r.delay === null).length;
  if (measured.length === 0) out.push("늦은 정도: 휴대폰이 받은 시각이 오지 않아 잴 수 없어요.");
  else {
    const sum = measured.reduce((a, b) => a + b, 0);
    const n = measured.length;
    let avg = "1초 안";
    if (sum >= 1000 * n) {
      // 100ms 단위 반올림 (정수로만): round(sum / n / 100)
      const tenths = Math.floor((2 * sum + 100 * n) / (200 * n));
      avg = `${Math.floor(tenths / 10)}.${tenths % 10}초`;
    }
    const max = Math.max(...measured);
    const maxLabel = max < 1000 ? "1초 안" : `${Math.round(max / 1000)}초`;
    out.push(`늦은 정도: 평균 ${avg} · 가장 늦은 것 ${maxLabel} (${n}건으로 쟀어요)`);
  }
  if (off > 0) out.push(`휴대폰 시계가 맞지 않아 뺀 것 ${off}건`);
  if (none > 0) out.push(`휴대폰이 받은 시각 없이 온 것 ${none}건`);
  const firsts: number[] = [];
  for (const r of rows) if (r.serial !== null && !firsts.includes(r.serial)) firsts.push(r.serial);
  const noSerial = rows.filter((r) => r.serial === null).length;
  const max = firsts.length === 0 ? 0 : Math.max(...firsts);
  if (firsts.length === 0) out.push("'시험 1'처럼 번호를 붙여 보내면 빠진 문자와 순서도 볼 수 있어요.");
  else {
    const missing: number[] = [];
    for (let k = 1; k <= max; k++) if (!firsts.includes(k)) missing.push(k);
    out.push(missing.length === 0 ? `시험 1~${max}: 빠진 번호 없어요` : `시험 1~${max}: 빠진 번호 ${refList(missing)}`);
    const late = firsts.filter((v, i) => firsts.slice(0, i).some((p) => p > v));
    out.push(late.length === 0 ? "순서: 보낸 차례대로 왔어요" : `순서: 늦게 온 번호 ${refList(late)}`);
    if (noSerial > 0) out.push(`번호 없는 문자 ${noSerial}건`);
    out.push(`'시험 ${max}' 뒤에 보낸 문자가 안 왔는지는 이 화면이 알 수 없어요. 마지막으로 보낸 번호와 비교해 보세요.`);
  }
  out.push(max >= 999 ? "번호를 999까지 다 썼어요. '처음부터 다시 세기'를 누르세요." : `다음에 보낼 글: 시험 ${max + 1}`);
  return out;
}

describe("SMS2 요약 — 무작위 열을 참조 모형과 대조 (AC-SMS2-05·10·11·12)", () => {
  it("summarizeDevice = 스펙 문장 (번호·겹침·지연 무작위)", () => {
    const row = fc.record({
      serial: fc.option(fc.oneof(fc.integer({ min: 1, max: 40 }), fc.constantFrom(1, 2, 3, 998, 999)), { nil: null }),
      count: fc.integer({ min: 1, max: 5 }),
      delay: fc.option(
        fc.oneof(
          fc.integer({ min: -5000, max: 60_000 }),
          fc.constantFrom(-1001, -1000, -600, 0, 499, 500, 999, 1000, 1449, 1450, 2499, 2500),
        ),
        { nil: null },
      ),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 50 }), (rows) => {
        const arrived = rows.map((r) => ({
          serial: r.serial,
          count: r.count,
          serverAt: SERVER_AT,
          phoneAt: r.delay === null ? null : new Date(SERVER_MS - r.delay),
        }));
        expect(summarizeDevice(arrived)).toEqual(refSummary(rows));
      }),
      { numRuns: 400 },
    );
  });

  it("평균 반올림 경계: 1449ms→1.4초, 1450ms→1.5초, 999ms→1초 안, 1000ms→1.0초", () => {
    const one = (d: number) => summarizeDevice([{ serial: null, count: 1, serverAt: SERVER_AT, phoneAt: new Date(SERVER_MS - d) }])[1];
    expect(one(1449)).toBe("늦은 정도: 평균 1.4초 · 가장 늦은 것 1초 (1건으로 쟀어요)");
    expect(one(1450)).toBe("늦은 정도: 평균 1.5초 · 가장 늦은 것 1초 (1건으로 쟀어요)");
    expect(one(999)).toBe("늦은 정도: 평균 1초 안 · 가장 늦은 것 1초 안 (1건으로 쟀어요)");
    expect(one(1000)).toBe("늦은 정도: 평균 1.0초 · 가장 늦은 것 1초 (1건으로 쟀어요)");
  });

  it("delayLabel 경계와 단조성 — 늦을수록 초가 줄지 않는다", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 10_000_000 }), fc.integer({ min: 0, max: 5000 }), (a, step) => {
        const sec = (label: string) => (label === "1초 안" ? 0 : Number(label.replace("초", "")));
        expect(sec(delayLabel(a + step))).toBeGreaterThanOrEqual(sec(delayLabel(a)));
      }),
      { numRuns: 300 },
    );
    expect(delayLabel(-1001)).toBe("시계 차이");
    expect(delayLabel(Number.MAX_SAFE_INTEGER)).toMatch(/^\d+초$/);
  });
});

// ───────────────────────────── 일련번호 ─────────────────────────────

describe("SMS2 일련번호 — 실제 손님·휴대폰이 보낼 법한 글 (AC-SMS2-06)", () => {
  it("결과는 늘 1~999 또는 null이고, 본문 안 첫 '시험' 뒤에 그 숫자가 실제로 있다", () => {
    const piece = fc.constantFrom("시험", " ", "  ", "\n", "3", "12", "999", "1000", "0", "３", "번", "주세요", "165", "[Web발신]", "😀", "시", "험", "a");
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (pieces) => {
        const body = pieces.join("");
        const serial = readSerial(body);
        if (serial === null) return;
        expect(Number.isInteger(serial) && serial >= 1 && serial <= 999).toBe(true);
        const after = body.slice(body.indexOf("시험") + 2);
        expect(after.trimStart().startsWith(String(serial)) || after.trimStart().replace(/^0+/, "").startsWith(String(serial))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("현실 문장 표", () => {
    const cases: [string, number | null][] = [
      ["시험 3\n165번 주세요", 3],
      ["[Web발신]\n시험 7", 7],
      ["시험 5 😀", 5],
      ["😀시험 8", 8],
      ["시험 3,000원", 3],
      ["시험", null],
      ["시험​3", null], // 제로폭 문자는 띄어쓰기가 아니다 — 번호 없음 쪽이 안전(엉뚱한 번호를 만들지 않음)
      ["시험 1000원", null],
      ["시험 -3", null],
      ["모의시험 없이 165번", null],
    ];
    for (const [body, expected] of cases) expect(readSerial(body), JSON.stringify(body)).toBe(expected);
  });
});

// ───────────────────────────── 휴대폰이 받은 시각 ─────────────────────────────

describe("SMS2 휴대폰이 받은 시각 (AC-SMS2-02·03·41)", () => {
  it("한국 시각 글(오프셋 없음) = +09:00 = Z — 무작위 지연, 서버 시간대가 달라도 같다", () => {
    const zones = ["UTC", "America/New_York", "Asia/Seoul", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
    const original = process.env.TZ;
    try {
      fc.assert(
        fc.property(fc.integer({ min: -86_400_000, max: 86_400_000 }), fc.constantFrom(...zones), (delta, zone) => {
          process.env.TZ = zone;
          const at = new Date(Math.floor((SERVER_MS - delta) / 1000) * 1000);
          const iso = at.toISOString().replace(".000Z", "Z");
          const k = new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 19);
          const expected = at.getTime();
          expect(parsePhoneAt(iso, SERVER_AT)?.getTime()).toBe(expected);
          expect(parsePhoneAt(`${k}+09:00`, SERVER_AT)?.getTime()).toBe(expected);
          expect(parsePhoneAt(`${k}+0900`, SERVER_AT)?.getTime()).toBe(expected);
          expect(parsePhoneAt(k, SERVER_AT)?.getTime()).toBe(expected);
          expect(parsePhoneAt(k.replace("T", " "), SERVER_AT)?.getTime()).toBe(expected);
          expect(parsePhoneAt(expected, SERVER_AT)?.getTime()).toBe(expected);
          expect(parsePhoneAt(String(expected / 1000), SERVER_AT)?.getTime()).toBe(expected);
        }),
        { numRuns: 200 },
      );
    } finally {
      process.env.TZ = original;
    }
  });

  it("하루 넘게 차이 나면 null, 정확히 하루는 읽는다", () => {
    expect(parsePhoneAt(SERVER_MS - 86_400_000, SERVER_AT)?.getTime()).toBe(SERVER_MS - 86_400_000);
    expect(parsePhoneAt(SERVER_MS + 86_400_000, SERVER_AT)?.getTime()).toBe(SERVER_MS + 86_400_000);
    expect(parsePhoneAt(SERVER_MS - 86_400_001, SERVER_AT)).toBeNull();
    expect(parsePhoneAt(SERVER_MS + 86_400_001, SERVER_AT)).toBeNull();
  });

  it("믿을 수 없는 값은 모두 null이고 예외가 없다", () => {
    const bad: unknown[] = [
      null, undefined, "", " ", "어제", true, false, {}, [], [SERVER_MS], Number.NaN, Number.POSITIVE_INFINITY, -1, -SERVER_MS,
      "NaN", "-1792990985000", "1e400", "1.792990985e12", "+1792990985000", "0x1A1B", "１７９２９９０９８５０００",
      "2026-10-26T24:00:00", "2026-02-29T10:00:00", "2026-10-26T14:03:60", "2026-10-26T14:03:05+24:00", "2026-10-26T14:03:05+09",
      "2026-10-26T14:03:05ZZ", "2026-10-26T14:03:05 +09:00", "x".repeat(16_000), `${"9".repeat(400)}`, "0026-10-26T14:03:05",
      "2026-10-26T14:03:05\u0000", "<script>alert(1)</script>",
    ];
    for (const value of bad) expect(parsePhoneAt(value, SERVER_AT), String(value).slice(0, 40)).toBeNull();
  });

  it("무작위 글·숫자에도 예외 없이 null이거나 서버 시각 ±24시간 안", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 80 }), fc.double(), fc.integer(), fc.bigInt().map(String), fc.date({ noInvalidDate: true }).map((d) => d.toISOString())), (value) => {
        const at = parsePhoneAt(value, SERVER_AT);
        if (at !== null) expect(Math.abs(at.getTime() - SERVER_MS)).toBeLessThanOrEqual(86_400_000);
      }),
      { numRuns: 500 },
    );
  });
});

// ───────────────────────────── 상자 무작위 조작 ─────────────────────────────

type Op =
  | { kind: "send"; device: string; from: string | null; body: string; delay: number | null }
  | { kind: "reset" }
  | { kind: "view" };

const FROMS = ["010-1234-5678", "+82 10-9999-5678", "01011112222", "엄마", "홍길동", "", null] as const;
const BODIES = ["시험 1", "시험 2", "시험 3", "시험 1 ", "165번주세요", "시험 999", "시험 4"] as const;
const DEVICES = ["iPhone", "Galaxy", " iPhone ", "<b>x</b>"] as const;

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 12,
    arbitrary: fc.record({
      kind: fc.constant("send" as const),
      device: fc.constantFrom(...DEVICES),
      from: fc.constantFrom(...FROMS),
      body: fc.constantFrom(...BODIES),
      delay: fc.option(fc.integer({ min: -3000, max: 30_000 }), { nil: null }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: "reset" as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: "view" as const }) },
);

function senderKey(from: string | null): string {
  if (from === null || from.trim() === "") return "empty";
  const digits = from.replace(/[^0-9]/g, "");
  return digits.length >= 4 ? `n:${digits.slice(-4)}` : "name";
}

describe("SMS2 상자 — 받기·지우기·보기 무작위 열을 모형과 대조 (AC-SMS2-07·08·13·14·40)", () => {
  it("줄 수·줄 번호·겹침 응답·온 횟수·50건 넘침 문장이 모형과 같고, 원문 번호·이름은 어디에도 없다", async () => {
    const logs: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args) => logs.push(args));
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 140 }), async (ops) => {
        let clock = SERVER_MS;
        const box = createSmsTestBox({ token: TOKEN, now: () => new Date(clock) });
        // 모형: 새것이 앞
        let rows: { key: string; seq: number; count: number }[] = [];
        let seq = 0;
        let dropped = false;
        const seen: string[] = [];
        for (const op of ops) {
          clock += 1000;
          if (op.kind === "reset") {
            const r = await must(box, new Request(`${BASE}?t=${TOKEN}&do=reset`, { method: "POST" }));
            expect(r.status).toBe(303);
            rows = [];
            seq = 0;
            dropped = false;
            continue;
          }
          if (op.kind === "view") {
            const page = await view(box);
            seen.push(page);
            expect(page.includes("50건이 넘어 오래된 문자는 지워졌어요")).toBe(dropped);
            expect(page.match(/<div class="card">/g)?.length ?? 0).toBe(rows.length);
            expect(page).not.toContain("<b>x</b>");
            continue;
          }
          const payload: Record<string, unknown> = { body: op.body, device: op.device };
          if (op.from !== null) payload["from"] = op.from;
          if (op.delay !== null) payload["receivedAt"] = clock - op.delay;
          const response = await must(box, post(payload));
          expect(response.status).toBe(200);
          const answerText = await response.text();
          seen.push(answerText);
          const answer = JSON.parse(answerText) as { seq: number; duplicate: boolean };
          const key = JSON.stringify([op.device.trim(), senderKey(op.from), op.body]);
          const same = rows.find((r) => r.key === key);
          if (same !== undefined) {
            same.count += 1;
            expect(answer).toMatchObject({ seq: same.seq, duplicate: true });
          } else {
            seq += 1;
            rows.unshift({ key, seq, count: 1 });
            if (rows.length > SMS_TEST_LIMIT) {
              rows = rows.slice(0, SMS_TEST_LIMIT);
              dropped = true;
            }
            expect(answer).toMatchObject({ seq, duplicate: false });
          }
          const entries = box.entries();
          expect(entries.map((e) => [e.seq, e.count])).toEqual(rows.map((r) => [r.seq, r.count]));
        }
        seen.push(await view(box), await view(box, "&do=reset-ask"), JSON.stringify(box.entries()));
        const all = seen.join("\n");
        for (const raw of ["010-1234-5678", "+82 10-9999-5678", "01011112222", "1234-5678", "9999", "엄마", "홍길동"]) expect(all).not.toContain(raw);
      }),
      { numRuns: 60 },
    );
    expect(logs).toEqual([]);
  });

  it("같은 문자 30개를 동시에 보내도 줄은 하나, 온 횟수 30, 새 줄 응답은 정확히 하나", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    const answers = await Promise.all(
      Array.from({ length: 30 }, () => must(box, post({ from: "010-1234-5678", body: "시험 1", device: "iPhone" })).then((r) => r.json() as Promise<{ seq: number; duplicate: boolean }>)),
    );
    expect(answers.filter((a) => !a.duplicate)).toHaveLength(1);
    expect(new Set(answers.map((a) => a.seq))).toEqual(new Set([1]));
    expect(box.entries()).toHaveLength(1);
    expect(box.entries()[0]?.count).toBe(30);
    const page = await view(box);
    expect(visible(page)).toContain("30번 왔어요 (한 번으로 셌어요)");
    expect(groupOf(page, "iPhone")).toContain("겹쳐 온 것: 29번 (한 번으로 셌어요)");
  });

  it("지우기와 받기가 동시에 와도 지운 뒤 줄 번호는 1부터 빈틈없이", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    for (let i = 1; i <= 5; i++) await must(box, post({ body: `시험 ${i}`, device: "iPhone" }));
    await Promise.all([
      must(box, new Request(`${BASE}?t=${TOKEN}&do=reset`, { method: "POST" })),
      ...Array.from({ length: 5 }, (_, i) => must(box, post({ body: `시험 ${i + 10}`, device: "Galaxy" }))),
    ]);
    const seqs = box.entries().map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });
});

// ───────────────────────────── 넘치기·많은 기기 ─────────────────────────────

describe("SMS2 넘치기·많은 기기 (AC-SMS2-08·41)", () => {
  it("기기 이름 50가지 + 51번째 기기: 덩어리는 들고 있는 줄의 기기 수(≤50), 밀려난 기기는 요약에서 빠진다", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    for (let i = 0; i < 51; i++) {
      const r = await must(box, post({ body: `시험 ${i + 1}`, device: `폰${i}<i>"'&` }));
      expect(r.status).toBe(200);
    }
    const page = await view(box);
    const groups = page.match(/<div class="group">/g)?.length ?? 0;
    expect(groups).toBe(50);
    expect(page).not.toContain("<i>");
    expect(visible(page)).not.toContain(`폰0<i>"'& — `);
    expect(visible(page)).toContain(`폰50<i>"'& — 받은 문자 1건`);
    expect(visible(page)).toContain("50건이 넘어 오래된 문자는 지워졌어요");
  });

  it("같은 문자 1000번 + 서로 다른 문자 49개: 줄은 50, 겹친 줄은 밀려나지 않는다(겹침은 새 줄이 아니다)", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    for (let i = 0; i < 1000; i++) await must(box, post({ from: "010-1234-5678", body: "시험 1", device: "iPhone" }));
    for (let i = 2; i <= 50; i++) await must(box, post({ from: "010-1234-5678", body: `시험 ${i}`, device: "iPhone" }));
    expect(box.entries()).toHaveLength(50);
    expect(box.entries().at(-1)).toMatchObject({ seq: 1, count: 1000 });
    const page = await view(box);
    expect(page).not.toContain("50건이 넘어");
    expect(groupOf(page, "iPhone")).toContain("시험 1~50: 빠진 번호 없어요");
    // 하나 더 오면 "시험 1"이 밀려나고, 그 뒤 "시험 1"은 새 줄
    await must(box, post({ from: "010-1234-5678", body: "시험 51", device: "iPhone" }));
    const again = (await (await must(box, post({ from: "010-1234-5678", body: "시험 1", device: "iPhone" }))).json()) as { seq: number; duplicate: boolean };
    expect(again).toMatchObject({ seq: 52, duplicate: false });
  });

  it("본문·기기 이름·receivedAt에 공격 글: 화면에 태그·속성이 생기지 않고 receivedAt은 '-'", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    const evil = `시험 7 <script>alert(1)</script>"'><img src=x onerror=alert(1)>&amp;`;
    const values: unknown[] = ["x".repeat(15_000), "1e400", -5, "NaN", "<script>", "-1792990985000"];
    for (const [i, receivedAt] of values.entries()) {
      const r = await must(box, post(JSON.stringify({ body: `${evil}${i}`, device: evil.slice(0, 40), receivedAt })));
      expect([200, 400]).toContain(r.status);
    }
    const page = await view(box);
    expect(page).not.toMatch(/<script|<img|onerror=alert\(1\)>/i);
    expect(page.match(/<\/?[a-z][^>]*>/gi)?.every((tag) => /^<\/?(html|head|meta|title|style|body|main|h1|h2|h3|p|div|section|ol|li|a|span|!doctype)\b/i.test(tag))).toBe(true);
    for (const line of visible(page).split("\n")) if (/^휴대폰이 받은 시각 [^없]/.test(line)) expect(line).toBe("휴대폰이 받은 시각 -");
    expect(box.entries()).toHaveLength(values.length);
    expect(groupOf(page, evil.slice(0, 30).trim())).toContain(`휴대폰이 받은 시각 없이 온 것 ${values.length}건`);
    expect(visible(page)).toContain(evil.slice(0, 200));
    // 확인 화면에도 받은 글은 나오지 않는다
    const ask = await view(box, "&do=reset-ask");
    expect(ask).not.toContain("alert");
  });

  it("receivedAt에 JSON 숫자 1e400이 와도 200이고 '-'", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    const r = await must(box, post('{"body":"시험 1","device":"iPhone","receivedAt":1e400}'));
    expect(r.status).toBe(200);
    expect(visible(await view(box))).toContain("늦은 정도 -");
  });
});

// ───────────────────────────── 지우기 보호 ─────────────────────────────

describe("SMS2 지우기 보호 (AC-SMS2-15)", () => {
  async function filled(): Promise<Box> {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    for (let i = 1; i <= 3; i++) await must(box, post({ body: `시험 ${i}`, device: "iPhone" }));
    return box;
  }
  const json = JSON.stringify({ body: "시험 9", device: "iPhone" });
  const attempts: [string, () => Request, number[]][] = [
    ["토큰 없음", () => new Request(`${BASE}?do=reset`, { method: "POST" }), [401]],
    ["틀린 토큰", () => new Request(`${BASE}?t=zzzz-zzzz-zzzz&do=reset`, { method: "POST" }), [401]],
    ["토큰 앞뒤 공백", () => new Request(`${BASE}?t=%20${TOKEN}&do=reset`, { method: "POST" }), [401]],
    ["토큰 대문자", () => new Request(`${BASE}?t=${TOKEN.toUpperCase()}&do=reset`, { method: "POST" }), [401]],
    ["머리글만 맞음", () => new Request(`${BASE}?do=reset`, { method: "POST", headers: { "x-try-token": TOKEN }, body: json }), [400, 401]],
    ["do 대문자", () => new Request(`${BASE}?t=${TOKEN}&do=RESET`, { method: "POST", headers: { "x-try-token": TOKEN }, body: json }), [400]],
    ["do 빈 글", () => new Request(`${BASE}?t=${TOKEN}&do=`, { method: "POST", headers: { "x-try-token": TOKEN }, body: json }), [400]],
    ["do=reset-ask를 POST", () => new Request(`${BASE}?t=${TOKEN}&do=reset-ask`, { method: "POST", headers: { "x-try-token": TOKEN }, body: json }), [400]],
    ["do=xyz", () => new Request(`${BASE}?t=${TOKEN}&do=xyz`, { method: "POST", headers: { "x-try-token": TOKEN }, body: json }), [400]],
    ["GET do=reset", () => new Request(`${BASE}?t=${TOKEN}&do=reset`), [200, 405]],
    ["PUT do=reset", () => new Request(`${BASE}?t=${TOKEN}&do=reset`, { method: "PUT" }), [405]],
    ["DELETE", () => new Request(`${BASE}?t=${TOKEN}`, { method: "DELETE" }), [405]],
  ];
  for (const [name, make, statuses] of attempts) {
    it(`${name} → 지우지 않고, 받지도 않는다`, async () => {
      const box = await filled();
      const r = await must(box, make());
      expect(statuses).toContain(r.status);
      expect(box.entries().map((e) => e.serial)).toEqual([3, 2, 1]);
    });
  }

  it("do가 두 번(reset, xyz)이면 첫 값 — 토큰이 맞을 때만 지운다", async () => {
    const box = await filled();
    expect((await must(box, new Request(`${BASE}?do=reset&do=xyz`, { method: "POST" }))).status).toBe(401);
    expect(box.entries()).toHaveLength(3);
  });
});

// ───────────────────────────── 같은 와이파이 http ─────────────────────────────

describe("SMS2 같은 와이파이 http 받는 곳 (AC-SMS2-17)", () => {
  it("확인 화면·지우기·303 상대 주소는 https와 같고, 경로 변형은 모두 404", async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    const server = createSmsTestHttpServer(box);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const at = (path: string) => `http://127.0.0.1:${port}${path}`;
      const r1 = await fetch(at(SMS_TEST_PATH), { method: "POST", headers: { "x-try-token": TOKEN }, body: JSON.stringify({ from: "010-1234-5678", body: "시험 1", device: "iPhone" }) });
      expect(r1.status).toBe(200);
      const ask = await fetch(at(`${SMS_TEST_PATH}?t=${TOKEN}&do=reset-ask`));
      expect(ask.status).toBe(200);
      const askHtml = await ask.text();
      expect(askHtml).not.toContain('http-equiv="refresh"');
      expect(visible(askHtml)).toContain("받은 시험 문자 1건을 지우고 처음부터 셀까요?");
      // 머리글 토큰만으로는 http에서도 지우지 않는다
      const headerOnly = await fetch(at(`${SMS_TEST_PATH}?do=reset`), { method: "POST", headers: { "x-try-token": TOKEN } });
      expect([400, 401]).toContain(headerOnly.status);
      expect(box.entries()).toHaveLength(1);
      // 폼이 보내는 모양(urlencoded 빈 본문)
      const reset = await fetch(at(`${SMS_TEST_PATH}?t=${TOKEN}&do=reset`), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "", redirect: "manual" });
      expect(reset.status).toBe(303);
      const location = reset.headers.get("location") ?? "";
      expect(new URL(location, at("/")).href).toBe(at(`${SMS_TEST_PATH}?t=${TOKEN}`));
      expect(box.entries()).toHaveLength(0);
      for (const path of [
        "/",
        `${SMS_TEST_PATH}/`,
        `${SMS_TEST_PATH}x`,
        "/_try/SMS-TEST",
        "/_try/sms%2Dtest",
        "/_try/chat",
        "/api/health",
        `//${SMS_TEST_PATH}`,
        `${SMS_TEST_PATH}/..%2F..%2Fapi`,
      ]) {
        const r = await fetch(at(path) + `?t=${TOKEN}`);
        expect(r.status, path).toBe(404);
      }
      const head = await fetch(at(`${SMS_TEST_PATH}?t=${TOKEN}`), { method: "HEAD" });
      expect(head.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ───────────────────────────── 화면 문장 ─────────────────────────────

describe("SMS2 화면 글 — 개발 용어 없음, 시각은 한국 시각 (AC-SMS2-16·18)", () => {
  it("무작위 받기 뒤에도 보이는 글에 개발 용어·영어 상태값이 없다 (받은 글 빼고)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.record({ body: fc.constantFrom(...BODIES), delay: fc.option(fc.integer({ min: -5000, max: 90_000 }), { nil: null }) }), { maxLength: 60 }), async (items) => {
        const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
        for (const item of items) await must(box, post({ body: item.body, device: "폰", receivedAt: item.delay === null ? undefined : SERVER_MS - item.delay }));
        for (const page of [await view(box), await view(box, "&do=reset-ask")]) {
          const shown = visible(page);
          for (const word of ["receivedAt", "serial", "duplicate", "seq", "null", "undefined", "NaN", "JSON", "Invalid Date", "true", "false"]) expect(shown).not.toContain(word);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("KST 자정 넘어가는 시각: 휴대폰 23:59:59, 서버 다음 날 00:00:02 → 3초, 날짜가 바뀐다", async () => {
    const serverAt = new Date("2026-10-26T15:00:02.000Z"); // 한국 10월 27일 00:00:02
    const box = createSmsTestBox({ token: TOKEN, now: () => serverAt });
    await must(box, post({ body: "시험 1", device: "iPhone", receivedAt: "2026-10-26T23:59:59" }));
    const shown = visible(await view(box));
    expect(shown).toContain("휴대폰이 받은 시각 10월 26일 23:59:59");
    expect(shown).toContain("서버가 받은 시각 10월 27일 00:00:02");
    expect(shown).toContain("늦은 정도 3초");
  });
});

describe("SMS2 http 받는 곳 — 길이 없는 큰 본문·중간에 끊긴 요청 (AC-SMS2-17·41)", () => {
  it("길이 머리글 없이 16KB 넘게 보내면 413, 중간에 끊겨도 서버는 계속 받고 로그를 남기지 않는다", async () => {
    const { request } = await import("node:http");
    const logs: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args) => logs.push(args));
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT });
    const server = createSmsTestHttpServer(box);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const chunked = (parts: string[], abort: boolean) =>
        new Promise<number | null>((resolve) => {
          const req = request({ host: "127.0.0.1", port, method: "POST", path: SMS_TEST_PATH, headers: { "x-try-token": TOKEN, "transfer-encoding": "chunked" } }, (res) => {
            res.resume();
            resolve(res.statusCode ?? null);
          });
          req.on("error", () => resolve(null));
          for (const p of parts) req.write(p);
          if (abort) {
            setTimeout(() => {
              req.destroy();
              resolve(null);
            }, 50);
          } else req.end();
        });
      const big = JSON.stringify({ body: "시험 1", device: "iPhone", from: "010-1234-5678", pad: "x".repeat(20_000) });
      expect(await chunked([big.slice(0, 8000), big.slice(8000)], false)).toBe(413);
      await chunked(['{"body":"시험 2","from":"010-1234-5678"'], true);
      expect(box.entries()).toHaveLength(0);
      const ok = await fetch(`http://127.0.0.1:${port}${SMS_TEST_PATH}`, { method: "POST", headers: { "x-try-token": TOKEN }, body: JSON.stringify({ body: "시험 3", device: "iPhone", from: "010-1234-5678" }) });
      expect(ok.status).toBe(200);
      const bad = await fetch(`http://127.0.0.1:${port}${SMS_TEST_PATH}`, { method: "POST", headers: { "x-try-token": TOKEN }, body: '{"body":"시험 4", "from":"010-1234-5678"' });
      expect(bad.status).toBe(400);
      expect(await bad.text()).not.toContain("5678");
      expect(box.entries().map((e) => e.serial)).toEqual([3]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(logs).toEqual([]);
  });
});
