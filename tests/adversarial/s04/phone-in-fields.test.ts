// S04 적대 테스트 (test-domain): 판매자가 적는 칸의 휴대폰 번호 — S04 마무리 기준 D-079(오케스트레이터)·D-080, R-1 "판매자가 적는 칸의 휴대폰 번호", AC-S04-07·22·27.
// D-079가 D-073의 번호 판단(숫자만 모으기)보다 우선한다. 이 파일의 기대는 모두 D-079 기준이다.
// - 글 칸(sms ref·memo, 입금 메모, 모든 사유, 방송 제목, 상품 이름): `containsPhoneRun` 하나 — 덩어리 기준. 숫자를 전부 모아 보는 판단은 쓰지 않는다.
//   → 날짜·금액이 섞인 글('01/05 구피 30종 1000원' 등, SA-S04-007)은 받는다. 실제 번호 표기는 거절(TD-S04-003 회귀).
// - ID 칸(buyer·from·into·replace·msg): `looksLikePhoneId` — 값 전체가 숫자·구분자이고 normalizePhone 결과가 있을 때만(TD-S04-004·SA-S04-006).
//   영문이 섞인 불투명 ID(base64url 무작위 80자, 'UC01012345678abcdEFGH_-')는 절대 걸리지 않는다.
// - chat의 id·ch·nick·text는 검사하지 않는다.
// - 검사는 기록 전(checkEvent)에만. applyEvent(재생)는 번호 검사로 입력 오류를 내지 않는다(D-079 ⑤, RA-S04-011).
// - 서버 거절 문장은 D-079 ⑥.
import * as core from "@livejjim/core";
import {
  applyEvent,
  checkEvent,
  initEngine,
  listBroadcasts,
  listProducts,
  normalizePhone,
  type EngineEvent,
  type EngineState,
} from "@livejjim/core";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import {
  call,
  dumpAll,
  event,
  harness,
  startBroadcast,
  type Harness,
} from "./helpers.ts";

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const DAY = "2026-10-18";
const NEXT = "2026-10-19";
const T0 = Date.UTC(2026, 9, 18, 11, 0, 0);
/** D-079 ⑥ 거절 안내 */
const PHONE_MESSAGE =
  "전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.";

/** AC-S04-07이 요구하는 코어 내보내기 (아직 없으면 그 테스트만 실패하도록 이름으로 찾는다) */
function coreFn(
  name: "containsPhoneRun" | "looksLikePhoneId",
): (value: string) => boolean {
  const fn = (core as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function")
    throw new Error(`@livejjim/core가 ${name}을 내보내지 않는다 (AC-S04-07)`);
  return fn as (value: string) => boolean;
}

// AC-S04-07의 예 그대로 + SA-S04-007 회귀
const TEXT_REJECT = [
  "010-1234-5678",
  "김영희 010 1234 5678",
  "01012345678",
  "3시,010,1234,5678",
  "010:1234:5678 3시",
  "3시 010ㅡ1234ㅡ5678",
  "010ㆍ1234ㆍ5678",
  "010-1234-5678 2개",
  "(010)1234.5678",
  "010 12345678",
  "０１０-１２３４-５６７８",
  "+82 010-1234-5678",
  "3시 010~1234~5678",
  "010 ㅡ 1234 ㅡ 5678 2개",
];
const REF_REJECT = ["01012345678", "s01012345678", "r-010-1234-5678-2"];
const TEXT_ACCEPT = [
  "01/05 3개 25,000원",
  "01/05 구피 30종 1000원",
  "01/05 100,000원 이상 무료",
  "1234-5678",
  "3시 15번 2개",
  "101동 1203호",
  "1,2,3번 각 1개",
  "김영희 이모",
  "010123456789",
  "+82 10-1234-5678",
  "10,000원 입금",
];
const REF_ACCEPT = ["1234567", "s1", "r-20261018-0001"];
const ID_REJECT = [
  "010-5151-6161",
  "01051516162",
  "010 5151 6163",
  "(010)5151-6164",
];
const ID_ACCEPT = [
  "UC_A",
  "sms:s1",
  "UC01012345678abcdEFGH_-",
  "m1",
  "1234-5678",
];

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("");
/** base64url 무작위 80자 (영문이 하나 이상 — 불투명 ID) */
const opaqueIdArb = fc
  .array(fc.constantFrom(...B64URL), { minLength: 80, maxLength: 80 })
  .map((chars) => chars.join(""))
  .filter((s) => /[A-Za-z]/.test(s));
/** 숫자가 많은 불투명 ID: '010…' 숫자열 사이사이에 영문이 낀 값 */
const digitHeavyIdArb = fc
  .tuple(
    fc.constantFrom(
      "010",
      "011",
      "016",
      "017",
      "018",
      "019",
      "UC010",
      "sms:010",
    ),
    fc.array(fc.constantFrom(..."0123456789-_".split("")), {
      minLength: 7,
      maxLength: 70,
    }),
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    ),
    fc.nat(80),
  )
  .map(([head, body, letter, at]) => {
    const s = head + body.join("");
    const i = at % (s.length + 1);
    return s.slice(0, i) + letter + s.slice(i);
  });

describe("AC-S04-07 / D-079: 코어 판단 함수", () => {
  it("containsPhoneRun — 번호 표기는 참, 날짜·금액이 섞인 글(SA-S04-007)과 번호 일부는 거짓", () => {
    const containsPhoneRun = coreFn("containsPhoneRun");
    for (const text of [...TEXT_REJECT, ...REF_REJECT])
      expect(containsPhoneRun(text), text).toBe(true);
    for (const text of [...TEXT_ACCEPT, ...REF_ACCEPT])
      expect(containsPhoneRun(text), text).toBe(false);
  });

  it("containsPhoneNumber를 남겼다면 containsPhoneRun과 같은 판단이다 (숫자 모으기 판단 금지)", () => {
    const legacy = (core as unknown as Record<string, unknown>)
      .containsPhoneNumber;
    if (legacy === undefined) return;
    const containsPhoneRun = coreFn("containsPhoneRun");
    for (const text of [
      ...TEXT_REJECT,
      ...REF_REJECT,
      ...TEXT_ACCEPT,
      ...REF_ACCEPT,
    ]) {
      expect((legacy as (t: string) => boolean)(text), text).toBe(
        containsPhoneRun(text),
      );
    }
  });

  it("looksLikePhoneId — 숫자·구분자로만 된 번호 모양 ID만 참", () => {
    const looksLikePhoneId = coreFn("looksLikePhoneId");
    for (const value of ID_REJECT)
      expect(looksLikePhoneId(value), value).toBe(true);
    for (const value of ID_ACCEPT)
      expect(looksLikePhoneId(value), value).toBe(false);
  });

  it("회귀: 불투명 ID(base64url 무작위 80자, 숫자가 많은 영문 섞인 ID)는 looksLikePhoneId에 절대 걸리지 않는다", () => {
    const looksLikePhoneId = coreFn("looksLikePhoneId");
    fc.assert(
      fc.property(opaqueIdArb, (value) => {
        expect(looksLikePhoneId(value), value).toBe(false);
      }),
      { numRuns: 500, seed: 20261019 },
    );
    fc.assert(
      fc.property(digitHeavyIdArb, (value) => {
        expect(looksLikePhoneId(value), value).toBe(false);
      }),
      { numRuns: 500, seed: 20261019 },
    );
  });

  it("looksLikePhoneId가 참이면 normalizePhone 결과가 있다 (번호로 정규화되지 않는 값은 걸지 않는다)", () => {
    const looksLikePhoneId = coreFn("looksLikePhoneId");
    for (const value of [
      "1234-5678",
      "010-1234",
      "0101234567890",
      "02-123-4567",
      "+82 10-1234-5678",
      "5151 6161",
    ]) {
      expect(normalizePhone(value), value).toBeNull();
      expect(looksLikePhoneId(value), value).toBe(false);
    }
  });
});

// ---- 엔진: checkEvent(기록 전)와 applyEvent(재생) ----

function ev(seq: number, fields: Record<string, unknown>): EngineEvent {
  return { ...fields, seq, at: T0 + seq * 1000 } as unknown as EngineEvent;
}

/** 방송 b1·상품 1·채팅 m1(UC1, 구매자 UC1이 생긴다) */
function baseState(): EngineState {
  let state = initEngine({ broadcasts: [], settings: {} });
  const setup: Record<string, unknown>[] = [
    { type: "broadcast.start", b: "b1", date: DAY, title: "1부" },
    { type: "product.register", b: "b1", no: 1, name: "구피", price: 1000 },
    { type: "chat", b: "b1", id: "m1", ch: "UC1", nick: "하나", text: "1" },
  ];
  setup.forEach((fields, i) => {
    state = applyEvent(state, ev(i + 1, fields)).state;
  });
  return state;
}

/** 글 칸마다 이벤트를 만든다 (나머지 필드는 맞는 값) */
const TEXT_FIELD_EVENTS: {
  field: string;
  make: (value: string) => Record<string, unknown>;
  ref?: true;
}[] = [
  {
    field: "title",
    make: (v) => ({ type: "broadcast.start", b: "b2", date: DAY, title: v }),
  },
  {
    field: "name",
    make: (v) => ({
      type: "product.register",
      b: "b1",
      no: 2,
      name: v,
      price: 1000,
    }),
  },
  {
    field: "name",
    make: (v) => ({ type: "product.update", b: "b1", no: 1, name: v }),
  },
  {
    field: "memo",
    make: (v) => ({
      type: "sms",
      b: "b1",
      ref: "r1",
      no: 1,
      received: "20:00",
      memo: v,
    }),
  },
  {
    field: "memo",
    make: (v) => ({
      type: "settlement.payment",
      buyer: "UC1",
      date: DAY,
      amount: 1000,
      memo: v,
    }),
  },
  {
    field: "reason",
    make: (v) => ({
      type: "host.cancel",
      b: "b1",
      no: 1,
      buyer: "UC1",
      reason: v,
    }),
  },
  {
    field: "reason",
    make: (v) => ({ type: "host.reopen", b: "b1", no: 1, reason: v }),
  },
  {
    field: "reason",
    make: (v) => ({ type: "host.blockBuyer", buyer: "UC1", reason: v }),
  },
  {
    field: "reason",
    make: (v) => ({
      type: "settlement.refund",
      buyer: "UC1",
      date: DAY,
      amount: 1000,
      reason: v,
    }),
  },
  {
    field: "reason",
    make: (v) => ({
      type: "settlement.adjust",
      buyer: "UC1",
      date: DAY,
      amount: -500,
      reason: v,
    }),
  },
];
const SMS_REF_EVENT = (v: string): Record<string, unknown> => ({
  type: "sms",
  b: "b1",
  ref: v,
  no: 1,
  received: "20:00",
});

/** ID 칸마다 이벤트를 만든다 */
const ID_FIELD_EVENTS: {
  field: string;
  make: (value: string) => Record<string, unknown>;
}[] = [
  {
    field: "buyer",
    make: (v) => ({ type: "host.blockBuyer", buyer: v, reason: "노쇼" }),
  },
  {
    field: "buyer",
    make: (v) => ({
      type: "host.cancel",
      b: "b1",
      no: 1,
      buyer: v,
      reason: "요청",
    }),
  },
  {
    field: "buyer",
    make: (v) => ({
      type: "host.assign",
      b: "b1",
      no: 1,
      buyer: v,
      reason: "전화 주문",
    }),
  },
  {
    field: "buyer",
    make: (v) => ({
      type: "sms",
      b: "b1",
      ref: "r9",
      no: 1,
      received: "20:00",
      buyer: v,
    }),
  },
  {
    field: "buyer",
    make: (v) => ({
      type: "settlement.payment",
      buyer: v,
      date: DAY,
      amount: 1000,
    }),
  },
  {
    field: "buyer",
    make: (v) => ({
      type: "settlement.shippingOverride",
      buyer: v,
      date: DAY,
      mode: "PICKUP",
    }),
  },
  {
    field: "from",
    make: (v) => ({
      type: "buyer.merge",
      from: v,
      into: "UC1",
      reason: "같은 사람",
    }),
  },
  {
    field: "into",
    make: (v) => ({
      type: "buyer.merge",
      from: "UC1",
      into: v,
      reason: "같은 사람",
    }),
  },
  {
    field: "from",
    make: (v) => ({ type: "buyer.unmerge", from: v, reason: "잘못 합침" }),
  },
  {
    field: "replace",
    make: (v) => ({
      type: "host.assign",
      b: "b1",
      no: 1,
      buyer: "UC1",
      replace: v,
      replaceTo: "WAITLIST",
      reason: "전화 주문",
    }),
  },
  {
    field: "msg",
    make: (v) => ({ type: "host.convertMessage", b: "b1", msg: v, no: 1 }),
  },
];

describe("AC-S04-07 / D-079: checkEvent는 기록 전에 글 칸·ID 칸의 번호를 거절한다", () => {
  it("글 칸의 번호 표기 → 그 필드 이름의 입력 오류", () => {
    const state = baseState();
    for (const { field, make } of TEXT_FIELD_EVENTS) {
      for (const value of TEXT_REJECT) {
        const fields = make(value);
        expect(
          checkEvent(state, ev(10, fields)).map((p) => p.field),
          JSON.stringify(fields),
        ).toContain(field);
      }
    }
    for (const value of REF_REJECT)
      expect(
        checkEvent(state, ev(10, SMS_REF_EVENT(value))).map((p) => p.field),
        value,
      ).toContain("ref");
  });

  it("회귀(SA-S04-007): 날짜·금액이 섞인 글·번호 일부는 어느 글 칸에서도 받는다", () => {
    const state = baseState();
    for (const { make } of TEXT_FIELD_EVENTS) {
      for (const value of TEXT_ACCEPT) {
        const fields = make(value);
        expect(
          checkEvent(state, ev(10, fields)),
          JSON.stringify(fields),
        ).toEqual([]);
      }
    }
    for (const value of REF_ACCEPT)
      expect(checkEvent(state, ev(10, SMS_REF_EVENT(value))), value).toEqual(
        [],
      );
  });

  it("회귀: '01/05 구피 30종 1000원' 방송 제목으로 방송이 시작된다", () => {
    const state = baseState();
    const fields = {
      type: "broadcast.start",
      b: "b2",
      date: DAY,
      title: "01/05 구피 30종 1000원",
    };
    expect(checkEvent(state, ev(10, fields))).toEqual([]);
    const next = applyEvent(state, ev(10, fields)).state;
    expect(listBroadcasts(next).map((b) => [b.id, b.title])).toContainEqual([
      "b2",
      "01/05 구피 30종 1000원",
    ]);
  });

  it("ID 칸의 숫자·구분자로만 된 번호 → 그 필드 이름의 입력 오류 (TD-S04-004)", () => {
    const state = baseState();
    for (const { field, make } of ID_FIELD_EVENTS) {
      for (const value of ID_REJECT) {
        const fields = make(value);
        expect(
          checkEvent(state, ev(10, fields)).map((p) => p.field),
          JSON.stringify(fields),
        ).toContain(field);
      }
    }
  });

  it("회귀: 영문이 섞인 불투명 ID(base64url 무작위 80자 포함)는 어느 ID 칸에서도 번호로 거절되지 않는다", () => {
    const state = baseState();
    const samples = [
      ...ID_ACCEPT.filter((v) => v !== "sms:s1"),
      ...fc.sample(opaqueIdArb, { numRuns: 20, seed: 7 }),
      ...fc.sample(digitHeavyIdArb, { numRuns: 20, seed: 7 }),
    ];
    for (const { make } of ID_FIELD_EVENTS) {
      for (const value of samples) {
        const fields = make(value);
        expect(
          checkEvent(state, ev(10, fields)),
          JSON.stringify(fields),
        ).toEqual([]);
      }
    }
  });

  it("chat의 id·ch·nick·text는 번호가 있어도 검사하지 않는다", () => {
    const state = baseState();
    const fields = {
      type: "chat",
      b: "b1",
      id: "010-1234-5678",
      ch: "01012345678",
      nick: "010 1234 5678",
      text: "1번 010-1234-5678로 연락 주세요",
    };
    expect(checkEvent(state, ev(10, fields))).toEqual([]);
  });
});

describe("D-079 ⑤: 재생(applyEvent)에서는 글 칸·ID 칸 번호를 다시 검사하지 않는다", () => {
  it("글 칸에 번호가 있는 기록된 이벤트를 applyEvent에 넣어도 입력 오류 없이 처리된다", () => {
    const state = baseState();
    for (const { make } of TEXT_FIELD_EVENTS) {
      for (const value of [
        "010-1234-5678",
        "3시,010,1234,5678",
        "김영희 010 1234 5678",
      ]) {
        const fields = make(value);
        expect(
          () => applyEvent(state, ev(10, fields)),
          JSON.stringify(fields),
        ).not.toThrow();
      }
    }
    for (const value of REF_REJECT)
      expect(
        () => applyEvent(state, ev(10, SMS_REF_EVENT(value))),
        value,
      ).not.toThrow();
  });

  it("ID 칸에 번호가 있는 기록된 이벤트를 applyEvent에 넣어도 입력 오류 없이 처리된다", () => {
    const state = baseState();
    for (const { make } of ID_FIELD_EVENTS) {
      for (const value of ID_REJECT) {
        const fields = make(value);
        expect(
          () => applyEvent(state, ev(10, fields)),
          JSON.stringify(fields),
        ).not.toThrow();
      }
    }
  });

  it("재생된 이벤트는 평소대로 반영된다 (방송 제목·상품 이름이 빠지지 않는다)", () => {
    let state = baseState();
    state = applyEvent(
      state,
      ev(10, {
        type: "broadcast.start",
        b: "b2",
        date: DAY,
        title: "김영희 010-3131-4141 특집",
      }),
    ).state;
    state = applyEvent(
      state,
      ev(11, {
        type: "product.register",
        b: "b1",
        no: 2,
        name: "구피 010-3131-4142",
        price: 2000,
      }),
    ).state;
    expect(listBroadcasts(state).map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(
      listProducts(state).find((p) => p.broadcast === "b1" && p.no === 2)
        ?.price,
    ).toBe(2000);
  });

  it("번호 검사 밖의 입력 오류는 checkEvent와 applyEvent가 같다", () => {
    const state = baseState();
    const fields = {
      type: "product.register",
      b: "b1",
      no: 3,
      name: "010-1234-5678",
      price: -1,
    };
    const problems = checkEvent(state, ev(10, fields));
    expect(problems.map((p) => p.field)).toContain("price");
    expect(() => applyEvent(state, ev(10, fields))).toThrow();
  });
});

// ---- 서버 ----

describe("TD-S04-003 회귀: 판매자 글 칸의 휴대폰 번호는 거절되고 DB에 남지 않는다", () => {
  it("입금 메모·환불 사유·취소 사유·방송 제목·상품 이름의 번호 → 400(필드 이름과 D-079 ⑥ 문장), 기록 없음", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    const title = await call(s, a.cookie, "POST", "/api/broadcasts", {
      requestId: "bt-1",
      date: DAY,
      title: "김영희 010-3131-4141 특집",
    });
    expect(title.status).toBe(400);
    expect(title.body).toMatchObject({
      error: { problems: [{ field: "title", message: PHONE_MESSAGE }] },
    });
    const b = await startBroadcast(s, a.cookie, DAY);
    await event(s, a.cookie, {
      type: "product.register",
      b,
      no: 1,
      name: "구피",
      price: 1000,
    });
    await s.ingestChat(a.sellerId, {
      b,
      id: "m1",
      ch: "UC1",
      nick: "하나",
      text: "1",
    });
    const cases: [Record<string, unknown>, string, string | undefined][] = [
      [
        {
          type: "product.register",
          b,
          no: 2,
          name: "구피 010-3131-4142",
          price: 1000,
        },
        "name",
        undefined,
      ],
      [
        { type: "product.update", b, no: 1, name: "3시 010ㅡ3131ㅡ4143" },
        "name",
        undefined,
      ],
      [
        {
          type: "host.cancel",
          b,
          no: 1,
          buyer: "UC1",
          reason: "010 3131 4144 요청",
        },
        "reason",
        undefined,
      ],
      [
        {
          type: "settlement.payment",
          buyer: "UC1",
          date: DAY,
          amount: 1000,
          memo: "김영희 010~3131~4145 2개",
        },
        "memo",
        DAY,
      ],
      [
        {
          type: "settlement.refund",
          buyer: "UC1",
          date: DAY,
          amount: 1000,
          reason: "환불 010-3131-4146",
        },
        "reason",
        DAY,
      ],
    ];
    for (const [body, field, date] of cases) {
      const res = await event(s, a.cookie, body, date);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const problems = (
        res.body.error as { problems: { field: string; message: string }[] }
      ).problems;
      expect(problems[0]?.field).toBe(field);
      expect(problems[0]?.message).toBe(PHONE_MESSAGE);
    }
    const dump = await dumpAll(h.database);
    for (const needle of [
      "3131-414",
      "3131414",
      "3131ㅡ414",
      "3131~414",
      "3131 414",
    ])
      expect(dump, needle).not.toContain(needle);
  }, 60_000);
});

describe("SA-S04-007 회귀: 번호가 아닌 숫자가 든 글은 서버가 받는다", () => {
  it("'01/05 구피 30종 1000원' 방송 제목, 날짜·금액이 섞인 상품 이름·입금 메모·사유 → 200", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    const titled = await call(s, a.cookie, "POST", "/api/broadcasts", {
      requestId: "bt-ok",
      date: DAY,
      title: "01/05 구피 30종 1000원",
    });
    expect(titled.status, titled.text).toBe(200);
    const b = (titled.body.broadcast as { id: string }).id;
    const ok: [Record<string, unknown>, string | undefined][] = [
      [
        {
          type: "product.register",
          b,
          no: 1,
          name: "01/05 3개 25,000원",
          price: 25000,
        },
        undefined,
      ],
      [
        { type: "product.update", b, no: 1, name: "01/05 100,000원 이상 무료" },
        undefined,
      ],
      [
        {
          type: "settlement.payment",
          buyer: "UC1",
          date: DAY,
          amount: 1000,
          memo: "01/05 100,000원 이상 무료",
        },
        DAY,
      ],
      [
        {
          type: "settlement.adjust",
          buyer: "UC1",
          date: DAY,
          amount: -1000,
          reason: "01/05 구피 30종 1000원 할인",
        },
        DAY,
      ],
      [
        {
          type: "host.blockBuyer",
          buyer: "UC_A",
          reason: "1234-5678 뒷번호 노쇼",
        },
        DAY,
      ],
    ];
    for (const [body, date] of ok) {
      const res = await event(s, a.cookie, body, date);
      expect(res.status, `${JSON.stringify(body)} → ${res.text}`).toBe(200);
    }
  }, 60_000);
});

describe("TD-S04-004: 구매자·메시지 ID 칸의 휴대폰 번호(숫자·구분자로만 된 값)는 기록 전에 거절된다", () => {
  it("ID 칸에 번호를 넣은 요청은 400(그 필드 이름과 D-079 ⑥ 문장), DB 어디에도 번호가 없다", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    const b = await startBroadcast(s, a.cookie, DAY);
    await event(s, a.cookie, {
      type: "product.register",
      b,
      no: 1,
      name: "구피",
      price: 1000,
    });
    await s.ingestChat(a.sellerId, {
      b,
      id: "m1",
      ch: "UC1",
      nick: "하나",
      text: "1",
    });
    const cases: [Record<string, unknown>, string, string | undefined][] = [
      // 판매자가 "이 번호 차단"을 하려고 번호를 적은 경우 — 예전엔 미리 차단(모르는 구매자)으로 기록됐다
      [
        { type: "host.blockBuyer", buyer: "010-5151-6161", reason: "노쇼" },
        "buyer",
        DAY,
      ],
      // 입금자를 번호로 적은 경우 — 예전엔 맞지 않는 명령(changed=false)으로 기록됐다
      [
        {
          type: "settlement.payment",
          buyer: "01051516162",
          date: DAY,
          amount: 1000,
        },
        "buyer",
        DAY,
      ],
      [
        {
          type: "buyer.merge",
          from: "010 5151 6163",
          into: "UC1",
          reason: "같은 사람",
        },
        "from",
        DAY,
      ],
      [
        {
          type: "host.assign",
          b,
          no: 1,
          buyer: "(010)5151-6164",
          reason: "전화 주문",
        },
        "buyer",
        undefined,
      ],
      [
        { type: "host.convertMessage", b, msg: "010-5151-6165", no: 1 },
        "msg",
        undefined,
      ],
    ];
    const wrong: string[] = [];
    for (const [body, field, date] of cases) {
      const res = await event(s, a.cookie, body, date);
      const problems =
        (
          res.body.error as
            { problems?: { field: string; message: string }[] } | undefined
        )?.problems ?? [];
      if (
        res.status !== 400 ||
        problems[0]?.field !== field ||
        problems[0]?.message !== PHONE_MESSAGE
      )
        wrong.push(`${String(body.type)} → ${String(res.status)} ${res.text}`);
    }
    const dump = await dumpAll(h.database);
    const leaked = ["5151-616", "5151616", "5151 616"].filter((needle) =>
      dump.includes(needle),
    );
    expect({ wrong, leaked }).toEqual({ wrong: [], leaked: [] });
  }, 60_000);

  it("회귀: 영문이 섞인 불투명 ID(base64url 무작위 80자·UC01012345678abcdEFGH_-)는 ID 칸에서 받는다", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    await startBroadcast(s, a.cookie, DAY);
    const ids = [
      "UC01012345678abcdEFGH_-",
      ...fc.sample(opaqueIdArb, { numRuns: 3, seed: 11 }),
    ];
    for (const buyer of ids) {
      const blocked = await event(
        s,
        a.cookie,
        { type: "host.blockBuyer", buyer, reason: "노쇼" },
        DAY,
      );
      expect(blocked.status, `${buyer} → ${blocked.text}`).toBe(200);
      const paid = await event(
        s,
        a.cookie,
        { type: "settlement.payment", buyer, date: DAY, amount: 1000 },
        DAY,
      );
      expect(paid.status, `${buyer} → ${paid.text}`).toBe(200);
    }
  }, 60_000);

  it("번호로 미리 차단하려던 요청은 기록되지 않으므로 다음 날짜 범위로도 이어지지 않는다 (AC-S04-27)", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    await startBroadcast(s, a.cookie, DAY);
    await event(
      s,
      a.cookie,
      { type: "host.blockBuyer", buyer: "010-7171-8181", reason: "노쇼" },
      DAY,
    );
    await startBroadcast(s, a.cookie, NEXT);
    const next = await call(s, a.cookie, "GET", `/api/days/${NEXT}`);
    expect(next.status).toBe(200);
    expect(next.text).not.toContain("7171-8181");
    const pglite = h.database.pglite;
    if (pglite === null) throw new Error("PGlite가 아니다");
    const rows = (
      await pglite.query<{ seq: number; actor: string }>(
        "select seq, actor from events where body like '%7171-8181%' order by id",
      )
    ).rows;
    expect(rows.map((r) => `${r.actor}#${String(r.seq)}`)).toEqual([]);
  }, 60_000);

  it("D-079 전 로그에 번호 모양 ID로 남은 차단은 서버가 새 날짜 범위에 이어 기록하지 않는다 (AC-S04-27)", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    await startBroadcast(s, a.cookie, DAY);
    await event(
      s,
      a.cookie,
      { type: "host.blockBuyer", buyer: "UCtmpblock", reason: "노쇼" },
      DAY,
    );
    const pglite = h.database.pglite;
    if (pglite === null) throw new Error("PGlite가 아니다");
    // 예전 규칙으로 기록된 로그를 흉내 낸다: 차단 대상 ID를 번호 모양으로 바꾸고 스냅샷을 지운다
    await pglite.query(
      "update events set body = replace(body, '\"UCtmpblock\"', '\"010-9191-2828\"') where body like '%UCtmpblock%'",
    );
    await pglite.query("delete from snapshots");
    const s2 = h.restart();
    await startBroadcast(s2, a.cookie, NEXT);
    const rows = (
      await pglite.query<{ seq: number; body: string }>(
        "select e.seq, e.body from events e join scopes c on c.id = e.scope_id where c.date = $1 order by e.seq",
        [NEXT],
      )
    ).rows;
    expect(
      rows.filter((r) => r.body.includes("9191")).map((r) => r.seq),
    ).toEqual([]);
  }, 60_000);
});

describe("D-079 ⑤ 서버: 예전 규칙으로 기록된 글 칸 번호는 재생 때 건너뛰지 않는다", () => {
  it("기록된 방송 제목·상품 이름에 번호가 있어도 새 인스턴스가 다시 불러올 때 REPLAY_SKIPPED가 없다", async () => {
    h = await harness();
    const a = await h.account("shopa");
    const s = h.server;
    const b = await startBroadcast(s, a.cookie, DAY, "구피 특집");
    await event(s, a.cookie, {
      type: "product.register",
      b,
      no: 1,
      name: "구피",
      price: 1000,
    });
    await event(s, a.cookie, {
      type: "product.register",
      b,
      no: 2,
      name: "베타",
      price: 2000,
    });
    const pglite = h.database.pglite;
    if (pglite === null) throw new Error("PGlite가 아니다");
    // 규칙이 바뀌기 전에 기록된 로그를 흉내 낸다 (지금 checkEvent라면 거절할 글)
    await pglite.query(
      "update events set body = replace(body, '\"구피 특집\"', '\"김영희 010-3131-4141 특집\"') where body like '%구피 특집%'",
    );
    await pglite.query(
      "update events set body = replace(body, '\"구피\"', '\"구피 010-3131-4142\"') where type = 'product.register'",
    );
    await pglite.query("delete from snapshots");
    const before = h.logs.length;
    const s2 = h.restart();
    const day = await call(s2, a.cookie, "GET", `/api/days/${DAY}`);
    expect(day.status).toBe(200);
    const skipped = h.logs
      .slice(before)
      .filter((r) => (r as { code?: string }).code === "REPLAY_SKIPPED");
    expect(skipped).toEqual([]);
    expect(day.text).not.toContain("다시 불러올 때 처리하지 못해 건너뛴 입력");
    expect(day.body.attention ?? []).toEqual([]);
  }, 60_000);
});
