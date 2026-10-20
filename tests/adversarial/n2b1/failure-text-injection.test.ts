// N2b-1 적대 테스트 (test-domain): 틱톡이 돌려준 사용자 자료가 실패 종류를 바꾸는가 (AC-N2b-1-33·35, D-N2b-1-05).
//
// TD-N2b-1-004 — 방송자 프로필 글(닉네임·소개)에 '19881007'이나 'user not found'가 있으면 다시 시도하지 않는 USER_NOT_FOUND가 된다.
//   tiktok-live-connector 2.1.0 fetch-room-info-api-live.js는 방 ID가 없는 응답(방송 중이 아니라 방 ID가 비어 있는 사용자)에
//     throw new InvalidResponseError(`Invalid response from API: ${JSON.stringify(roomData)}`)
//   를 던진다 — 메시지에 틱톡 응답 전체(data.user의 nickname·signature 등 사용자가 쓴 글)가 들어간다.
//   방 ID를 찾는 세 경로가 모두 실패하면 FetchIsLiveError(errors=[HTML 오류, 이 InvalidResponseError, Euler 오류])가 된다.
//   classifyWebcastFailure는 InvalidResponseError 메시지 **어디에든** /\b19881007\b|user[_ ]not[_ ]found/i가 있으면 USER_NOT_FOUND로 본다.
//   그래서 소개 글이 "since 19881007"인 판매자가 방송을 켜기 전에 연결하면(흔한 순서) 틱톡 API의 진짜 없는 사용자 응답
//   `API Error 19881007 (user_not_found)`가 아닌데도 STOPPED/USER_NOT_FOUND("그런 틱톡 아이디를 찾지 못했어요")로 멈추고 다시 시도하지 않는다.
//   판매자가 방송을 켜도 이어지지 않아 "다시 연결"을 누를 때까지 찜 댓글을 모두 놓친다(아이디가 틀렸다는 틀린 안내까지).
//   기대: 사용자 자료가 섞인 'Invalid response from API: …' 메시지는 USER_NOT_FOUND 근거가 아니다 → 그 밖(NETWORK), 다시 시도.
//   (진짜 없는 사용자 `API Error 19881007 (user_not_found)`는 그대로 USER_NOT_FOUND여야 한다 — 회귀 확인을 같이 둔다.)
import { describe, expect, it } from "vitest";
import {
  checkTikTokTarget,
  classifyWebcastFailure,
  createTikTokConnection,
  FakeTikTokClock,
  flushTikTokTasks,
  libraryWebcast,
  readTikTokSettings,
  type LibraryConnectionConstructor,
  type LibraryConnectionLike,
} from "../../../apps/server/src/tiktok/index.ts";

/** 라이브러리 2.1.0 types/errors.js와 같은 이름·칸 (분류기는 생성자 이름 사슬로 본다) */
class InvalidResponseError extends Error {
  requestErr: unknown;
  constructor(message: string, requestErr: unknown = undefined) {
    super(message);
    this.requestErr = requestErr;
    this.name = "InvalidResponseError";
  }
}
class FetchIsLiveError extends Error {
  errors: unknown[];
  constructor(errors: unknown[]) {
    super();
    this.errors = errors;
  }
}

/** fetch-room-info-api-live.js의 방 ID 없는 응답 오류 — 응답 JSON 전체가 메시지에 들어간다 */
function apiNoRoom(user: Record<string, unknown>): InvalidResponseError {
  const roomData = {
    data: {
      user: {
        id: "7000000000000000001",
        uniqueId: "seller_kim",
        roomId: "",
        ...user,
      },
      liveRoom: { status: 4 },
    },
    extra: {},
    message: "",
    statusCode: 0,
  };
  return new InvalidResponseError(
    `Invalid response from API: ${JSON.stringify(roomData)}`,
    undefined,
  );
}

/** 방 ID를 찾는 세 경로가 모두 실패한 끝의 오류 (client.js fetchRoomId) */
function allSourcesFailed(api: InvalidResponseError): FetchIsLiveError {
  return new FetchIsLiveError([
    new Error("Failed to extract Room ID from HTML."),
    api,
    new Error("Failed to extract Room ID from Euler."),
  ]);
}

describe("TD-N2b-1-004: 방송자가 쓴 프로필 글이 USER_NOT_FOUND(다시 시도 없음)를 만든다 (AC-N2b-1-33·35)", () => {
  it.each([
    [
      "소개 글에 생일 19881007",
      { nickname: "김사장 다육", signature: "다육 판매 since 19881007" },
    ],
    ["닉네임에 19881007", { nickname: "다육이19881007", signature: "" }],
    ["닉네임에 user not found", { nickname: "User Not Found", signature: "" }],
    [
      "소개 글에 user_not_found",
      { nickname: "김사장", signature: "error user_not_found lol" },
    ],
  ])(
    "%s → 방 ID 없는 API 응답 오류는 USER_NOT_FOUND가 아니다",
    (_label, user) => {
      expect(
        classifyWebcastFailure(allSourcesFailed(apiNoRoom(user))),
      ).not.toBe("USER_NOT_FOUND");
      expect(classifyWebcastFailure(apiNoRoom(user))).not.toBe(
        "USER_NOT_FOUND",
      );
    },
  );

  it("회귀: 프로필 글에 그런 글이 없으면 NETWORK", () => {
    expect(
      classifyWebcastFailure(
        allSourcesFailed(
          apiNoRoom({ nickname: "김사장", signature: "다육 판매" }),
        ),
      ),
    ).toBe("NETWORK");
  });

  it("회귀: 틱톡 API의 진짜 없는 사용자 응답은 USER_NOT_FOUND", () => {
    const notFound = new InvalidResponseError(
      "API Error 19881007 (user_not_found)",
      undefined,
    );
    expect(classifyWebcastFailure(notFound)).toBe("USER_NOT_FOUND");
    expect(
      classifyWebcastFailure(
        new FetchIsLiveError([
          new Error(
            "Failed to extract the SIGI_STATE HTML tag, you might be blocked by TikTok.",
          ),
          notFound,
        ]),
      ),
    ).toBe("USER_NOT_FOUND");
  });
});

// ── 라운드 2 회귀: 고친 뒤(응답 본문 메시지는 문구를 보지 않음)에도 본문에 심은 '정답 모양'·차단 문구가 통하지 않는가 ──
// 방송자가 소개 글에 라이브러리가 만드는 메시지 모양 자체를 적어 넣는 경우까지 본다. 본문 메시지는 맨 앞이 'Invalid response from API:'이므로
// 맨 앞 고정 검사(API Error 19881007 ()와 차단 문구 검사 어디에도 걸리면 안 된다 → 그 밖(NETWORK), 다시 시도.
describe("TD-N2b-1-004 회귀(라운드 2): 본문에 심은 정답 모양·차단 문구", () => {
  it.each([
    ["소개 글이 없는 사용자 메시지 그대로", { signature: "API Error 19881007 (user_not_found)" }],
    ["닉네임이 없는 사용자 메시지 그대로", { nickname: "API Error 19881007 (" }],
    ["소개 글에 captcha", { signature: "captcha 풀어야 들어와요" }],
    ["소개 글에 blocked by TikTok", { signature: "I was blocked by TikTok once" }],
    ["소개 글에 웹소켓 거부 문구", { signature: "Unexpected server response: 403" }],
  ])("%s → NETWORK (USER_NOT_FOUND·BLOCKED 아님)", (_label, user) => {
    expect(classifyWebcastFailure(apiNoRoom(user))).toBe("NETWORK");
    expect(classifyWebcastFailure(allSourcesFailed(apiNoRoom(user)))).toBe("NETWORK");
  });

  it("실제 감싸개 경로: 소개 글에 없는 사용자 메시지를 적은 방송 전 판매자 → RETRYING/NETWORK, 5초 뒤 다시 시도", async () => {
    let attempts = 0;
    class NoRoomYet implements LibraryConnectionLike {
      connect(): Promise<unknown> {
        attempts += 1;
        return Promise.reject(allSourcesFailed(apiNoRoom({ signature: "since 19881007 · API Error 19881007 (user_not_found)" })));
      }
      disconnect(): void {}
      on(): unknown {
        return undefined;
      }
    }
    const checked = checkTikTokTarget("@seller_kim");
    if (!checked.ok) throw new Error("준비");
    const clock = new FakeTikTokClock(0);
    const conn = createTikTokConnection({
      sellerId: "seller-1",
      target: checked.target,
      webcast: libraryWebcast({ Connection: NoRoomYet as unknown as LibraryConnectionConstructor }),
      onRecord: () => undefined,
      settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: "on" }),
      consent: async () => true,
      clock,
      log: () => undefined,
    });
    conn.start();
    await flushTikTokTasks();
    expect({ state: conn.status().state, reason: conn.status().reason }).toEqual({ state: "RETRYING", reason: "NETWORK" });
    clock.advance(5_000);
    await flushTikTokTasks();
    expect(attempts).toBe(2);
    conn.stop();
  });

  it("실제 감싸개 경로 회귀: 진짜 없는 사용자는 STOPPED/USER_NOT_FOUND이고 1시간 동안 다시 시도 없음", async () => {
    let attempts = 0;
    class Missing implements LibraryConnectionLike {
      connect(): Promise<unknown> {
        attempts += 1;
        return Promise.reject(
          new FetchIsLiveError([
            new Error("Failed to extract the SIGI_STATE HTML tag, you might be blocked by TikTok."),
            new InvalidResponseError("API Error 19881007 (user_not_found)", undefined),
            new Error("Failed to extract Room ID from Euler."),
          ]),
        );
      }
      disconnect(): void {}
      on(): unknown {
        return undefined;
      }
    }
    const checked = checkTikTokTarget("@no_such_seller");
    if (!checked.ok) throw new Error("준비");
    const clock = new FakeTikTokClock(0);
    const conn = createTikTokConnection({
      sellerId: "seller-1",
      target: checked.target,
      webcast: libraryWebcast({ Connection: Missing as unknown as LibraryConnectionConstructor }),
      onRecord: () => undefined,
      settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: "on" }),
      consent: async () => true,
      clock,
      log: () => undefined,
    });
    conn.start();
    await flushTikTokTasks();
    expect({ state: conn.status().state, reason: conn.status().reason }).toEqual({ state: "STOPPED", reason: "USER_NOT_FOUND" });
    clock.advance(3_600_000);
    await flushTikTokTasks();
    expect(attempts).toBe(1);
  });
});
