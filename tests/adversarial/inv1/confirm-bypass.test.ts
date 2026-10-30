// INV1 적대 테스트 (test-domain): 남의 채널 방송 잇기 확인 우회 (AC-INV1-11, YT-02, D-PHN-17·D-INV1-02).
// 확인 표시는 정확히 JSON true만이다. 다른 모양·다른 칸·섞인 영상 주소·요청 번호 재사용·다른 판매자 세션으로는
// 남의 채널 방송이 확인 없이 이어지지 않는다. 통과한 공격은 회귀로 남긴다.
import { listClaims } from "@livejjim/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  NO_LABEL,
  ORIGIN,
  addSeller,
  api,
  collectors,
  connect,
  query,
  rid,
  until,
  world,
  type Connected,
  type World,
} from "../y1/helpers.ts";

let w: World | null = null;
afterEach(async () => {
  await w?.close();
  w = null;
});

const B_TITLE = "다육이유튜버";

interface Setup {
  readonly w: World;
  readonly a: Connected;
  readonly b: { id: string; date: string };
  readonly channelB: string;
  readonly videoB: string;
  readonly liveChatB: string;
  readonly videoA: string;
}

/** 사장님(채널 A 연결) + 유튜버 채널 B의 진행 중 방송 + 사장님 자기 방송 + 오늘 회차 */
async function setup(
  settings: Record<string, unknown> = NO_LABEL,
): Promise<Setup> {
  w = await world();
  const a = await connect(w);
  const client = api(w.server, a.seller.cookie);
  const patched = await client.patch("/api/settings", { settings });
  expect(patched.status, patched.text).toBe(200);
  const created = await client.post("/api/broadcasts", {
    requestId: rid("bc"),
  });
  expect(created.status, created.text).toBe(200);
  const b = created.body.broadcast as { id: string; date: string };
  const channelB = w.fake.addChannel(w.fake.addAccount(), B_TITLE);
  const liveB = w.fake.addBroadcast(channelB.id, {
    title: "같이 하는 방송",
    status: "live",
  });
  const liveA = w.fake.addBroadcast(a.channel.id, {
    title: "내 방송",
    status: "live",
  });
  return {
    w,
    a,
    b,
    channelB: channelB.id,
    videoB: liveB.videoId,
    liveChatB: liveB.liveChatId as string,
    videoA: liveA.videoId,
  };
}

async function links(
  world: World,
): Promise<
  {
    video_id: string;
    channel_id: string;
    broadcast_channel_id: string | null;
    broadcast_id: string;
  }[]
> {
  return query(
    world,
    "select video_id, channel_id, broadcast_channel_id, broadcast_id from youtube_links order by linked_at",
  );
}

describe("AC-INV1-11 확인 표시 칸의 다른 모양", () => {
  it('TD-INV1-001(회귀): "true"·1·{}·[]·null·"yes"·[true]·{value:true}는 400 confirmInvited, 남의 방송은 이어지지 않는다', async () => {
    const s = await setup();
    const client = api(s.w.server, s.a.seller.cookie);
    for (const shape of [
      "true",
      1,
      {},
      [],
      null,
      "yes",
      [true],
      { value: true },
      "TRUE",
      "false",
      0,
    ]) {
      const res = await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
        requestId: rid("shape"),
        video: s.videoB,
        confirmInvited: shape,
      });
      expect(res.status, `${JSON.stringify(shape)} → ${res.text}`).toBe(400);
      expect((res.body.error as { code: string }).code).toBe("INVALID_INPUT");
      expect(
        (res.body.error as { problems?: { field: string }[] }).problems?.[0]
          ?.field ??
          (res.body.problems as { field: string }[] | undefined)?.[0]?.field,
      ).toBe("confirmInvited");
    }
    expect(await links(s.w)).toEqual([]);
  });

  it("TD-INV1-002(회귀): 다른 칸 이름·__proto__·주소 쿼리·영상 칸 안에 넣은 확인은 확인이 아니다", async () => {
    const s = await setup();
    const path = `/api/broadcasts/${s.b.id}/youtube`;
    const attempts: { path: string; raw: string }[] = [
      {
        path,
        raw: JSON.stringify({
          requestId: rid("k"),
          video: s.videoB,
          ConfirmInvited: true,
        }),
      },
      {
        path,
        raw: JSON.stringify({
          requestId: rid("k"),
          video: s.videoB,
          confirm: true,
        }),
      },
      {
        path,
        raw: JSON.stringify({
          requestId: rid("k"),
          video: s.videoB,
          confirmOtherChannel: true,
        }),
      },
      {
        path,
        raw: `{"requestId":"${rid("k")}","video":"${s.videoB}","__proto__":{"confirmInvited":true}}`,
      },
      {
        path,
        raw: `{"requestId":"${rid("k")}","video":"${s.videoB}","constructor":{"prototype":{"confirmInvited":true}}}`,
      },
      {
        path: `${path}?confirmInvited=true`,
        raw: JSON.stringify({ requestId: rid("k"), video: s.videoB }),
      },
      {
        path,
        raw: JSON.stringify({
          requestId: rid("k"),
          video: { url: s.videoB, confirmInvited: true },
        }),
      },
      {
        path,
        raw: JSON.stringify({
          requestId: rid("k"),
          video: `${s.videoB}&confirmInvited=true`,
        }),
      },
      {
        path,
        raw: JSON.stringify({
          requestId: rid("k"),
          video: `https://www.youtube.com/watch?v=${s.videoB}&confirmInvited=true`,
        }),
      },
      {
        path,
        raw: JSON.stringify([
          { requestId: rid("k"), video: s.videoB, confirmInvited: true },
        ]),
      },
    ];
    for (const attempt of attempts) {
      const res = await s.w.server.app.request(attempt.path, {
        method: "POST",
        headers: {
          Cookie: s.a.seller.cookie,
          Origin: ORIGIN,
          "Content-Type": "application/json",
        },
        body: attempt.raw,
      });
      const text = await res.text();
      expect(res.status, `${attempt.path} ${attempt.raw} → ${text}`).not.toBe(
        200,
      );
    }
    // 같은 키가 두 번 — 마지막 값(false)을 따른다면 확인이 아니다
    const dup = await s.w.server.app.request(path, {
      method: "POST",
      headers: {
        Cookie: s.a.seller.cookie,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: `{"requestId":"${rid("dup")}","video":"${s.videoB}","confirmInvited":true,"confirmInvited":false}`,
    });
    expect(dup.status).toBe(409);
    expect(await links(s.w)).toEqual([]);
  });
});

describe("AC-INV1-11 영상 ID 섞기·요청 번호 재사용", () => {
  it("TD-INV1-003(회귀): 내 영상과 남의 영상을 한 주소에 섞어도, 확인 없이 이어지는 것은 내 채널 영상뿐이다", async () => {
    const s = await setup();
    const client = api(s.w.server, s.a.seller.cookie);
    const mixed = [
      `https://www.youtube.com/watch?v=${s.videoA}&v=${s.videoB}`,
      `https://www.youtube.com/watch?v=${s.videoB}&v=${s.videoA}`,
      `https://youtu.be/${s.videoB}?v=${s.videoA}`,
      `https://www.youtube.com/live/${s.videoB}?v=${s.videoA}`,
      `https://www.youtube.com/watch?v=${s.videoA},${s.videoB}`,
      `https://www.youtube.com/watch?v=${s.videoB}#v=${s.videoA}`,
      `${s.videoA} ${s.videoB}`,
      `${s.videoA},${s.videoB}`,
      `https://studio.youtube.com/video/${s.videoB}/livestreaming?v=${s.videoA}`,
    ];
    for (const video of mixed) {
      const res = await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
        requestId: rid("mix"),
        video,
      });
      if (res.status === 200) {
        const link = res.body.link as {
          videoId: string;
          broadcastChannelId: string;
          invited: boolean;
        };
        expect(link, video).toMatchObject({
          videoId: s.videoA,
          broadcastChannelId: s.a.channel.id,
          invited: false,
        });
        const off = await client.post(
          `/api/broadcasts/${s.b.id}/youtube/unlink`,
          { requestId: rid("off") },
        );
        expect(off.status, off.text).toBe(200);
      }
    }
    const rows = await links(s.w);
    expect(
      rows.every(
        (row) =>
          row.video_id === s.videoA &&
          (row.broadcast_channel_id ?? row.channel_id) === s.a.channel.id,
      ),
    ).toBe(true);
  });

  it("TD-INV1-004(회귀): 내 방송을 이은 요청 번호를 남의 영상에 다시 써도 남의 방송은 이어지지 않는다", async () => {
    const s = await setup();
    const client = api(s.w.server, s.a.seller.cookie);
    const requestId = rid("reuse");
    expect(
      (
        await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
          requestId,
          video: s.videoA,
        })
      ).status,
    ).toBe(200);
    // 이어진 채로 같은 번호 + 남의 영상
    const again = await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
      requestId,
      video: s.videoB,
    });
    if (again.status === 200)
      expect((again.body.link as { videoId: string }).videoId).toBe(s.videoA);
    // 끊고 나서 같은 번호 + 남의 영상
    expect(
      (
        await client.post(`/api/broadcasts/${s.b.id}/youtube/unlink`, {
          requestId: rid("off"),
        })
      ).status,
    ).toBe(200);
    await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
      requestId,
      video: s.videoB,
    });
    expect(
      (await links(s.w)).filter((row) => row.video_id === s.videoB),
    ).toEqual([]);
    const view = await client.get(`/api/broadcasts/${s.b.id}/youtube`);
    expect(view.body.link).toBeNull();
  });

  it("TD-INV1-005(회귀): 확인 필요 응답을 받은 뒤 확인 없이 열 번 동시에 보내도 이어지지 않는다", async () => {
    const s = await setup();
    const client = api(s.w.server, s.a.seller.cookie);
    expect(
      (
        await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
          requestId: "same",
          video: s.videoB,
        })
      ).status,
    ).toBe(409);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.post(`/api/broadcasts/${s.b.id}/youtube`, {
          requestId: i % 2 === 0 ? "same" : rid("par"),
          video: s.videoB,
          ...(i % 3 === 0 ? { confirmInvited: false } : {}),
        }),
      ),
    );
    expect(
      results.map((res) => res.status).every((status) => status === 409),
    ).toBe(true);
    expect(await links(s.w)).toEqual([]);
  });
});

describe("AC-INV1-11 다른 판매자 세션", () => {
  it("TD-INV1-006(회귀): 판매자 2가 판매자 1의 회차에 확인과 함께 보내면 404, 판매자 1의 채널 방송도 판매자 2에게는 남의 방송이다", async () => {
    const s = await setup();
    const other = await connect(s.w);
    const otherClient = api(s.w.server, other.seller.cookie);
    const into = await otherClient.post(`/api/broadcasts/${s.b.id}/youtube`, {
      requestId: rid("x"),
      video: s.videoB,
      confirmInvited: true,
    });
    expect(into.status).toBe(404);
    // 판매자 2 자기 회차에 판매자 1(채널 A)의 방송 — 확인 없이는 안 된다
    const created = await otherClient.post("/api/broadcasts", {
      requestId: rid("bc"),
    });
    const b2 = (created.body.broadcast as { id: string }).id;
    const own = await otherClient.post(`/api/broadcasts/${b2}/youtube`, {
      requestId: rid("y"),
      video: s.videoA,
    });
    expect(own.status).toBe(409);
    expect(own.body.error).toMatchObject({ code: "INVITED_CONFIRM_NEEDED" });
    expect(own.body.channel).toMatchObject({ id: s.a.channel.id });
    // 판매자 1이 먼저 확인 표시를 보냈어도 판매자 2의 확인이 되지 않는다 (상태 없음)
    expect(
      (
        await api(s.w.server, s.a.seller.cookie).post(
          `/api/broadcasts/${s.b.id}/youtube`,
          { requestId: rid("ok"), video: s.videoB, confirmInvited: true },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await otherClient.post(`/api/broadcasts/${b2}/youtube`, {
          requestId: rid("z"),
          video: s.videoB,
        })
      ).status,
    ).toBe(409);
    expect((await links(s.w)).map((row) => row.broadcast_id)).toEqual([s.b.id]);
    // 연결 안 된 판매자: 확인이 있어도 잇지 않는다
    const bare = await addSeller(s.w);
    const bareClient = api(s.w.server, bare.cookie);
    const b3 = (
      (await bareClient.post("/api/broadcasts", { requestId: rid("bc") })).body
        .broadcast as { id: string }
    ).id;
    const res = await bareClient.post(`/api/broadcasts/${b3}/youtube`, {
      requestId: rid("n"),
      video: s.videoB,
      confirmInvited: true,
    });
    expect(res.status).toBe(409);
    expect((await links(s.w)).length).toBe(1);
  });
});

describe("AC-INV1-11 판정은 채널 종류에 따라 달라지지 않는다", () => {
  /** 같은 채팅 열을 공식 수집기로 받는다. host는 방송 채널(초대 방송이면 B, 내 방송이면 A) */
  async function claimsOf(
    invited: boolean,
    ignoreOwner: boolean,
  ): Promise<unknown[]> {
    const s = await setup({ ...NO_LABEL, "claim.ignoreOwner": ignoreOwner });
    const client = api(s.w.server, s.a.seller.cookie);
    const linked = await client.post(`/api/broadcasts/${s.b.id}/youtube`, {
      requestId: rid("l"),
      video: invited ? s.videoB : s.videoA,
      ...(invited ? { confirmInvited: true } : {}),
    });
    expect(linked.status, linked.text).toBe(200);
    const link = linked.body.link as { liveChatId?: string; invited: boolean };
    expect(link.invited).toBe(invited);
    const liveChatId =
      (
        await query<{ live_chat_id: string }>(
          s.w,
          "select live_chat_id from youtube_links",
        )
      )[0]?.live_chat_id ?? "";
    for (const [no, name, price] of [
      [15, "핑크프릴", 10000],
      [16, "라울", 25000],
      [17, "황금사", 8000],
    ] as const) {
      const res = await client.post("/api/events", {
        requestId: rid("ev"),
        type: "product.register",
        b: s.b.id,
        no,
        name,
        price,
      });
      expect(res.status, res.text).toBe(200);
    }
    const host = invited ? s.channelB : s.a.channel.id;
    const script: [string, string, string][] = [
      [host, "방송자", "15번 2만원 갑니다"],
      ["UCviewer000000000000001", "가나", "15"],
      [host, "방송자", "16"],
      ["UCviewer000000000000002", "다라", "15"],
      ["UCviewer000000000000002", "다라", "16번 두개"],
      ["UCviewer000000000000003", "마바", "16"],
      ["UCviewer000000000000001", "가나", "15 취소"],
      [host, "방송자", "17 17 17"],
      ["UCviewer000000000000003", "마바", "17"],
      ["UCviewer000000000000004", "<b>사</b>", "17번요"],
    ];
    collectors(s.w).start();
    let at = s.w.timer.now();
    for (const [author, name, text] of script)
      s.w.fake.addMessage(liveChatId, {
        author,
        name,
        text,
        publishedAt: (at += 1000),
      });
    await until(
      s.w,
      async () =>
        (
          await query<{ n: number }>(
            s.w,
            `select count(*)::int as n from events where type = 'chat'`,
          )
        )[0]?.n === script.length,
      { step: 200 },
    );
    const state = (await s.w.server.writer.read(s.a.seller.sellerId, s.b.date))
      .state;
    const who = (buyer: string) => (buyer === host ? "HOST" : buyer);
    const out = listClaims(state).map((claim) => ({
      no: claim.no,
      buyer: who(claim.buyer),
      currentBuyer: who(claim.currentBuyer),
      status: claim.status,
      reason: claim.reason,
      origin: claim.origin,
    }));
    await s.w.close();
    w = null;
    return out;
  }

  it("TD-INV1-007(회귀): 방송자 글 무시 예 — 초대 방송과 내 방송의 찜 결과가 같다", async () => {
    const mine = await claimsOf(false, true);
    const invited = await claimsOf(true, true);
    expect(mine.length).toBeGreaterThan(0);
    expect(
      mine.some((claim) => (claim as { buyer: string }).buyer === "HOST"),
    ).toBe(false);
    expect(invited).toEqual(mine);
  });

  it("TD-INV1-008(회귀): 방송자 글 무시 아니오 — 방송자(초대 방송이면 유튜버)의 글도 같은 방식으로 판정된다", async () => {
    const mine = await claimsOf(false, false);
    const invited = await claimsOf(true, false);
    expect(
      mine.some((claim) => (claim as { buyer: string }).buyer === "HOST"),
    ).toBe(true);
    expect(invited).toEqual(mine);
  });
});
