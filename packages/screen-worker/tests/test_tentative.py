# 임시 등록(확인 중) 흐름 시험 (D-SCR-18~22, 계약서 docs/retro/tentative-contract.md).
# 서버는 가짜(sw.replay_live의 FakeServer — 계약서 2절의 답 모양), LLM도 가짜다. 실제 서버·codex는 부르지 않는다. 줄은 지어낸 것(손님 이름·실제 기록 없음).
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from sw import llm_live, post, replay_live
from test_llm_live_safe import Stage, row


class Server(replay_live.FakePoster):
    """가짜 서버에 보내는 가짜 보내기: 기본은 계약서대로 답하고, replies[종류]에 넣어 둔 답이 있으면 한 번 그 답을 돌려준다(판매자가 먼저 손댄 경우)"""

    def __init__(self, tentative=True, server=None):
        super().__init__(None, server, tentative)
        self.replies = {}

    def _do(self, kind, b, on_result=None):
        self.calls.append((kind, self.clock.now, dict(b)))
        res = self.replies.pop(kind, None) or self.server.apply(kind, self.clock.now, b)
        if on_result is not None:
            on_result(res)

    def kinds(self):
        return [kind for kind, _, _ in self.calls]

    def of(self, kind):
        return [b for k, _, b in self.calls if k == kind]


class TStage(Stage):
    """LLM 답이 오는 때를 시험이 정하는 무대: hear(줄이 들어옴 — 답은 아직) → reply(답이 옴)"""

    def __init__(self, case, tentative=True, server=None, **kw):
        self.gate = threading.Event()
        self.gate.set()
        self.srv = kw.pop("poster", None) or Server(tentative, server)
        super().__init__(case, poster=self.srv, **kw)
        self.srv.clock = self.clock

    def _ask(self, user, *a, **kw):
        self.asked.append(user)
        self.gate.wait(5)
        return self.out

    def hear(self, start, text, end=None):
        self.gate.clear()
        line = self.lines
        self.lines += 1
        self._append("transcript.jsonl", {"start_sec": start, "end_sec": end if end is not None else start + 3, "text": text})
        self.worker.tick()
        self.clock.now += llm_live.SCREEN_WAIT
        self.worker.tick()
        self.worker.tick()                                   # 임시 등록의 서버 답을 받는다
        return line

    def reply(self, *answers):
        self.out = "\n".join(json.dumps(a, ensure_ascii=False) for a in answers)
        self.gate.set()
        for _ in range(3):
            self.worker.tick()
            for *_, future in list(self.worker.flying):
                future.result()
        self.worker.tick()
        self.worker.tick()                                   # 확정·거두기의 서버 답을 받는다
        self.out = ""

    def product(self, no):
        return self.srv.server.products.get(no)


def caps(*drop, **extra):
    """서버가 알려 주는 입구·항목(apps/server/src/screen/routes.ts의 SCREEN_ENDPOINTS 모양). drop = 뺄 입구나 '입구.항목'"""
    table = {
        "register": ["videoId", "no", "price", "name", "heard", "conf", "requestId", "observedAt", "tentative"],
        "confirm": ["videoId", "no", "requestId", "registerRequestId", "to", "price", "name"],
        "withdraw": ["videoId", "no", "requestId", "registerRequestId"],
        "renumber": ["videoId", "from", "to", "requestId", "drop", "registerRequestId"],
        "rename": ["videoId", "no", "name", "requestId"],
        "reprice": ["videoId", "no", "price", "requestId"],
        "live": [],
        "capabilities": [],
    }
    for d in drop:
        name, _, field = d.partition(".")
        if field:
            table[name].remove(field)
        else:
            del table[name]
    table.update(extra)
    return {"commit": "abc1234", "endpoints": {k: {"method": "POST", "path": f"/internal/screen/{k}", "fields": v} for k, v in table.items()}}


class Http:
    """sw.post.http_json 자리에 끼우는 가짜 서버: 주소 끝(입구 이름)마다 (상태, 답)을 돌려주고 받은 요청을 적어 둔다"""

    def __init__(self, **routes):
        self.routes, self.seen, self.got = routes, [], threading.Event()

    def __call__(self, method, url, token, body=None, timeout=15):
        name = url.rsplit("/", 1)[-1]
        self.seen.append((name, body))
        answer = self.routes.get(name, (404, {"error": {"code": "NOT_FOUND"}}))
        answer = answer(body) if callable(answer) else answer
        self.got.set()
        return answer


class PosterCase:
    """진짜 보내기(sw.post.Poster)를 가짜 HTTP 위에 띄운다"""

    def poster(self, http, **kw):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        token = Path(tmp.name) / "token"
        token.write_text("test-token\n", encoding="utf-8")
        p = patch.object(post, "http_json", http)
        p.start()
        self.addCleanup(p.stop)
        poster = post.Poster("https://server.test", str(token), None, ask=False, **kw)
        self.addCleanup(poster.close, 0)
        return poster

    def wait(self, box, n=1):
        for _ in range(200):
            if len(box) >= n:
                return
            threading.Event().wait(0.01)
        self.fail("서버 답이 오지 않았어요")


class CapabilityTest(PosterCase, unittest.TestCase):
    def test_old_server_without_the_capabilities_endpoint_keeps_the_old_way(self):
        http = Http(register=(200, {"ok": True, "changed": True, "broadcasts": [{"changed": True}]}))
        poster = self.poster(http)
        self.assertTrue(poster.refresh())                                  # 서버에는 닿았다(404) — 옛 서버
        self.assertIsNone(poster.caps)
        self.assertFalse(poster.tentative_ok())
        plain = post.make_body("abcdefghijk", 334, 20000, "색금", "삼삼사 번", 0.9)
        self.assertEqual(poster._fit("register", plain), plain)            # 지금까지 보내던 것은 그대로
        tentative = post.make_body("abcdefghijk", 334, 20000, tentative=post.make_tentative(["PRICE_SINGLE_SOURCE"], [334], [20000]))
        self.assertIsNone(poster._fit("register", tentative))              # 임시 등록은 확인 없는 등록으로 바뀌면 안 되므로 보내지 않는다
        box = []
        poster.send(tentative, on_result=box.append)
        poster.confirm("abcdefghijk", 334, "screen-abcdefghijk-334-1", price=20000, on_result=box.append)
        poster.withdraw("abcdefghijk", 334, "screen-abcdefghijk-334-1", on_result=box.append)
        self.wait(box, 3)
        self.assertEqual([r.get("error") for r in box], ["UNSUPPORTED"] * 3)
        self.assertEqual([name for name, _ in http.seen], ["capabilities"])   # 서버가 모르는 요청은 하나도 나가지 않았다

    def test_new_server_allows_the_tentative_flow(self):
        poster = self.poster(Http(capabilities=(200, caps())))
        poster.refresh()
        self.assertTrue(poster.tentative_ok())
        for missing in ("confirm", "withdraw", "register.tentative"):
            with self.subTest(missing=missing):
                other = self.poster(Http(capabilities=(200, caps(missing))))
                other.refresh()
                self.assertFalse(other.tentative_ok())                     # 셋 가운데 하나라도 없으면 지금 방식

    def test_fields_the_server_does_not_know_are_not_sent(self):
        http = Http(capabilities=(200, caps("register.observedAt", "register.tentative", "reprice", "renumber.drop")),
                    register=(200, {"ok": True, "changed": True, "broadcasts": [{"changed": True}]}))
        poster = self.poster(http)
        poster.refresh()
        body = dict(post.make_body("abcdefghijk", 334, 20000, "색금"), observedAt=1763000361000, requestId="screen-abcdefghijk-334-1763000361000")
        box = []
        poster.send(body, on_result=box.append)
        self.wait(box)
        sent = dict(http.seen)["register"]
        self.assertNotIn("observedAt", sent)                               # 빼도 뜻이 바뀌지 않는 항목은 빼고 보낸다
        self.assertEqual(sent["requestId"], "screen-abcdefghijk-334-1763000361000")
        poster.reprice("abcdefghijk", 334, 30000, 1)                       # 서버에 없는 입구
        poster.renumber("abcdefghijk", 333, 334, "screen-abcdefghijk-333-1", drop=True)   # 빼면 뜻이 바뀌는 항목(drop)을 서버가 모른다
        threading.Event().wait(0.1)
        self.assertEqual([name for name, _ in http.seen], ["capabilities", "register"])

    def test_capabilities_survive_a_network_error_and_follow_a_rollback(self):
        http = Http(capabilities=(200, caps()))
        poster = self.poster(http)
        poster.refresh()
        http.routes["capabilities"] = (None, "timed out")
        self.assertFalse(poster.refresh())                                 # 닿지 못했다 — 지난 답을 그대로 둔다
        self.assertTrue(poster.tentative_ok())
        http.routes["capabilities"] = (404, None)                          # 서버가 옛 판으로 되돌아갔다
        self.assertTrue(poster.refresh())
        self.assertFalse(poster.tentative_ok())

    def test_requests_follow_the_contract(self):
        ok = {"ok": True, "changed": True, "broadcasts": [{"broadcastId": "b1", "changed": True}]}
        http = Http(capabilities=(200, caps()), register=(200, dict(ok, tentative=True)), confirm=(200, dict(ok, kept=None)), withdraw=(200, ok))
        poster = self.poster(http)
        poster.refresh()
        tentative = post.make_tentative(["NUMBER_MISMATCH", "PRICE_SINGLE_SOURCE"], [334, 333], [20000], ["색금"])
        body = dict(post.make_body("abcdefghijk", 334, 20000, "색금", "자 삼삼사 번 색금 이만 원", 0.7, tentative=tentative),
                    observedAt=1763000361000, requestId="screen-abcdefghijk-334-1763000361000")
        box = []
        poster.send(body, on_result=box.append)
        self.wait(box)
        self.assertTrue(box[0]["tentative"])
        poster.confirm("abcdefghijk", 334, body["requestId"], to=333, price=20000, name="색금", n="1763000361000", on_result=box.append)
        self.wait(box, 2)
        poster.confirm("abcdefghijk", 335, "screen-abcdefghijk-335-9", to=335, n=9, on_result=box.append)   # 번호가 그대로면 to를 싣지 않는다
        self.wait(box, 3)
        poster.withdraw("abcdefghijk", 336, "screen-abcdefghijk-336-7", n=7, on_result=box.append)
        self.wait(box, 4)
        sent = [(name, b) for name, b in http.seen if name != "capabilities"]
        self.assertEqual(sent[0][1]["tentative"], {"reasons": ["NUMBER_MISMATCH", "PRICE_SINGLE_SOURCE"], "candidates": {"no": [334, 333], "price": [20000], "name": ["색금"]}})
        self.assertEqual(sent[1], ("confirm", {"videoId": "abcdefghijk", "no": 334, "registerRequestId": "screen-abcdefghijk-334-1763000361000",
                                               "requestId": "screen-abcdefghijk-ok-334-1763000361000", "to": 333, "price": 20000, "name": "색금"}))
        self.assertEqual(sent[2], ("confirm", {"videoId": "abcdefghijk", "no": 335, "registerRequestId": "screen-abcdefghijk-335-9", "requestId": "screen-abcdefghijk-ok-335-9"}))
        self.assertEqual(sent[3], ("withdraw", {"videoId": "abcdefghijk", "no": 336, "registerRequestId": "screen-abcdefghijk-336-7", "requestId": "screen-abcdefghijk-no-336-7"}))

    def test_tentative_shape_is_trimmed_to_what_the_server_accepts(self):
        t = post.make_tentative(["NUMBER_MISMATCH", "NUMBER_MISMATCH", "소문자", "bad", "A" * 33] + [f"R{i}" for i in range(9)],
                                [334, 334, 0, 333, 335, 336, 337], [20000, 20000.5, -1, 30000], ["색금", " 색금 ", "", "가" * 70])
        self.assertEqual(t["reasons"], ["NUMBER_MISMATCH", "R0", "R1", "R2", "R3", "R4"])                  # 겹치지 않게, 모양이 맞는 것만, 6개까지
        self.assertEqual(t["candidates"], {"no": [334, 333, 335, 336], "price": [20000, 30000], "name": ["색금", "가" * 60]})
        self.assertIsNone(post.make_tentative([]))                                                          # 까닭이 없으면 임시 등록이 아니다

    def test_price_unit_of_this_video_is_read_from_the_live_list(self):
        live = {"videos": [{"videoId": "othervideo1", "priceUnit": "WON"}, {"videoId": "abcdefghijk", "priceUnit": "TEN_THOUSAND"}]}
        http = Http(capabilities=(200, caps()), live=(200, live))
        poster = self.poster(http, video_id="abcdefghijk")
        poster.refresh()
        self.assertEqual(poster.price_unit, "TEN_THOUSAND")
        live["videos"][1]["priceUnit"] = None                              # 이어진 계정끼리 단위가 다르다
        poster.refresh()
        self.assertIsNone(poster.price_unit)
        live["videos"][1]["priceUnit"] = "이상한 값"
        poster.refresh()
        self.assertIsNone(poster.price_unit)


class RealPosterTest(PosterCase, unittest.TestCase):
    def until(self, st, kind):
        """뒤 스레드의 서버 답이 일꾼 기록에 남을 때까지 일꾼을 돌린다"""
        for _ in range(300):
            if st.kinds(kind):
                return
            threading.Event().wait(0.01)
            st.worker.tick()
        self.fail(f"{kind} 기록이 남지 않았어요")

    def test_worker_and_poster_run_the_flow_over_http(self):
        # 진짜 보내기(sw.post.Poster, 뒤 스레드)와 일꾼을 이어서: 능력 묻기 → 임시 등록 → 서버 답 → 확정 → 서버 답
        up = {"ok": True, "changed": True, "tentative": True, "broadcastId": "b1", "no": 316, "broadcasts": [{"broadcastId": "b1", "changed": True, "duplicate": False, "tentative": True}]}
        done = {"ok": True, "changed": True, "no": 316, "broadcasts": [{"broadcastId": "b1", "changed": True, "kept": ["name"]}]}
        http = Http(capabilities=(200, caps()), live=(200, {"videos": [{"videoId": "testvideo01", "priceUnit": "TEN_THOUSAND"}]}), register=(200, up), confirm=(200, done))
        poster = self.poster(http, video_id="testvideo01")
        poster.refresh()
        st = TStage(self, poster=poster)
        self.assertEqual(st.worker.server_unit, "TEN_THOUSAND")
        st.show(0, 10, 316)
        st.hear(0, "316번 20만원 갑니다")
        self.until(st, "LLM임시결과")
        self.assertEqual([(e["state"], e["broadcasts"]) for e in st.kinds("LLM임시결과")], [("up", [{"changed": True, "duplicate": False, "tentative": True}])])
        st.reply(row(0, 316, 200000, None, no_from="말+화면"))
        self.until(st, "LLM확정결과")
        sent = [(name, body) for name, body in http.seen if name not in ("capabilities", "live")]
        self.assertEqual([name for name, _ in sent], ["register", "confirm"])
        self.assertEqual((sent[1][1]["registerRequestId"], sent[1][1]["price"]), (sent[0][1]["requestId"], 200000))
        self.assertNotIn("to", sent[1][1])
        self.assertEqual([(e["changed"], e["kept"]) for e in st.kinds("LLM확정결과")], [(True, ["name"])])
        self.assertEqual(st.worker.names[316]["fixes"], llm_live.NAME_MAX_FIX)     # 판매자가 고친 이름 — 이름 고치기를 더 보내지 않는다
        self.assertEqual(st.worker.waiting, 0)


class PriceUnitTest(unittest.TestCase):
    def test_only_units_the_seller_clearly_chose_replace_the_env_default(self):
        self.assertEqual(llm_live.unit_from_server("TEN_THOUSAND", 1000), (10000, True))
        self.assertEqual(llm_live.unit_from_server("WON", 10000), (None, True))
        for value in ("THOUSAND", "AUTO", None, "이상한 값", 10000):       # THOUSAND는 "고르지 않음"과 구별되지 않는다(계약서 2.4)
            with self.subTest(value=value):
                self.assertEqual(llm_live.unit_from_server(value, 10000), (10000, False))

    def test_worker_follows_the_server_unit(self):
        with patch.object(llm_live, "PRICE_UNIT", 1000):
            st = TStage(self)
            self.assertEqual(st.worker.unit, 1000)                         # 서버가 모르면 환경변수
            st.srv.price_unit = "THOUSAND"
            st.worker.tick()
            self.assertEqual(st.worker.unit, 1000)
            st.srv.price_unit = "TEN_THOUSAND"                             # 판매자가 고른 값이 (다시 물었을 때) 왔다
            st.worker.tick()
            self.assertEqual((st.worker.unit, st.worker.sys), (10000, llm_live.SYS))
            self.assertEqual([(e["server"], e["unit"], e["from_server"]) for e in st.kinds("LLM가격단위")], [("THOUSAND", 1000, False), ("TEN_THOUSAND", 10000, True)])

    def test_unit_known_at_start_is_used_from_the_first_line(self):
        srv = Server()
        srv.price_unit = "WON"
        st = Stage(self, poster=srv)
        srv.clock = st.clock
        self.assertIsNone(st.worker.unit)                                  # 원 단위 판매자: 단위 없이 말한 수는 금액으로 읽지 않는다
        self.assertTrue(st.worker.sys.endswith("prompt_unit.txt"))


class TentativeFlowTest(unittest.TestCase):
    def test_server_without_the_capability_gets_the_old_flow(self):
        st = TStage(self, tentative=False)
        st.show(0, 60, 305)
        st.say(0, "자 요거 35", row(0, 305, 35000, "왕색금"))
        st.say(4, "305번 왕색금 예쁘죠", row(0, 305, 35000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), [])                               # 다 모일 때까지 들고 기다린다
        st.say(40, "자 305번 35 왕색금", row(2, 305, 350000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["send"])
        self.assertEqual((st.product(305)["price"], st.product(305)["state"]), (350000, "판매"))

    def test_switch_turns_the_flow_off(self):
        with patch.object(llm_live, "TENTATIVE", False):
            st = TStage(self)
            st.show(0, 10, 316)
            st.hear(0, "316번 20만원 갑니다")
            self.assertEqual(st.srv.kinds(), [])
            st.reply(row(0, 316, 200000, None, no_from="말+화면"))
            self.assertEqual(st.srv.kinds(), ["send"])

    def test_number_and_price_in_one_line_go_up_before_the_llm_answers(self):
        # B2·L1: "316번 20만원" — 규칙이 바로 임시로 올리고, LLM 답이 같은 값이면 확정한다
        st = TStage(self)
        st.show(0, 10, 316)
        st.hear(0, "316번 20만원 갑니다")
        self.assertEqual(st.srv.kinds(), ["tentative"])
        body = st.srv.of("tentative")[0]
        self.assertEqual((body["no"], body["price"], body["tentative"]["reasons"]), (316, 200000, ["PRICE_SINGLE_SOURCE", "NAME_UNSURE"]))
        self.assertEqual(body["tentative"]["candidates"], {"no": [316], "price": [200000], "name": []})
        self.assertEqual(st.product(316)["state"], "임시")
        self.assertEqual(st.kinds("LLM등록"), [])                          # 아직 판매 중이 아니다(감사 채팅·라벨 없음)
        st.reply(row(0, 316, 200000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["tentative", "confirm"])
        confirm = st.srv.of("confirm")[0]
        self.assertEqual((confirm["no"], confirm["rid"], confirm["to"], confirm["price"]), (316, body["requestId"], None, 200000))
        self.assertEqual(st.product(316)["state"], "판매")
        reg = st.kinds("LLM등록")[0]
        self.assertEqual((reg["via"], reg["rid"], reg["sent"], reg["why_price"]), ("확정", body["requestId"], True, "판매자가 말한 금액과 같음"))
        self.assertEqual([(e["changed"], e["skips"], e["kept"]) for e in st.kinds("LLM확정결과")], [(True, [], [])])

    def test_garbled_price_is_not_registered_by_the_rule(self):
        # "만오"는 10,005원으로 읽힌다(받아쓰기가 흐림) — 규칙으로는 올리지 않고 LLM 답을 기다린다. 번호대 밖 번호도 규칙으로 올리지 않는다
        st = TStage(self, prior=[{"no": n, "price": 30000, "name": ""} for n in (377, 330, 327, 385, 393, 425)])
        st.show(0, 40, 363)
        st.hear(0, "363번 좋은 하루 만오")
        st.hear(4, "27번 한자 5만원")
        self.assertEqual(st.srv.kinds(), [])
        st.reply()

    def test_everything_settled_in_the_first_answer_registers_directly(self):
        # 번호 근거와 가격이 첫 답에서 다 맞으면 임시를 거치지 않는다(규칙이 읽지 못한 줄 — 번호에 '번'이 없다)
        st = TStage(self)
        st.show(0, 10, 316)
        st.hear(0, "자 316 20만원 갑니다")
        self.assertEqual(st.srv.kinds(), [])
        st.reply(row(0, 316, 200000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["send"])

    def test_number_evidence_without_a_settled_price_goes_up_tentative(self):
        # 305번 "자 요거 35": 번호표는 충분히 보였고 LLM은 35,000이라고 답했다 — 임시로 올리되 판매자 단위로 읽은 350,000을 보이고 두 금액을 후보로 싣는다
        st = TStage(self)
        st.show(0, 60, 305)
        st.say(0, "자 요거 35", row(0, 305, 35000, "왕색금"))
        body = st.srv.of("tentative")[0]
        self.assertEqual((body["no"], body["price"], body["name"]), (305, 350000, "왕색 금"))  # D-DICT-OPT-01: 보내는 이름은 "품종 옵션"(띄어 씀) — 처음 기대 붙여 쓴 이름을 바꿈
        self.assertEqual(body["tentative"]["reasons"], ["NUMBER_SINGLE_SOURCE", "PRICE_DISAGREE"])
        self.assertEqual(body["tentative"]["candidates"], {"no": [305], "price": [350000, 35000], "name": ["왕색 금"]})  # D-DICT-OPT-01: 보내는 이름은 "품종 옵션"(띄어 씀) — 처음 기대 붙여 쓴 이름을 바꿈
        st.say(4, "305번 왕색금 예쁘죠", row(0, 305, 35000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["tentative"])                    # 35,000 답이 거듭 와도 확정하지 않는다
        st.wait(llm_live.PRICE_WAIT + 1)
        self.assertEqual([e["no"] for e in st.kinds("LLM확인요청")], [305])  # 기록은 지금처럼 남긴다(상품은 이미 확인 중으로 올라가 있다)
        st.say(40, "자 305번 35 왕색금", row(2, 305, 350000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["tentative", "confirm"])
        self.assertEqual((st.product(305)["price"], st.product(305)["name"], st.product(305)["state"]), (350000, "왕색 금", "판매"))  # D-DICT-OPT-01: 보내는 이름은 "품종 옵션"(띄어 씀) — 처음 기대 붙여 쓴 이름을 바꿈

    def test_pair_wait_goes_up_with_both_numbers_and_is_confirmed_onto_the_screen_number(self):
        # 그 밖의 숫자 쌍(1↔3): 번호표가 충분히 보이기 전에는 말한 번호로 임시 등록하고 두 번호를 후보로 싣는다. 번호표가 충분히 보이면 화면 번호로 옮겨 확정한다
        st = TStage(self)
        st.show(0, 1, 353)
        st.say(0, "153번 청개구리 갑니다", row(0, 153, 250000, "청개구리", no_from="말"), end=1)
        body = st.srv.of("tentative")[0]
        self.assertEqual((body["no"], body["tentative"]["candidates"]["no"]), (153, [153, 353]))
        self.assertIn("NUMBER_MISMATCH", body["tentative"]["reasons"])
        # 확정 전: 다른 금액 답이 더 많아지면 임시로 보이는 금액을 바로 고쳐 보낸다
        st.say(2, "153번 진짜 예뻐요", row(0, 153, 200000, "청개구리", no_from="말"), end=3)
        st.say(4, "153번 색이 보세요", row(0, 153, 200000, "청개구리", no_from="말"), end=5)
        self.assertEqual(st.srv.of("reprice"), [{"no": 153, "price": 200000}])
        self.assertEqual([(e["field"], e["from"], e["to"], e["n"]) for e in st.kinds("LLM임시고치기")], [("price", 250000, 200000, 101)])
        self.assertNotIn("confirm", st.srv.kinds())
        st.show(6, 12, 353)
        st.wait(1)
        st.worker.tick()
        confirm = st.srv.of("confirm")[0]
        self.assertEqual((confirm["no"], confirm["to"], confirm["price"], confirm["rid"]), (153, 353, 200000, body["requestId"]))
        self.assertIsNone(st.product(153))
        self.assertEqual((st.product(353)["price"], st.product(353)["state"]), (200000, "판매"))
        self.assertEqual((st.kinds("LLM등록")[0]["no"], st.kinds("LLM등록")[0]["tent_no"]), (353, 153))

    def test_pair_resolved_onto_a_number_already_sent_withdraws_the_tentative(self):
        st = TStage(self)
        st.show(0, 9, 353)
        st.say(0, "자 353 25만원", row(0, 353, 250000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["send"])
        st.show(100, 101, 353)
        st.say(100, "153번 다시 보여드릴게요", row(1, 153, 250000, None, no_from="말"), end=101)
        self.assertEqual(st.srv.kinds(), ["send", "tentative"])
        st.show(102, 110, 353)
        st.wait(1)
        st.worker.tick()
        self.assertEqual(st.srv.kinds(), ["send", "tentative", "withdraw"])   # 화면 번호는 이미 보낸 상품 — 잘못 들은 번호의 임시 등록을 거둔다
        self.assertIsNone(st.product(153))

    def test_undecided_price_is_left_for_the_seller_and_confirmed_when_evidence_comes(self):
        # 363번: 답이 갈린 채 LLM_HOLD_MAX가 지났다 — 번호 근거는 섰으므로 거두지 않고 둔다(판매자가 앱에서 확정). 뒤에 근거가 모이면 같은 등록을 확정한다
        st = TStage(self)
        st.show(0, 40, 363)
        st.say(0, "363번 좋은 하루 만오", row(0, 363, 10000, None, no_from="말+화면"))
        st.say(5, "자 이것도 만족하실 겁니다", row(0, 363, 15000, None, no_from="말+화면"))
        body = st.srv.of("tentative")[0]
        self.assertEqual((body["price"], body["tentative"]["reasons"]), (10000, ["PRICE_SINGLE_SOURCE", "NAME_UNSURE"]))
        st.wait(llm_live.HOLD_MAX + 1)
        self.assertEqual(st.srv.kinds(), ["tentative"])
        self.assertEqual([(e["no"], e["why"]) for e in st.kinds("LLM임시남김")], [(363, "가격을 정하지 못함")])
        self.assertEqual(st.worker.pend, {})
        st.show(300, 310, 363)
        st.say(300, "363번 만오천원 갑니다", row(2, 363, 15000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["tentative", "confirm"])         # 새로 등록하지 않고 남겨 둔 임시 등록을 확정한다
        self.assertEqual(st.srv.of("confirm")[0]["rid"], body["requestId"])
        self.assertEqual((st.product(363)["price"], st.product(363)["state"]), (15000, "판매"))

    def test_keep_switch_off_withdraws_instead(self):
        with patch.object(llm_live, "TENT_KEEP", False):
            st = TStage(self)
            st.show(0, 40, 363)
            st.say(0, "363번 좋은 하루 만오", row(0, 363, 10000, None, no_from="말+화면"))
            st.wait(llm_live.HOLD_MAX + 1)
            st.worker.tick()
            self.assertEqual(st.srv.kinds(), ["tentative", "withdraw"])
            self.assertIsNone(st.product(363))

    def test_rule_reading_the_llm_does_not_share_is_withdrawn(self):
        # 받아쓰기가 번호를 잘라 "27번"으로 적었다. 규칙은 임시로 올렸지만 그 줄을 본 LLM 답 두 번이 27번을 적지 않았다 — 거둔다
        st = TStage(self)
        st.show(0, 30, 377)
        st.hear(0, "27번 한자 5만원")
        self.assertEqual(st.srv.kinds(), ["tentative"])
        self.assertTrue(st.kinds("LLM임시등록")[0]["rule"])
        st.reply()
        self.assertEqual(st.srv.kinds(), ["tentative"])                    # 한 번으로는 거두지 않는다
        st.hear(4, "한자 예쁘죠 5만원이에요")
        st.reply()
        self.assertEqual(st.srv.kinds(), ["tentative", "withdraw"])
        self.assertEqual(st.srv.of("withdraw")[0]["rid"], st.srv.of("tentative")[0]["requestId"])
        self.assertIsNone(st.product(27))
        self.assertEqual([(e["changed"], e["skips"]) for e in st.kinds("LLM거두기결과")], [(True, [])])
        st.hear(8, "27번 5만원 갑니다")                                     # 같은 말이 되풀이돼도 규칙으로는 다시 올리지 않는다
        self.assertEqual(st.srv.kinds(), ["tentative", "withdraw"])
        st.reply()

    def test_rule_tentative_is_kept_when_the_llm_is_silent(self):
        # LLM이 막혔다(답이 오지 않거나 오류) — 규칙으로 올린 것은 거두지 않고 둔다(판매자가 확정, 계획 L6)
        st = TStage(self)
        st.show(0, 10, 316)
        st.hear(0, "316번 20만원 갑니다")
        with patch("sw.llm_b6.rows_of", side_effect=AssertionError("답을 읽을 일이 없다")):
            st.clock.now += llm_live.HOLD_MAX + 1
            st.worker.tick()
        self.assertEqual(st.srv.kinds(), ["tentative"])
        self.assertEqual([e["no"] for e in st.kinds("LLM임시남김")], [316])
        st.gate.set()

    def test_broadcast_end_leaves_tentatives_for_the_seller(self):
        st = TStage(self)
        st.show(0, 40, 363)
        st.say(0, "363번 좋은 하루 만오", row(0, 363, 10000, None, no_from="말+화면"))
        st.worker.finish()
        self.assertEqual(st.srv.kinds(), ["tentative"])                    # 방송이 끝나도 거두지 않는다(계약서 2.5)
        self.assertEqual([(e["no"], e["why"]) for e in st.kinds("LLM임시남김")], [(363, "방송 끝")])
        self.assertEqual(st.product(363)["state"], "임시")

    def test_misheard_number_is_merged_into_the_tentative_on_screen_before_it_is_confirmed(self):
        # 306번을 임시로 올려 둔 채(가격을 못 정함) 그 번호표가 내내 보이는데 받아쓰기가 "313번 3만원"이라고 적었다(306을 잘못 들음).
        # 313은 화면에 한 번도 안 보였다 — 확정하지 않고 306의 답으로 합친다. 313은 판매 중이 된 적이 없고, 306은 두 답이 같은 3만원으로 확정된다
        st = TStage(self)
        st.show(0, 60, 306)
        st.hear(0, "306번 갑니다 특가 2만원")
        st.reply()
        self.assertEqual((st.product(306)["state"], st.product(306)["price"]), ("임시", 20000))
        st.hear(20, "313번 3만원입니다")
        self.assertEqual(st.product(313)["state"], "임시")                 # 규칙은 받아쓴 대로 올렸다
        # 한 답이 306번에 3만원·2만원을 다 적고(갈림) 313번에 3만원을 적었다. 313번 줄은 판매자가 따로 한 말이라 같은 답이어도 따로 센다 → 3만원 2 대 2만원 1
        st.reply(row(0, 306, 30000, None, no_from="말+화면"), row(0, 306, 20000, None, no_from="말+화면"), row(1, 313, 30000, None, no_from="말"))
        self.assertEqual([k for k in st.srv.kinds() if k != "reprice"], ["tentative", "tentative", "withdraw", "confirm"])
        self.assertEqual([(e["said"], e["screen"]) for e in st.kinds("LLM번호화면판정")], [(313, 306)])
        self.assertIsNone(st.product(313))
        self.assertEqual((st.product(306)["state"], st.product(306)["price"]), ("판매", 30000))
        self.assertEqual([e["no"] for e in st.kinds("LLM등록")], [306])
        st.hear(30, "313번 3만원 갑니다")                                   # 같은 말이 되풀이돼도 313을 다시 올리지 않는다
        st.reply(row(2, 313, 30000, None, no_from="말"))
        self.assertIsNone(st.product(313))

    def test_two_said_prices_follow_the_price_rule(self):
        # 판매자가 한 상품에 두 금액을 말했고("특가 2만원" … "3만원") LLM 답이 3만원 1번·2만원 2번으로 갈렸다 — 확정 조건은 가격 규칙(D-SCR-13) 그대로다
        st = TStage(self)
        st.show(0, 90, 306)
        st.hear(0, "306번 갑니다 특가 2만원")
        st.reply(row(0, 306, 30000, None, no_from="말+화면"))
        st.hear(4, "306번 빅뱅 3만원 갑니다")
        st.reply(row(1, 306, 20000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds().count("confirm"), 0)               # 1 대 1 — 기다린다(임시 등록에는 두 금액이 후보로 보인다)
        st.hear(8, "306번 보세요")
        st.reply(row(1, 306, 20000, None, no_from="말+화면"))
        self.assertEqual(st.srv.of("confirm")[0]["price"], 20000)          # 말한 금액 가운데 답이 많은 쪽

    def test_number_fix_does_not_move_a_product_onto_a_live_tentative(self):
        # 위와 같지만 313을 말한 지 얼마 안 돼(FIX_MIN 전) 확정됐다. 그 뒤의 번호 바로잡기(D-SCR-06)는 313을 306으로 옮기지 않는다
        # — 306은 이미 (임시로) 등록한 번호이고 313을 말하기 전에 올린 것이라, 앞 상품 번호표가 남은 채 다음 번호를 부른 것일 수 있다
        st = TStage(self)
        st.show(0, 25, 306)
        st.hear(0, "306번 갑니다 특가 2만원")
        st.reply(row(0, 306, 30000, None, no_from="말+화면"))
        st.hear(20, "313번 3만원입니다")
        st.reply(row(1, 313, 30000, None, no_from="말"))
        self.assertEqual(st.product(313)["state"], "판매")
        st.show(26, 60, 306)
        st.wait(5)
        self.assertNotIn("renumber", st.srv.kinds())
        self.assertEqual(st.kinds("LLM번호바로잡기"), [])
        self.assertEqual(st.product(306)["state"], "임시")

    def test_number_already_sent_is_not_registered_tentatively(self):
        st = TStage(self)
        st.show(0, 10, 393)
        st.say(0, "자 393 손톱 2만원", row(0, 393, 20000, "손톱", no_from="말+화면"))
        st.show(1800, 1830, 393)
        st.hear(1800, "393번 손톱 만원에 선물 가격")
        st.reply(row(1, 393, 10000, "손톱", no_from="말+화면"))
        self.assertNotIn("tentative", st.srv.kinds())                      # 다시 내놓은 상품은 지금처럼 금액 고치기로만


class SellerFirstTest(unittest.TestCase):
    """판매자가 먼저 확정·수정·거둔 상품은 건드리지 않는다 — 서버 응답의 skip·kept를 그대로 따르고 이벤트로 남긴다"""

    def start(self):
        st = TStage(self)
        st.show(0, 60, 426)
        st.hear(0, "426번 35만원 갑니다")
        return st

    def test_kept_field_is_not_fixed_by_the_worker_afterwards(self):
        st = self.start()
        st.srv.replies["confirm"] = {"ok": True, "changed": True, "no": 426, "broadcasts": [{"broadcastId": "b1", "changed": True, "kept": ["price"]}]}
        st.reply(row(0, 426, 350000, None, no_from="말+화면"))
        self.assertEqual([(e["changed"], e["kept"]) for e in st.kinds("LLM확정결과")], [(True, ["price"])])
        self.assertEqual(st.worker.prices[426]["fixes"], llm_live.PRICE_MAX_FIX)   # 판매자가 고친 금액 — 금액 고치기를 더 보내지 않는다
        self.assertEqual(st.worker.names[426]["fixes"], 0)                         # 이름은 일꾼 값이 들어갔다 — 이름 고치기는 그대로

    def test_seller_confirmed_first(self):
        st = self.start()
        st.srv.replies["confirm"] = {"ok": True, "changed": False, "no": 426, "broadcasts": [{"broadcastId": "b1", "changed": False, "skip": "NOT_TENTATIVE"}]}
        st.reply(row(0, 426, 350000, None, no_from="말+화면"))
        self.assertEqual([(e["changed"], e["skips"]) for e in st.kinds("LLM확정결과")], [(False, ["NOT_TENTATIVE"])])
        self.assertEqual((st.worker.prices[426]["fixes"], st.worker.names[426]["fixes"]), (llm_live.PRICE_MAX_FIX, llm_live.NAME_MAX_FIX))
        self.assertNotIn(426, st.worker.watch)                             # 번호 바로잡기도 하지 않는다
        self.assertEqual(st.srv.kinds(), ["tentative", "confirm"])         # 다시 확정하거나 거두지 않는다

    def test_seller_edited_product_is_not_withdrawn(self):
        st = TStage(self)
        st.show(0, 30, 377)
        st.hear(0, "27번 한자 5만원")
        st.reply()
        st.hear(4, "한자 예쁘죠 5만원이에요")
        st.srv.replies["withdraw"] = {"ok": True, "changed": False, "no": 27, "broadcasts": [{"broadcastId": "b1", "changed": False, "skip": "SELLER_EDITED"}]}
        st.reply()
        self.assertEqual([(e["changed"], e["skips"]) for e in st.kinds("LLM거두기결과")], [(False, ["SELLER_EDITED"])])
        self.assertEqual(st.srv.kinds(), ["tentative", "withdraw"])        # 한 번 묻고 그대로 둔다
        self.assertEqual(st.product(27)["state"], "임시")

    def test_number_the_seller_already_has_falls_back_to_a_plain_register(self):
        # 임시 등록이 "이미 있는 번호"(판매자가 손으로 먼저 등록)로 넘겨졌다 — 근거가 모이면 지금 방식으로 보낸다(서버는 그 번호를 바꾸지 않는다, R-2)
        st = TStage(self)
        st.srv.server.products[426] = {"no": 426, "price": 300000, "name": "판매자 값", "rid": None, "at": 0, "state": "판매"}
        st.show(0, 60, 426)
        st.hear(0, "426번 35만원 갑니다")
        self.assertEqual([(e["state"], e["broadcasts"]) for e in st.kinds("LLM임시결과")], [("exists", [{"changed": False}])])
        st.reply(row(0, 426, 350000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["tentative", "send"])
        self.assertEqual(st.product(426)["price"], 300000)

    def test_number_the_seller_deleted_is_reopened_only_by_a_plain_register(self):
        # 판매자가 지운 번호(skip CLOSED)는 임시 등록이 다시 열지 않는다 — 근거가 모인 뒤 observedAt이 있는 등록으로, 임시 등록과 다른 요청 번호로 보낸다
        st = TStage(self)
        st.srv.replies["tentative"] = {"ok": True, "changed": False, "no": 426, "broadcasts": [{"broadcastId": "b1", "changed": False, "duplicate": False, "skip": "CLOSED"}]}
        st.show(0, 60, 426)
        st.hear(0, "426번 35만원 갑니다")
        self.assertEqual(st.kinds("LLM임시결과")[0]["state"], "closed")
        st.reply(row(0, 426, 350000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["tentative", "send"])
        plain = st.srv.of("send")[0]
        self.assertNotIn("tentative", plain)
        self.assertIn("observedAt", plain)
        self.assertNotEqual(plain["requestId"], st.srv.of("tentative")[0]["requestId"])

    def test_target_number_taken_withdraws_the_misheard_tentative(self):
        st = TStage(self)
        st.show(0, 1, 353)
        st.say(0, "153번 청개구리 갑니다", row(0, 153, 250000, "청개구리", no_from="말"), end=1)
        st.say(2, "153번 진짜 예뻐요", row(0, 153, 250000, "청개구리", no_from="말"), end=3)
        st.srv.server.products[353] = {"no": 353, "price": 250000, "name": "판매자 값", "rid": None, "at": 0, "state": "판매"}   # 그사이 판매자가 353을 손으로 넣었다
        st.show(4, 12, 353)
        st.wait(1)
        st.worker.tick()
        st.worker.tick()
        self.assertEqual(st.srv.kinds(), ["tentative", "confirm", "withdraw"])
        self.assertEqual(st.kinds("LLM확정결과")[0]["skips"], ["TARGET_EXISTS"])
        self.assertIsNone(st.product(153))


class RestartTest(unittest.TestCase):
    def first_run(self):
        st = TStage(self)
        st.show(0, 40, 363)
        st.say(0, "363번 좋은 하루 만오", row(0, 363, 10000, None, no_from="말+화면"))
        return st

    def test_open_tentatives_are_read_from_the_events(self):
        st = self.first_run()
        rid = st.srv.of("tentative")[0]["requestId"]
        got = llm_live.prior_tentative(st.events)
        self.assertEqual([(t["no"], t["rid"], t["price"], t["ok"], t["rule"]) for t in got], [(363, rid, 10000, True, False)])
        # 확정·거두기가 끝났거나 서버에 올라가지 못한 것은 이어받지 않는다
        done = st.events + [{"kind": "LLM확정결과", "no": 363, "rid": rid, "changed": True}]
        self.assertEqual(llm_live.prior_tentative(done), [])
        self.assertEqual(llm_live.prior_tentative([e for e in st.events if e["kind"] != "LLM임시결과"]), [])
        failed = [dict(e, state="exists") if e["kind"] == "LLM임시결과" else e for e in st.events]
        self.assertEqual(llm_live.prior_tentative(failed), [])

    def test_restarted_worker_confirms_the_tentative_of_the_previous_run(self):
        old = self.first_run()
        rid = old.srv.of("tentative")[0]["requestId"]
        st = TStage(self, server=old.srv.server, prior_tent=llm_live.prior_tentative(old.events), prior=llm_live.prior_from_events(old.events))
        st.show(0, 10, 363)
        st.hear(0, "363번 만오천원 갑니다")
        self.assertEqual(st.srv.kinds(), [])                               # 같은 번호를 새로 임시 등록하지 않는다
        st.reply(row(0, 363, 15000, None, no_from="말+화면"))
        self.assertEqual(st.srv.kinds(), ["confirm"])
        self.assertEqual(st.srv.of("confirm")[0]["rid"], rid)              # 앞 실행의 등록을 그 요청 번호로 확정한다
        self.assertEqual((st.product(363)["price"], st.product(363)["state"]), (15000, "판매"))

    def test_prior_tentatives_are_found_in_sibling_folders(self):
        old = self.first_run()
        with tempfile.TemporaryDirectory() as base:
            before = Path(base) / "testvideo01-20261112_105438"
            before.mkdir()
            (before / "events.jsonl").write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in old.events), encoding="utf-8")
            st = TStage(self, server=old.srv.server, out=str(Path(base) / "testvideo01-20261112_111346"))
            self.assertEqual(sorted(st.worker.left), [363])
            self.assertEqual(st.worker.left[363]["rid"], old.srv.of("tentative")[0]["requestId"])

    def test_confirm_cut_off_by_the_restart_is_sent_again(self):
        # 앞 실행이 확정을 보냈다고 적었지만 서버 답을 적기 전에 죽었다 — 같은 요청 번호·같은 값으로 다시 보낸다(서버는 한 번만 받는다)
        old = TStage(self)
        old.show(0, 10, 316)
        old.hear(0, "316번 20만원 갑니다")
        rid = old.srv.of("tentative")[0]["requestId"]
        events = old.events + [{"kind": "LLM등록", "no": 316, "price": 200000, "name": None, "rid": rid, "via": "확정", "sent": True}]
        old.gate.set()
        st = TStage(self, server=old.srv.server, prior_tent=llm_live.prior_tentative(events), prior=llm_live.prior_from_events(events))
        st.worker.tick()
        st.worker.tick()
        self.assertEqual(st.srv.kinds(), ["confirm"])
        self.assertEqual((st.srv.of("confirm")[0]["rid"], st.srv.of("confirm")[0]["price"]), (rid, 200000))
        self.assertEqual(st.product(316)["state"], "판매")
        self.assertEqual([e["changed"] for e in st.kinds("LLM확정결과")], [True])

    def second_run(self):
        """앞 실행 둘: 316번은 규칙만으로 올리고 LLM 답을 받지 못했고, 363번은 LLM 답이 갈려 가격을 못 정했다. 둘 다 번호 근거(말한 번호)는 섰다"""
        old = TStage(self)
        old.show(0, 10, 316)
        old.hear(0, "316번 20만원 갑니다")
        old.gate.set()
        kept = self.first_run()
        prior = llm_live.prior_tentative(old.events) + llm_live.prior_tentative(kept.events)
        old.srv.server.products.update(kept.srv.server.products)
        st = TStage(self, server=old.srv.server, prior_tent=prior)
        st.worker.tick()                                                   # 이번 실행이 돌기 시작한 때부터 잰다
        st.wait(llm_live.HOLD_MAX - 5)
        self.assertEqual((st.srv.calls, st.kinds("LLM임시남김")), ([], []))
        st.wait(6)
        st.worker.tick()
        return st

    def test_tentatives_of_the_previous_run_are_left_for_the_seller_after_the_hold(self):
        # 이번 실행에서 답이 다시 모이지 않아도 번호 근거가 섰던 임시 등록은 거두지 않는다(판매자가 확정). 이번 실행의 LLM은 앞 실행의 줄을 볼 수 없다
        st = self.second_run()
        self.assertEqual(st.srv.calls, [])
        self.assertEqual(sorted(e["no"] for e in st.kinds("LLM임시남김")), [316, 363])
        self.assertEqual((st.product(316)["state"], st.product(363)["state"]), ("임시", "임시"))
        st.show(300, 310, 316)                                             # 뒤에 그 번호의 답이 모이면 이어서 확정한다
        st.say(300, "자 316 20만원", row(0, 316, 200000, None, no_from="말+화면"))
        self.assertEqual([(k, b["no"]) for k, _, b in st.srv.calls], [("confirm", 316)])

    def test_keep_switch_off_withdraws_the_tentatives_of_the_previous_run(self):
        with patch.object(llm_live, "TENT_KEEP", False):
            st = self.second_run()
            self.assertEqual(sorted((k, b["no"]) for k, _, b in st.srv.calls), [("withdraw", 316), ("withdraw", 363)])
            self.assertEqual((st.product(316), st.product(363)), (None, None))

    def test_switch_off_does_not_adopt(self):
        old = self.first_run()
        with patch.object(llm_live, "TENTATIVE", False):
            st = TStage(self, server=old.srv.server, prior_tent=llm_live.prior_tentative(old.events))
            self.assertEqual((st.worker.left, st.worker.tents), ({}, {}))


class FakeServerTest(unittest.TestCase):
    """재현 도구의 가짜 서버가 계약서 2절의 답을 낸다"""

    def test_register_confirm_withdraw(self):
        s = replay_live.FakeServer()
        up = s.apply("tentative", 1, {"no": 153, "price": 250000, "name": "", "requestId": "screen-v-153-1"})
        self.assertEqual((up["changed"], up["tentative"], s.products[153]["state"]), (True, True, "임시"))
        self.assertFalse(s.apply("tentative", 2, {"no": 153, "price": 1, "requestId": "screen-v-153-2"})["changed"])
        self.assertFalse(s.apply("send", 2, {"no": 153, "price": 1, "requestId": "screen-v-153-3"})["changed"])        # 확인 중이어도 다시 등록은 아무 일도 없다
        self.assertEqual(s.apply("confirm", 3, {"no": 153, "rid": "screen-v-153-9"})["broadcasts"][0]["skip"], "OTHER_REGISTER")
        s.apply("send", 3, {"no": 353, "price": 1, "requestId": "screen-v-353-1"})
        self.assertEqual(s.apply("confirm", 4, {"no": 153, "rid": "screen-v-153-1", "to": 353})["broadcasts"][0]["skip"], "TARGET_EXISTS")
        self.assertTrue(s.apply("confirm", 5, {"no": 153, "rid": "screen-v-153-1", "to": 354, "price": 200000, "name": "청개구리"})["changed"])
        self.assertEqual((s.products[354]["price"], s.products[354]["name"], s.products[354]["state"]), (200000, "청개구리", "판매"))
        self.assertNotIn(153, s.products)
        self.assertEqual(s.apply("confirm", 6, {"no": 354, "rid": "screen-v-153-1"})["broadcasts"][0]["skip"], "NOT_TENTATIVE")
        self.assertEqual(s.apply("withdraw", 6, {"no": 153, "rid": "screen-v-153-1"})["broadcasts"][0]["skip"], "NO_PRODUCT")
        s.apply("tentative", 7, {"no": 27, "price": 50000, "requestId": "screen-v-27-1"})
        self.assertTrue(s.apply("withdraw", 8, {"no": 27, "rid": "screen-v-27-1"})["changed"])
        self.assertNotIn(27, s.products)


if __name__ == "__main__":
    unittest.main()
