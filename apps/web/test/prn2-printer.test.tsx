// PRN2 프린터 지원 단계 — 웹 (AC-PRN2-04·06·08·10, LABEL_RULES L-7 지원 단계·고르기 목록, L-11 10·13, D-PRN2-01·04·07):
// - 실제 프린터 어댑터는 한 목록 어댑터(requestDevice 하나 — NIIMBOT·Marklife·바우아토)
// - 실험 기종: 프린터 이름 뒤 "(실험)" + 안내 한 줄(L-7 문장 그대로), "이 기기에서 출력"은 그 연결의 테스트 인쇄 "예" 뒤에만. 확인됨(B1)은 그대로
// - 연결 알림·"이 기기에서 출력"에 프로필 ID만 (이름·기기 ID 없음)
// - 받은 작업의 크기가 이은 프린터 목록에 없으면 찍지 않고 라벨 오류(INVALID_TEMPLATE, size) + L-11 13 문장
// - 라벨 설정 크기 목록 = 서버 queue.labelSizes (없으면 출력 기기 프로필 ID로, 모르면 B1 목록)
import {
  createBitmap,
  defaultTemplate,
  type LabelBitmap,
} from "@livejjim/label";
import {
  BAUATO_PPA2L,
  MARKLIFE_P50,
  NIIMBOT_D110,
  createFakePrinter,
  printerRequestOptions,
  type FakePrinter,
} from "@livejjim/printer";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { onUnauthorized } from "../src/api/client.ts";
import type { ClaimedJob, PrintOverview } from "../src/api/print-types.ts";
import { PrintStore } from "../src/lib/print-store.ts";
import {
  PrinterStation,
  testLabelSize,
} from "../src/lib/printer-station.ts";
import { device, overview, queue, templates } from "./print-support.ts";
import { DATE, FakeEventSource, FakeServer, flush } from "./support.ts";

const ME = "device-me-1234";
const IMAGE: LabelBitmap = createBitmap(384, 240);
const NOTICE_BAUATO =
  "실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 Luck Jingle 앱에서 인쇄해 주세요.";
const NOTICE_MARKLIFE =
  "실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 Marklife 앱에서 인쇄해 주세요.";
const WAIT_TEST =
  '실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.';

let server: FakeServer;
let current: PrintOverview;
let testPrinter: boolean;

const base64 = (image: LabelBitmap): string =>
  btoa(Array.from(image.data, (byte) => String.fromCharCode(byte)).join(""));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  server = new FakeServer();
  current = overview();
  testPrinter = true;
  server
    .on("GET", /^\/api\/me$/, () => ({
      body: { seller: { name: "구피 가게" }, loginId: "shop1" },
    }))
    .on("GET", /^\/api\/client-config$/, () => ({
      body: { hostActionDelayMs: 5000, testPrinter },
    }))
    .on("GET", /^\/api\/print$/, () => ({ body: current }))
    .on("GET", /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on("GET", /^\/api\/print\/labels\?/, () => ({
      body: { date: DATE, labels: [] },
    }))
    .on("GET", /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
    .on("GET", /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on("GET", /^\/api\/settings$/, () => ({
      body: { settings: { "print.autoOnConfirm": true } },
    }))
    .on("GET", /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, () => ({
      body: { width: IMAGE.width, height: IMAGE.height, data: base64(IMAGE) },
    }));
  vi.stubGlobal("fetch", server.fetch);
  vi.stubGlobal("EventSource", FakeEventSource);
  window.history.replaceState(null, "", "/labels");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onUnauthorized(null);
  FakeEventSource.reset();
});

async function openLabels(): Promise<HTMLElement> {
  render(<App />);
  await screen.findByRole("heading", { name: "라벨", level: 1 });
  await flush(10);
  return screen.getByRole("region", { name: "프린터" });
}

async function connectTest(printer: HTMLElement): Promise<void> {
  fireEvent.click(
    within(printer).getByRole("button", {
      name: "시험용 프린터 — 실제로 출력되지 않아요",
    }),
  );
  await waitFor(() => expect(within(printer).getByText("연결됨")).toBeTruthy());
}

describe("한 목록 고르기 창 (AC-PRN2-04, L-7 고르기 목록)", () => {
  it('"블루투스로 연결"은 requestDevice 한 번 — filters에 NIIMBOT 서비스·NIIMBOT 이름 꼴·L-12 앞자리, optionalServices ff00·fd00', async () => {
    const requests: unknown[] = [];
    const bluetooth = {
      getAvailability: async () => true,
      requestDevice: async (options: unknown) => {
        requests.push(options);
        throw Object.assign(
          new Error("User cancelled the requestDevice() chooser."),
          { name: "NotFoundError" },
        );
      },
    };
    Object.defineProperty(window.navigator, "bluetooth", {
      value: bluetooth,
      configurable: true,
    });
    try {
      testPrinter = false;
      const printer = await openLabels();
      fireEvent.click(
        within(printer).getByRole("button", { name: "블루투스로 연결" }),
      );
      await waitFor(() =>
        expect(within(printer).getByRole("alert")).toBeTruthy(),
      );
      expect(requests).toEqual([printerRequestOptions()]);
      // 고르지 않았다: L-7 NOT_SELECTED 문장 (PRN2 — B1이 아니라 "프린터")
      expect(
        within(printer).getByText(
          "프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.",
        ),
      ).toBeTruthy();
      // 브라우저 창은 줄마다 "실험"을 달 수 없다 — 연결 전 한 줄 안내
      expect(
        within(printer).getByText(
          /NIIMBOT B1이 아닌 프린터\(Marklife·바우아토·NIIMBOT 다른 모델\)는 실험 중이에요/,
        ),
      ).toBeTruthy();
    } finally {
      delete (window.navigator as { bluetooth?: unknown }).bluetooth;
    }
  });
});

describe('실험 표시와 "이 기기에서 출력" (AC-PRN2-06, L-7 지원 단계)', () => {
  it('확인됨(B1): 이름 뒤 "(실험)"·안내가 없고 "이 기기에서 출력"이 바로 보인다 — 알림에 프로필 ID', async () => {
    window.sessionStorage.setItem("livejjim.deviceId", ME);
    current = overview({
      queue: queue({
        device: device(ME, { name: "PC", printerConnected: false }),
      }),
    });
    server.on("POST", /^\/api\/print\/device\/state$/, () => ({
      body: { queue: current.queue },
    }));
    const printer = await openLabels();
    await connectTest(printer);
    expect(within(printer).getByText("NIIMBOT B1")).toBeTruthy();
    expect(within(printer).queryByText(/\(실험\)/)).toBeNull();
    expect(
      within(printer).queryByRole("note", { name: "실험 중인 프린터 안내" }),
    ).toBeNull();
    expect(within(printer).queryByText(WAIT_TEST)).toBeNull();
    // 출력 기기라 "이 기기에서 출력"은 없지만 알림은 프로필 ID 하나만 담는다 (이름·기기 ID 없음)
    await waitFor(() =>
      expect(
        server.callsTo("POST", /^\/api\/print\/device\/state$/).at(-1)?.body,
      ).toEqual({ deviceId: ME, connected: true, profileId: "NIIMBOT_B1" }),
    );
  });

  it('실험(바우아토): "바우아토 스티코팝 (실험)" + 안내 한 줄, 테스트 인쇄 "예" 뒤에만 "이 기기에서 출력" — 보낼 때 프로필 ID', async () => {
    let becomeBody: Record<string, unknown> | null = null;
    server.on("POST", /^\/api\/print\/device$/, (call) => {
      becomeBody = call.body;
      return {
        body: {
          queue: queue({
            device: device(String(call.body?.["deviceId"]), { name: "PC" }),
          }),
          waiting: 0,
          backlog: false,
        },
      };
    });
    const printer = await openLabels();
    expect(window.livejjimTestPrinter?.setTestProfile("BAUATO_PPA2L")).toBe(
      true,
    );
    await connectTest(printer);
    expect(within(printer).getByText("바우아토 스티코팝 (실험)")).toBeTruthy();
    expect(
      within(printer).getByRole("note", { name: "실험 중인 프린터 안내" })
        .textContent,
    ).toContain(NOTICE_BAUATO);
    // 그림 파일로 대체 (웹은 LBL-07 PNG 저장·공유 그대로)
    expect(
      within(
        within(printer).getByRole("note", { name: "실험 중인 프린터 안내" }),
      )
        .getByRole("link", { name: "그림 파일로 저장하기" })
        .getAttribute("href"),
    ).toBe("#label-export");
    // 농도를 받지 않는 프린터 — 농도 칸이 없다
    expect(within(printer).queryByLabelText("인쇄 농도")).toBeNull();
    expect(
      within(printer).queryByRole("button", { name: "이 기기에서 출력" }),
    ).toBeNull();
    expect(within(printer).getByText(WAIT_TEST)).toBeTruthy();
    fireEvent.click(
      within(printer).getByRole("button", { name: "테스트 인쇄" }),
    );
    const result = await within(printer).findByRole("group", {
      name: "테스트 인쇄 결과",
    });
    // "아니요"는 열지 않는다
    fireEvent.click(within(result).getByRole("button", { name: "아니요" }));
    expect(
      within(printer).queryByRole("button", { name: "이 기기에서 출력" }),
    ).toBeNull();
    fireEvent.click(within(result).getByRole("button", { name: "예" }));
    const become = await within(printer).findByRole("button", {
      name: "이 기기에서 출력",
    });
    expect(become.className).toContain("button-primary");
    expect(within(printer).queryByText(WAIT_TEST)).toBeNull();
    fireEvent.click(become);
    await waitFor(() => expect(becomeBody).not.toBeNull());
    expect(becomeBody).toEqual({
      deviceId: expect.any(String),
      name: "PC",
      profileId: "BAUATO_PPA2L",
    });
  });

  it("끊었다 다시 이으면 테스트 확인도 처음부터 — 그 연결에서 다시 테스트 인쇄해야 한다", async () => {
    const printer = await openLabels();
    window.livejjimTestPrinter?.setTestProfile("MARKLIFE_P50");
    await connectTest(printer);
    expect(within(printer).getByText("Marklife P50 (실험)")).toBeTruthy();
    expect(
      within(printer).getByRole("note", { name: "실험 중인 프린터 안내" })
        .textContent,
    ).toContain(NOTICE_MARKLIFE);
    // YXQ 농도 1~3만
    expect(
      [
        ...(within(printer).getByLabelText("인쇄 농도") as HTMLSelectElement)
          .options,
      ].map((option) => option.value),
    ).toEqual(["1", "2", "3"]);
    fireEvent.click(
      within(printer).getByRole("button", { name: "테스트 인쇄" }),
    );
    fireEvent.click(
      within(
        await within(printer).findByRole("group", { name: "테스트 인쇄 결과" }),
      ).getByRole("button", { name: "예" }),
    );
    await within(printer).findByRole("button", { name: "이 기기에서 출력" });
    fireEvent.click(within(printer).getByRole("button", { name: "연결 끊기" }));
    await waitFor(() => expect(within(printer).getByText("끊김")).toBeTruthy());
    await connectTest(printer);
    expect(
      within(printer).queryByRole("button", { name: "이 기기에서 출력" }),
    ).toBeNull();
    expect(
      within(printer).queryByRole("group", { name: "테스트 인쇄 결과" }),
    ).toBeNull();
    expect(within(printer).getByText(WAIT_TEST)).toBeTruthy();
  });

  it("표에 없는 프로필 ID는 시험 손잡이가 받지 않는다", async () => {
    await openLabels();
    expect(window.livejjimTestPrinter?.setTestProfile("NIIMBOT_B1_PRO")).toBe(
      false,
    );
    expect(window.livejjimTestPrinter?.setTestProfile(null)).toBe(true);
  });
});

describe("라벨 설정 크기 목록 (AC-PRN2-08, L-11 13)", () => {
  const sizeNames = (): string[] =>
    screen
      .getAllByRole("radiogroup")
      .map((group) =>
        within(group)
          .queryAllByRole("radio")
          .map((radio) => radio.closest("label")?.textContent ?? ""),
      )
      .flat();

  it("서버가 준 queue.labelSizes가 목록 — 테이프 프린터면 포장 라벨 크기가 없다는 안내", async () => {
    current = overview({
      queue: queue({
        device: device("phone-1", {
          name: "휴대폰",
          profileId: "MARKLIFE_P12",
        }),
        labelSizes: ["tape12x40", "tape15x30", "tape15x50"],
      }),
    });
    await openLabels();
    await waitFor(() =>
      expect(screen.getAllByText("테이프 12×40mm").length).toBeGreaterThan(0),
    );
    expect(sizeNames()).toEqual(
      expect.arrayContaining([
        "테이프 12×40mm",
        "테이프 15×30mm",
        "테이프 15×50mm",
      ]),
    );
    expect(sizeNames()).not.toContain("50×30mm");
    // 저장된 상품 템플릿(50×30)은 이 프린터 목록에 없다 → 출력 기기가 멈출 문장을 미리 경고
    expect(
      screen.getAllByRole("note", { name: "라벨 크기 경고" })[0]?.textContent,
    ).toBe(
      "이 프린터는 50×30 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.",
    );
  });

  it("옛 서버(labelSizes 없음)면 출력 기기 프로필 ID로, 모르면 B1 목록", async () => {
    current = overview({
      queue: queue({
        device: device("phone-1", {
          name: "휴대폰",
          profileId: "NIIMBOT_D110",
        }),
      }),
    });
    await openLabels();
    await waitFor(() =>
      expect(screen.getAllByText("테이프 12×40mm").length).toBeGreaterThan(0),
    );
    cleanup();
    current = overview({ queue: queue({ device: null }) });
    await openLabels();
    await waitFor(() =>
      expect(screen.getAllByText("50×30mm").length).toBeGreaterThan(0),
    );
    expect(sizeNames()).not.toContain("테이프 12×40mm");
    expect(screen.queryByRole("note", { name: "라벨 크기 경고" })).toBeNull();
  });
});

describe("출력 기기: 이은 프린터가 못 찍는 크기 (AC-PRN2-08, L-11 13)", () => {
  let store: PrintStore | null = null;
  let station: PrinterStation | null = null;
  afterEach(() => {
    station?.stop();
    store?.stop();
    station = null;
    store = null;
  });

  function claimed(id: string, size: "50x30" | "tape12x40"): ClaimedJob {
    return {
      id,
      date: DATE,
      kind: "product",
      reason: "auto",
      attempt: `attempt-${id}-0000`,
      data: {
        no: 15,
        name: "핑크프릴",
        price: 10000,
        date: DATE,
        buyer: { kind: "youtube", name: "우주천사" },
      },
      template: defaultTemplate("product", size),
      page: null,
      pages: null,
      label: {
        key: `c-${id}@1`,
        claim: `c-${id}`,
        version: 1,
        broadcast: "b1",
        no: 15,
        buyerId: null,
        buyer: { kind: "youtube", name: "우주천사" },
      },
    };
  }

  /**
   * 출력 기기로 시작해 시험용 프린터를 잇는다. confirm이면 그 연결에서 테스트 인쇄 뒤 "예"까지 누른다 —
   * 실험 기종은 "예" 전에 받지 않는다(D-PRN2-10). testPrints = 테스트 인쇄로 나간 장 수(작업 장 수와 가르기 위해)
   */
  async function startWith(
    fake: FakePrinter,
    jobs: ClaimedJob[],
    { confirm = false }: { confirm?: boolean } = {},
  ): Promise<{
    results: Record<string, unknown>[];
    renders: number[];
    testSizes: string[];
    testPrints: number;
  }> {
    const results: Record<string, unknown>[] = [];
    const renders: number[] = [];
    const testSizes: string[] = [];
    current = overview({
      queue: queue({ device: device(ME, { name: "휴대폰" }) }),
    });
    server
      .on("POST", /^\/api\/print\/claim$/, () => {
        const next = jobs.shift();
        return {
          body:
            next === undefined ? { job: null, reason: "EMPTY" } : { job: next },
        };
      })
      .on("POST", /^\/api\/print\/result$/, (call) => {
        results.push(call.body ?? {});
        return { body: { recorded: true } };
      })
      .on("POST", /^\/api\/print\/device\/state$/, () => ({
        body: { queue: current.queue },
      }));
    store = new PrintStore({
      openStream: () => new FakeEventSource("/api/stream"),
    });
    station = new PrinterStation({
      store,
      deviceId: ME,
      createTestPrinter: () => fake,
      detect: () => [],
      render: async () => {
        renders.push(1);
        return { ok: true, image: createBitmap(320, 96) };
      },
      renderTest: async ({ size }) => {
        testSizes.push(size);
        return {
          ok: true,
          image: size.startsWith("tape") ? createBitmap(320, 96) : IMAGE,
        };
      },
      requestWakeLock: null,
      today: () => DATE,
    });
    store.start();
    station.start();
    await flush();
    await station.connect("test");
    if (confirm) {
      await station.testPrint({ shopName: "", size: "50x30" });
      station.answerTest(true);
    }
    return { results, renders, testSizes, testPrints: confirm ? 1 : 0 };
  }

  it("D110(테이프)에 50×30 작업: 그리지도 보내지도 않고 INVALID_TEMPLATE(size) — 문장은 L-11 13 그대로, 다음 테이프 작업은 찍는다", async () => {
    const fake = createFakePrinter({
      methods: ["bluetooth"],
      profile: NIIMBOT_D110,
    });
    // D110은 실험 기종 — 그 연결에서 테스트 "예" 뒤에 받는다 (D-PRN2-10)
    const { results, renders, testPrints } = await startWith(
      fake,
      [claimed("j1", "50x30"), claimed("j2", "tape12x40")],
      { confirm: true },
    );
    await vi.waitFor(() => expect(results).toHaveLength(2));
    expect(results[0]).toEqual({
      deviceId: ME,
      attempt: "attempt-j1-0000",
      ok: false,
      error: { code: "INVALID_TEMPLATE", item: "size" },
    });
    expect(results[1]).toEqual({
      deviceId: ME,
      attempt: "attempt-j2-0000",
      ok: true,
    });
    expect(renders).toHaveLength(1);
    expect(fake.printed).toHaveLength(testPrints + 1);
    expect(station?.getSnapshot().profileId).toBe("NIIMBOT_D110");
  });

  it("못 찍는 크기면 그 문장이 이 기기의 마지막 오류다", async () => {
    const fake = createFakePrinter({
      methods: ["bluetooth"],
      profile: BAUATO_PPA2L,
    });
    const { results, testPrints } = await startWith(
      fake,
      [claimed("j1", "tape12x40")],
      { confirm: true },
    );
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(station?.getSnapshot().lastError).toBe(
      "이 프린터는 테이프 12×40 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.",
    );
    expect(fake.printed).toHaveLength(testPrints);
  });

  it('"예"는 그 연결에서 테스트 인쇄가 나온 뒤에만 받는다', async () => {
    const fake = createFakePrinter({
      methods: ["bluetooth"],
      profile: MARKLIFE_P50,
    });
    await startWith(fake, []);
    await vi.waitFor(() => expect(station?.getSnapshot().busy).toBe(false));
    await flush();
    station?.answerTest(true);
    expect(station?.getSnapshot().testConfirmed).toBe(false);
    await station?.testPrint({ shopName: "", size: "50x30" });
    expect(station?.getSnapshot().testPrinted).toBe(true);
    station?.answerTest(true);
    expect(station?.getSnapshot().testConfirmed).toBe(true);
    await station?.disconnect();
    await vi.waitFor(() =>
      expect(station?.getSnapshot().testConfirmed).toBe(false),
    );
    expect(station?.getSnapshot().profileId).toBeNull();
  });

  const stateBodies = (): unknown[] =>
    server
      .callsTo("POST", /^\/api\/print\/device\/state$/)
      .map((call) => call.body);
  const claims = (): number =>
    server.callsTo("POST", /^\/api\/print\/claim$/).length;

  it('이미 출력 기기에 실험 기종을 이으면 "예" 전까지 받지 않고 연결 안 됨으로 알린다 — "예" 뒤 연결됨+프로필 ID로 알리고 받는다 (D-PRN2-10)', async () => {
    const fake = createFakePrinter({
      methods: ["bluetooth"],
      profile: MARKLIFE_P50,
    });
    const { results } = await startWith(fake, [claimed("j1", "50x30")]);
    await flush(10);
    expect(stateBodies().at(-1)).toEqual({ deviceId: ME, connected: false });
    expect(stateBodies()).not.toContainEqual(
      expect.objectContaining({ connected: true }),
    );
    expect(claims()).toBe(0);
    expect(fake.printed).toHaveLength(0);
    // "아니요"는 풀지 않는다
    await station?.testPrint({ shopName: "", size: "50x30" });
    station?.answerTest(false);
    await flush(10);
    expect(claims()).toBe(0);
    expect(stateBodies()).not.toContainEqual(
      expect.objectContaining({ connected: true }),
    );
    // "예": 연결됨 + 프로필 ID로 다시 알리고 받기를 시작한다
    station?.answerTest(true);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(stateBodies()).toContainEqual({
      deviceId: ME,
      connected: true,
      profileId: "MARKLIFE_P50",
    });
    expect(results[0]).toEqual({
      deviceId: ME,
      attempt: "attempt-j1-0000",
      ok: true,
    });
    // 테스트 한 장 + 작업 한 장
    expect(fake.printed).toHaveLength(2);
  });

  it('끊김·다시 잇기면 "예"를 지운다 — 같은 프린터를 다시 이어도 그 연결에서 다시 "예" 전까지 받지 않는다 (D-PRN2-15)', async () => {
    const fake = createFakePrinter({
      methods: ["bluetooth"],
      profile: BAUATO_PPA2L,
    });
    const jobs = [claimed("j1", "50x30"), claimed("j2", "50x30")];
    const { results, testSizes } = await startWith(fake, jobs, {
      confirm: true,
    });
    // 테스트 그림은 이은 프린터 프로필의 기본 크기로 (D-PRN2-11)
    expect(testSizes).toEqual(["50x30"]);
    await vi.waitFor(() => expect(results).toHaveLength(2));
    const claimed1 = claims();
    jobs.push(claimed("j3", "50x30"));
    fake.simulateDisconnect();
    await vi.waitFor(() =>
      expect(station?.getSnapshot().testConfirmed).toBe(false),
    );
    await vi.waitFor(() =>
      expect(stateBodies().at(-1)).toEqual({ deviceId: ME, connected: false }),
    );
    await station?.connect("test");
    await flush(10);
    expect(station?.getSnapshot().connection).toBe("CONNECTED");
    expect(station?.getSnapshot().testConfirmed).toBe(false);
    expect(stateBodies().at(-1)).toEqual({ deviceId: ME, connected: false });
    expect(claims()).toBe(claimed1);
    expect(results).toHaveLength(2);
    // 이어져 있는 채로 "다시 연결"을 눌러도 연결이 바뀐 것 — "예"를 지운다
    await station?.testPrint({ shopName: "", size: "50x30" });
    station?.answerTest(true);
    await vi.waitFor(() => expect(results).toHaveLength(3));
    await station?.reconnect();
    await flush(10);
    expect(station?.getSnapshot().testConfirmed).toBe(false);
    expect(stateBodies().at(-1)).toEqual({ deviceId: ME, connected: false });
  });

  it("확인됨(B1)은 테스트 없이 바로 받는다 — 테스트 그림은 B1 기본 크기", async () => {
    const fake = createFakePrinter({ methods: ["bluetooth"] });
    const { results } = await startWith(fake, [claimed("j1", "50x30")]);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(stateBodies()).toContainEqual({
      deviceId: ME,
      connected: true,
      profileId: "NIIMBOT_B1",
    });
  });

  it("D110 테스트 인쇄는 테이프 기본 크기로 그린다 (D-PRN2-11)", async () => {
    const fake = createFakePrinter({
      methods: ["bluetooth"],
      profile: NIIMBOT_D110,
    });
    const { testSizes } = await startWith(fake, [], { confirm: true });
    expect(testSizes).toEqual(["tape12x40"]);
    expect(station?.getSnapshot().testError).toBeNull();
    expect(station?.getSnapshot().testConfirmed).toBe(true);
  });

  it("B1에 저장된 라벨 크기가 50×20이면 테스트도 50×20, 목록 밖이면 프로필 기본 크기 (D-PRN2-27)", async () => {
    const fake = createFakePrinter({ methods: ["bluetooth"] });
    const { testSizes } = await startWith(fake, []);
    await vi.waitFor(() => expect(station?.getSnapshot().busy).toBe(false));
    // 테스트 뒤 받기 한 바퀴(EMPTY)가 끝난 뒤 다음 테스트를 누른다
    for (const size of ["50x20", "50x40", "tape12x40"] as const) {
      await station?.testPrint({ shopName: "", size });
      await vi.waitFor(() => expect(station?.getSnapshot().busy).toBe(false));
      await flush();
    }
    expect(testSizes).toEqual(["50x20", "50x40", "50x30"]);
  });
});

describe("테스트 인쇄 크기 고르기 (D-PRN2-27)", () => {
  it("목록에 있으면 저장된 크기, 없으면 프로필 기본 크기, 프로필을 모르면 저장된 크기", () => {
    expect(testLabelSize("NIIMBOT_B1", "50x20")).toBe("50x20");
    expect(testLabelSize("NIIMBOT_B1", "tape12x40")).toBe("50x30");
    expect(testLabelSize("NIIMBOT_D110", "50x30")).toBe("tape12x40");
    expect(testLabelSize(null, "50x40")).toBe("50x40");
    expect(testLabelSize("UNKNOWN_MODEL", "50x40")).toBe("50x40");
  });
});

describe('출력 기기 화면: 실험 기종 테스트 "예" 기다림 (D-PRN2-10)', () => {
  it('멈춤 띠는 "다시 연결" 대신 까닭과 할 일, 프린터 칸은 한 줄 안내 — "예" 뒤 이어서 출력', async () => {
    window.sessionStorage.setItem("livejjim.deviceId", ME);
    current = overview({
      queue: queue({ device: device(ME, { name: "PC" }) }),
    });
    server.on("POST", /^\/api\/print\/device\/state$/, (call) => {
      const connected = call.body?.["connected"] === true;
      current = overview({
        queue: queue({
          device: device(ME, { name: "PC", printerConnected: connected }),
          ...(connected
            ? {}
            : {
                pause: {
                  reason: "DISCONNECTED",
                  message: "프린터 연결이 끊겨 출력을 멈췄어요.",
                  backlog: false,
                },
              }),
        }),
      });
      return { body: { queue: current.queue } };
    });
    const printer = await openLabels();
    window.livejjimTestPrinter?.setTestProfile("MARKLIFE_P50");
    await connectTest(printer);
    const band = await screen.findByRole("region", { name: "출력 멈춤" });
    await waitFor(() =>
      expect(
        within(band).getByText(
          '실험 중인 프린터라 출력을 잠시 멈췄어요. 테스트 인쇄를 하고 "예"를 누르면 다시 출력해요.',
        ),
      ).toBeTruthy(),
    );
    expect(within(band).queryByRole("button", { name: "다시 연결" })).toBeNull();
    expect(
      within(printer).getByText(
        '실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 라벨을 찍어요.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 연결" })).toBeNull();
    fireEvent.click(
      within(printer).getByRole("button", { name: "테스트 인쇄" }),
    );
    fireEvent.click(
      within(
        await within(printer).findByRole("group", { name: "테스트 인쇄 결과" }),
      ).getByRole("button", { name: "예" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "출력 멈춤" })).toBeNull(),
    );
    expect(within(printer).getByText("좋아요. 멈췄던 출력을 이어서 해요.")).toBeTruthy();
    expect(
      server.callsTo("POST", /^\/api\/print\/device\/state$/).at(-1)?.body,
    ).toEqual({ deviceId: ME, connected: true, profileId: "MARKLIFE_P50" });
  });
});
