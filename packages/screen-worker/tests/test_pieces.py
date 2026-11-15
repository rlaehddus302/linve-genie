# 개수 보내기 시험 (D-PIECES-01, 사용자 메모 11-13 "66 채홍 3개인데 개수도 인식해서"): 일꾼이 품종 이름에서 떼어 낸 개수를 등록에 `pieces`로 싣는다.
# 서버가 이 항목을 모르면(능력 표에 없거나 능력 묻기 입구가 없는 옛 서버) 빼고 보낸다 — 모르는 항목이 있으면 서버가 400으로 거절하므로.
# 서버는 가짜 HTTP다. 품종 이름은 흔한 이름만.
import unittest

from sw import post, variety
from test_tentative import Http, PosterCase, caps

OK = (200, {"ok": True, "changed": True, "broadcasts": [{"changed": True}]})


class PiecesOfTest(unittest.TestCase):
    def test_qty_words_become_whole_numbers_two_and_up(self):
        for qty, want in [("3개", 3), ("12개", 12), ("두포기", 2), ("5촉", 5), ("세개", 3), (4, 4), ("99개", 99)]:
            with self.subTest(qty=qty):
                self.assertEqual(post.pieces_of(qty), want)
        for qty in ["", None, "1개", "한개", "통째", "통으로", "100개", 0, True, "개"]:
            with self.subTest(qty=qty):
                self.assertIsNone(post.pieces_of(qty))

    def test_split_parts_qty_goes_into_the_body(self):
        name, _, _, qty = variety.split_parts("채홍 3개")
        self.assertEqual((name, qty), ("채홍", "3개"))
        body = post.make_body("abcdefghijk", 66, 20000, name, pieces=qty)
        self.assertEqual(body["pieces"], 3)
        self.assertEqual(body["name"], "채홍")
        self.assertNotIn("pieces", post.make_body("abcdefghijk", 66, 20000, "채홍", pieces=""))
        self.assertNotIn("pieces", post.make_body("abcdefghijk", 66, 20000, "채홍"))


class PiecesFitTest(PosterCase, unittest.TestCase):
    def test_old_server_without_capabilities_gets_the_body_without_pieces(self):
        http = Http(register=OK)
        poster = self.poster(http)
        self.assertTrue(poster.refresh())
        self.assertIsNone(poster.caps)
        body = post.make_body("abcdefghijk", 66, 20000, "채홍", pieces="3개")
        fitted = poster._fit("register", body)
        self.assertNotIn("pieces", fitted)
        self.assertEqual({k: v for k, v in body.items() if k != "pieces"}, fitted)
        self.assertIn("pieces", body)                                      # 원래 본문은 그대로

    def test_server_that_knows_pieces_gets_them(self):
        table = caps()
        table["endpoints"]["register"]["fields"].append("pieces")
        http = Http(capabilities=(200, table), register=OK)
        poster = self.poster(http)
        poster.refresh()
        box = []
        poster.send(post.make_body("abcdefghijk", 66, 20000, "채홍", pieces="3개"), on_result=box.append)
        self.wait(box)
        self.assertEqual(dict(http.seen)["register"]["pieces"], 3)

    def test_server_that_does_not_know_pieces_gets_the_register_without_them(self):
        http = Http(capabilities=(200, caps()), register=OK)               # 개수 항목이 없는 서버
        poster = self.poster(http)
        poster.refresh()
        box = []
        poster.send(post.make_body("abcdefghijk", 66, 20000, "채홍", pieces="3개"), on_result=box.append)
        self.wait(box)
        sent = dict(http.seen)["register"]
        self.assertNotIn("pieces", sent)                                   # 빼고 보낸다 — 등록은 그대로 된다
        self.assertEqual(sent["name"], "채홍")
        self.assertTrue(box[0].get("ok"))


if __name__ == "__main__":
    unittest.main()
