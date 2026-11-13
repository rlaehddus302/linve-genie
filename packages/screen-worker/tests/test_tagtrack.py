import unittest

from sw import tagtrack as T

W, H = 0.10, 0.08  # 지어낸 딱지 크기(화면 대비)


def obs(x, y, *reads, w=W, h=H):
    return T.Obs(x, y, w, h, tuple(reads))


def run(frames, params=None, tracker=None):
    """frames: [(시각, [Obs, …]), …] → (추적기, 사건 목록)"""
    tr = tracker or T.TagTracker(params or T.Params())
    out = []
    for t, o in frames:
        out += tr.feed(t, o)
    return tr, out


def kinds(events):
    return [e["kind"] for e in events]


def steady(number, x, y, t0, n, fps=5.0, dx=0.0):
    """한 자리에서(또는 dx씩 움직이며) n장 동안 같은 번호로 읽힌 딱지"""
    return [(round(t0 + k / fps, 3), [obs(x + dx * k, y, number)]) for k in range(n)]


class ReadCompareTest(unittest.TestCase):
    def test_partial_is_a_shorter_read_with_digits_dropped_in_order(self):
        self.assertTrue(T.is_partial("38", "388"))
        self.assertTrue(T.is_partial("2", "372"))
        self.assertTrue(T.is_partial("32", "372"))
        self.assertFalse(T.is_partial("83", "388"))   # 순서가 뒤집힘
        self.assertFalse(T.is_partial("388", "388"))  # 같은 번호는 빠진 읽기가 아님
        self.assertFalse(T.is_partial("", "388"))

    def test_confusable_needs_same_length_and_only_listed_digit_pairs(self):
        self.assertTrue(T.is_confusable("11", "17"))
        self.assertTrue(T.is_confusable("371", "377"))
        self.assertFalse(T.is_confusable("418", "419"))
        self.assertFalse(T.is_confusable("17", "117"))
        self.assertFalse(T.is_confusable("17", "17"))

    def test_relation_between_reads_and_a_tag_number(self):
        self.assertEqual(T.relation(("419",), "419"), "same")
        self.assertEqual(T.relation(("41",), "419"), "near")
        self.assertEqual(T.relation(("17",), "11"), "near")
        self.assertEqual(T.relation(("350",), "419"), "conflict")
        self.assertEqual(T.relation((), "419"), "free")
        self.assertEqual(T.relation(("350",), None), "free")


class VoteTest(unittest.TestCase):
    def test_majority_wins(self):
        v = T.vote({"17": 12, "11": 3})
        self.assertEqual((v.number, v.full, v.total), ("17", 12, 15))
        self.assertAlmostEqual(v.share, 0.8)

    def test_dropped_digit_reads_support_the_longer_number(self):
        v = T.vote({"388": 5, "38": 3})
        self.assertEqual((v.number, v.full, v.partial), ("388", 5, 3))
        self.assertAlmostEqual(v.share, 1.0)  # 자릿수 빠진 읽기는 비율에서 뺀다
        self.assertEqual(T.vote({"388": 4, "38": 5}).number, "388")

    def test_one_stray_longer_read_does_not_beat_a_real_short_number(self):
        self.assertEqual(T.vote({"38": 10, "388": 1}).number, "38")

    def test_fixed_digit_count_ignores_other_lengths(self):
        v = T.vote({"38": 10, "388": 1}, digits=3)
        self.assertEqual((v.number, v.full, v.partial), ("388", 1, 10))
        self.assertIsNone(T.vote({"38": 10}, digits=3).number)

    def test_no_reads_no_number(self):
        self.assertIsNone(T.vote({}).number)

    def test_confirm_needs_enough_reads_and_share(self):
        p = T.Params()
        self.assertFalse(T.confirmed(T.vote({"419": 2}), p))
        self.assertTrue(T.confirmed(T.vote({"419": 3}), p))
        self.assertFalse(T.confirmed(T.vote({"419": 3, "350": 3}), p))


class SameFrameTest(unittest.TestCase):
    def test_two_reads_of_one_tag_in_a_frame_become_one_candidate(self):
        merged = T.merge_same_frame([obs(0.30, 0.30, "419"), obs(0.31, 0.305, "419"), obs(0.70, 0.60, "350")])
        self.assertEqual(len(merged), 2)
        self.assertEqual(sorted(len(m.reads) for m in merged), [1, 2])

    def test_same_read_twice_in_one_frame_is_one_vote(self):
        # 전체 화면 읽기와 확대 읽기가 둘 다 "5"로 읽어도 한 장은 한 표: 두 장으로는 확정되지 않는다
        tr, ev = run([(0.0, [obs(0.3, 0.3, "5"), obs(0.3, 0.3, "5")]), (0.2, [obs(0.3, 0.3, "5"), obs(0.3, 0.3, "5")])])
        self.assertNotIn(T.CONFIRM, kinds(ev))
        self.assertEqual(dict(tr.state.tracks[0].reads), {"5": 2})


class TrackTest(unittest.TestCase):
    def test_moving_tag_is_one_tag_announced_then_confirmed(self):
        tr, ev = run(steady("419", 0.20, 0.30, 0.0, 10, dx=0.02))
        self.assertEqual(kinds(ev), [T.NEW, T.CONFIRM])
        new, conf = ev
        self.assertEqual(new["t"], 0.2)            # 두 번째 장면에서 알림
        self.assertEqual(new["since"], 0.0)        # 처음 보인 시각을 같이 준다
        self.assertEqual((conf["no"], conf["t"], conf["full"], conf["share"]), ("419", 0.4, 3, 1.0))
        self.assertFalse(conf["again"])
        self.assertEqual(len(tr.state.tracks), 1)
        self.assertEqual(tr.state.tracks[0].seen, 10)

    def test_single_frame_candidate_makes_no_event(self):
        _, ev = run([(0.0, [obs(0.5, 0.5, "88")]), (0.2, []), (0.4, []), (5.0, [])])
        self.assertEqual(ev, [])

    def test_unread_candidates_never_confirm(self):
        _, ev = run([(k / 5, [obs(0.5, 0.5)]) for k in range(20)])
        self.assertEqual(kinds(ev), [T.NEW])

    def test_early_misread_is_corrected_by_later_reads(self):
        frames = steady("11", 0.4, 0.4, 0.0, 3) + steady("17", 0.4, 0.4, 0.6, 6)
        tr, ev = run(frames)
        self.assertEqual(kinds(ev), [T.NEW, T.CONFIRM, T.CORRECT])
        self.assertEqual(ev[1]["no"], "11")
        fix = ev[2]
        self.assertEqual((fix["was"], fix["no"], fix["tag"]), ("11", "17", ev[1]["tag"]))
        self.assertEqual(fix["t"], 1.2)  # 17이 11보다 한 장 더 많이 읽힌 순간(4 대 3)
        self.assertEqual(list(tr.products()), ["17"])
        self.assertEqual(tr.products()["17"]["was"], ["11"])

    def test_dropped_digit_reads_do_not_confirm_a_short_number_once_full_reads_come(self):
        # 372를 처음 두 장은 "2"로만 읽음 → 확정 안 됨. 뒤이어 372로 읽히면 372로 확정
        frames = steady("2", 0.4, 0.4, 0.0, 2) + steady("372", 0.4, 0.4, 0.4, 3)
        _, ev = run(frames)
        self.assertEqual([(e["kind"], e["no"]) for e in ev], [(T.NEW, None), (T.CONFIRM, "372")])

    def test_short_misread_confirmed_first_is_corrected_to_the_full_number(self):
        frames = steady("38", 0.4, 0.4, 0.0, 3) + steady("388", 0.4, 0.4, 0.6, 3)
        _, ev = run(frames)
        self.assertEqual([(e["kind"], e["no"]) for e in ev], [(T.NEW, None), (T.CONFIRM, "38"), (T.CORRECT, "388")])

    def test_three_digit_rule_never_confirms_a_dropped_digit_read(self):
        frames = steady("38", 0.4, 0.4, 0.0, 6) + steady("388", 0.4, 0.4, 1.2, 3)
        _, ev = run(frames, T.Params(digits=3))
        self.assertEqual([(e["kind"], e["no"]) for e in ev], [(T.NEW, None), (T.CONFIRM, "388")])

    def test_two_tags_on_screen_are_tracked_separately(self):
        frames = [(k / 5, [obs(0.20 + 0.01 * k, 0.30, "418"), obs(0.60 + 0.01 * k, 0.35, "419")]) for k in range(6)]
        tr, ev = run(frames)
        self.assertEqual(sorted(e["no"] for e in ev if e["kind"] == T.CONFIRM), ["418", "419"])
        self.assertEqual(len({e["tag"] for e in ev}), 2)
        self.assertNotIn(T.CORRECT, kinds(ev))

    def test_new_tag_with_new_number_is_a_new_product_and_old_one_goes(self):
        frames = steady("385", 0.3, 0.3, 0.0, 6) + steady("393", 0.6, 0.5, 2.0, 12)
        tr, ev = run(frames)
        self.assertEqual([(e["kind"], e["no"]) for e in ev],
                         [(T.NEW, None), (T.CONFIRM, "385"), (T.NEW, None), (T.CONFIRM, "393"), (T.GONE, "385")])
        gone = ev[-1]
        self.assertEqual(gone["last"], 1.0)
        self.assertEqual(gone["full"], 6)
        self.assertEqual(sorted(tr.products()), ["385", "393"])

    def test_tag_that_comes_back_with_the_same_number_is_the_same_product(self):
        frames = steady("385", 0.3, 0.3, 0.0, 6) + [(5.0, [])] + steady("385", 0.7, 0.6, 20.0, 5)
        tr, ev = run(frames)
        self.assertEqual([(e["kind"], e["no"]) for e in ev],
                         [(T.NEW, None), (T.CONFIRM, "385"), (T.GONE, "385"), (T.NEW, None), (T.AGAIN, "385")])
        again = ev[-1]
        self.assertEqual(again["tag"], ev[1]["tag"])   # 옛 딱지 그대로
        self.assertEqual(again["merged"], ev[3]["tag"])  # "새 딱지"로 알렸던 임시 딱지가 이 상품이었다
        self.assertTrue(again["was_gone"])
        self.assertEqual(len(tr.products()), 1)
        self.assertEqual(tr.products()["385"]["again"], 1)
        self.assertEqual([k.number for k in tr.state.tracks], ["385"])
        self.assertEqual(dict(tr.state.tracks[0].reads), {"385": 11})  # 읽기도 합친다

    def test_number_returning_after_the_rejoin_window_is_a_new_introduction(self):
        p = T.Params(rejoin_within=60.0)
        frames = steady("385", 0.3, 0.3, 0.0, 6) + [(5.0, [])] + steady("385", 0.3, 0.3, 200.0, 5)
        _, ev = run(frames, p)
        confirms = [e for e in ev if e["kind"] == T.CONFIRM]
        self.assertEqual(len(confirms), 2)
        self.assertNotIn(T.AGAIN, kinds(ev))

    def test_confirmed_tag_is_relinked_by_number_after_a_big_camera_jump(self):
        # 초당 1장: 한 장 사이에 화면 반대쪽으로 갔어도 확정 번호가 그대로 읽히면 같은 딱지
        frames = [(float(k), [obs(0.10, 0.20, "426")]) for k in range(3)] + [(3.0, [obs(0.75, 0.70, "426")]), (4.0, [obs(0.72, 0.68, "426")])]
        tr, ev = run(frames)
        self.assertEqual(kinds(ev), [T.NEW, T.CONFIRM])
        self.assertEqual(len(tr.state.tracks), 1)
        self.assertEqual(tr.state.tracks[0].seen, 5)

    def test_different_number_far_away_is_not_joined_to_a_confirmed_tag(self):
        frames = steady("418", 0.2, 0.3, 0.0, 5) + [(1.0, [obs(0.6, 0.3, "419")])]
        tr, _ = run(frames)
        self.assertEqual(sorted(tuple(dict(k.reads)) for k in tr.state.tracks), [("418",), ("419",)])

    def test_different_read_at_the_same_spot_next_frame_stays_in_the_same_tag(self):
        # 초당 5장에서 같은 자리의 한 장짜리 헛읽기(372 → 322)는 같은 딱지의 표로 들어가 다수결에서 진다
        frames = steady("372", 0.4, 0.4, 0.0, 4) + [(0.8, [obs(0.4, 0.4, "322")])] + steady("372", 0.4, 0.4, 1.0, 3)
        tr, ev = run(frames)
        self.assertEqual(kinds(ev), [T.NEW, T.CONFIRM])
        self.assertEqual(dict(tr.state.tracks[0].reads), {"322": 1, "372": 7})

    def test_same_number_seen_twice_at_once_waits_instead_of_merging(self):
        # 419가 확정돼 보이는 동안 옆 딱지도 419로 읽히면(헛읽기) 합치지도 새 상품으로 내지도 않는다
        frames = [(k / 5, [obs(0.2, 0.3, "419")]) for k in range(4)]
        frames += [(0.8 + k / 5, [obs(0.2, 0.3, "419"), obs(0.65, 0.3, "419")]) for k in range(4)]
        tr, ev = run(frames)
        self.assertEqual(sum(e["kind"] == T.CONFIRM for e in ev), 1)
        self.assertNotIn(T.AGAIN, kinds(ev))
        self.assertEqual(len(tr.state.tracks), 2)

    def test_text_that_never_moves_is_background(self):
        frames = [(float(k), [obs(0.6, 0.05, "010")]) for k in range(100)]
        _, ev = run(frames)
        self.assertIn(T.STATIC, kinds(ev))
        self.assertEqual([e["t"] for e in ev if e["kind"] == T.STATIC], [90.0])

    def test_handheld_tag_is_not_background(self):
        frames = [(float(k), [obs(0.4 + 0.03 * (k % 3), 0.4, "419")]) for k in range(100)]
        _, ev = run(frames)
        self.assertNotIn(T.STATIC, kinds(ev))

    def test_front_is_the_largest_tag_on_screen(self):
        tr, _ = run([(k / 5, [obs(0.2, 0.3, "418", w=0.05, h=0.04), obs(0.6, 0.4, "419", w=0.15, h=0.12)]) for k in range(4)])
        self.assertEqual(tr.front(0.6).number, "419")
        self.assertIsNone(tr.front(30.0))

    def test_finish_closes_open_tags(self):
        tr, _ = run(steady("419", 0.3, 0.3, 0.0, 5))
        ev = tr.finish(0.8)
        self.assertEqual([(e["kind"], e["no"]) for e in ev], [(T.GONE, "419")])


class PureTest(unittest.TestCase):
    def test_step_does_not_change_its_input_state(self):
        st = T.State()
        for t, o in steady("419", 0.3, 0.3, 0.0, 4):
            st, _ = T.step(st, t, o)
        before = (st.tracks, st.next_id, st.owner)
        frame = [obs(0.3, 0.3, "419"), obs(0.7, 0.7, "350")]
        a = T.step(st, 0.8, frame)
        b = T.step(st, 0.8, frame)
        self.assertEqual((st.tracks, st.next_id, st.owner), before)
        self.assertEqual(a, b)  # 같은 입력이면 같은 결과(시계·난수 없음)

    def test_products_summary_follows_events_only(self):
        frames = steady("11", 0.4, 0.4, 0.0, 3) + steady("17", 0.4, 0.4, 0.6, 6) + steady("393", 0.7, 0.6, 3.0, 4)
        tr, ev = run(frames)
        tr.finish(4.0)
        pr = T.products(tr.events)
        self.assertEqual(sorted(pr), ["17", "393"])
        self.assertEqual(pr["17"]["first"], 0.0)
        self.assertEqual(pr["17"]["confirmed"], 0.4)
        self.assertEqual(pr["17"]["corrected"], 1.2)
        self.assertEqual(pr["393"]["confirmed"], 3.4)


if __name__ == "__main__":
    unittest.main()
