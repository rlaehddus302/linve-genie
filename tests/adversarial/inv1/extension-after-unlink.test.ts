// INV1 적대 테스트 (test-domain): 초대 방송 회차에서 공식 잇기를 끊은 뒤에도 크롬 확장이 같은 영상(유튜버 B의 방송)을 계속 받는 경우
// (AC-INV1-10, D-PHN-21·D-X1-29, ORD-01 AC3). 방송 채널은 여전히 B다 — B의 주인 배지 글은 방송자 글이어야 하고,
// 감사는 확장에 맡기지 않으며 "방송 채널 계정으로 로그인해야 …" 안내도 나오면 안 된다.
import { listClaims } from "@livejjim/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  NO_LABEL,
  api,
  connect,
  rid,
  world,
  type World,
} from "../y1/helpers.ts";

let w: World | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

const OWNER_LOGIN = "방송 채널 계정으로 로그인해야";

async function invitedThenUnlinked() {
  w = await world();
  const current = w;
  const a = await connect(current, { publish: "LIVE_CHAT" });
  const client = api(current.server, a.seller.cookie);
  expect(
    (
      await client.patch("/api/settings", {
        settings: { ...NO_LABEL, "claim.ignoreOwner": true },
      })
    ).status,
  ).toBe(200);
  const b = (await client.post("/api/broadcasts", { requestId: rid("bc") }))
    .body.broadcast as { id: string; date: string };
  const channelB = current.fake.addChannel(
    current.fake.addAccount(),
    "다육이유튜버",
  );
  const live = current.fake.addBroadcast(channelB.id, { status: "live" });
  const linked = await client.post(`/api/broadcasts/${b.id}/youtube`, {
    requestId: rid("l"),
    video: live.videoId,
    confirmInvited: true,
  });
  expect(linked.status, linked.text).toBe(200);
  for (const [no, name] of [
    [15, "핑크프릴"],
    [16, "라울"],
  ] as const) {
    expect(
      (
        await client.post("/api/events", {
          requestId: rid("ev"),
          type: "product.register",
          b: b.id,
          no,
          name,
          price: 10000,
        })
      ).status,
    ).toBe(200);
  }
  const code = (await client.post("/api/extension/code", {})).body.code;
  const exchanged = await current.server.app.request("/ext/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const token = ((await exchanged.json()) as { token: string }).token;
  const ext = async (path: string, body: unknown) => {
    await current.timer.advance(250);
    const res = await current.server.app.request(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      text,
      body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
    };
  };
  expect(
    (
      await client.post("/api/extension/thanks", {
        enabled: true,
        agreed: true,
      })
    ).status,
  ).toBe(200);
  // 확장이 B의 방송 화면에서 채팅을 받기 시작한다 (이은 영상이라 자동으로 이 회차에 붙는다)
  const first = await ext("/ext/chats", {
    v: live.videoId,
    messages: [
      {
        id: "x0",
        ch: "UCviewer0000000000000009",
        nick: "시청자",
        text: "안녕하세요",
        at: current.timer.now(),
      },
    ],
  });
  expect(first.body).toMatchObject({ recorded: 1, broadcast: b.id });
  // 사장님이 공식 잇기만 끊는다 (확장은 같은 영상을 계속 받는다)
  expect(
    (
      await client.post(`/api/broadcasts/${b.id}/youtube/unlink`, {
        requestId: rid("u"),
      })
    ).status,
  ).toBe(200);
  return {
    w: current,
    a,
    b,
    channelB: channelB.id,
    videoId: live.videoId,
    ext,
    client,
  };
}

describe("AC-INV1-10 초대 방송 회차 — 공식 잇기를 끊은 뒤의 확장", () => {
  it('TD-INV1-009: 끊은 뒤에도 유튜버 B의 주인 배지 글 "16"은 방송자 글(찜 0)이어야 한다', async () => {
    const s = await invitedThenUnlinked();
    const sent = await s.ext("/ext/chats", {
      v: s.videoId,
      messages: [
        {
          id: "x1",
          ch: s.channelB,
          nick: "다육이유튜버",
          text: "16",
          at: s.w.timer.now(),
          owner: true,
        },
      ],
    });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body).toMatchObject({ ownerDenied: 0 });
    const state = (await s.w.server.writer.read(s.a.seller.sellerId, s.b.date))
      .state;
    expect(
      listClaims(state).filter((claim) => claim.buyer === s.channelB),
    ).toEqual([]);
  });

  it("TD-INV1-009: 끊은 뒤에도 초대 방송의 감사는 확장에 맡겨지지 않고 방송 채널 로그인 안내가 없다", async () => {
    const s = await invitedThenUnlinked();
    expect(
      (
        await s.ext("/ext/chats", {
          v: s.videoId,
          messages: [
            {
              id: "x2",
              ch: "UCviewer0000000000000008",
              nick: "가",
              text: "15",
              at: s.w.timer.now(),
            },
          ],
        })
      ).status,
    ).toBe(200);
    for (const [meIsOwner, owner] of [
      [false, s.channelB],
      [true, s.channelB],
      [true, s.a.channel.id],
    ] as const) {
      const taken = await s.ext("/ext/thanks/take", {
        v: s.videoId,
        meIsOwner,
        owner,
      });
      expect(taken.body.post ?? null).toBeNull();
      expect(taken.text).not.toContain(OWNER_LOGIN);
    }
    const view = await s.client.get("/api/extension");
    expect(view.text).not.toContain(OWNER_LOGIN);
  });
});
