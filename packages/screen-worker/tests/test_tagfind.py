import unittest

import cv2
import numpy as np

from sw import tagfind as F


def scene(seed=7):
    """지어낸 장면: 얼룩덜룩한 자갈 바탕(흰 자갈·어두운 그림자)"""
    rng = np.random.default_rng(seed)
    img = np.full((720, 1280, 3), 120, np.uint8)
    for _ in range(900):
        x, y = int(rng.integers(0, 1280)), int(rng.integers(0, 720))
        r = int(rng.integers(4, 12))
        c = int(rng.integers(40, 250))
        cv2.circle(img, (x, y), r, (c, c, max(0, c - 15)), -1)
    return img


def put_tag(img, text, cx, cy, angle=0.0, scale=2.0, ink=(20, 20, 20)):
    """흰 딱지에 검은 숫자를 찍어 (cx, cy)에 angle도 기울여 붙인다"""
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 5)
    w, h = tw + 50, th + 50
    tag = np.full((h, w, 3), 238, np.uint8)
    cv2.putText(tag, text, (25, h - 25), cv2.FONT_HERSHEY_SIMPLEX, scale, ink, 5, cv2.LINE_AA)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.0)
    M[0, 2] += cx - w / 2
    M[1, 2] += cy - h / 2
    mask = cv2.warpAffine(np.full((h, w), 255, np.uint8), M, (img.shape[1], img.shape[0]))
    warped = cv2.warpAffine(tag, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR)
    img[mask > 127] = warped[mask > 127]
    return img


def covers(tag, cx, cy, W=1280, H=720):
    return tag.x * W <= cx <= (tag.x + tag.w) * W and tag.y * H <= cy <= (tag.y + tag.h) * H


class FindTagsTest(unittest.TestCase):
    def test_finds_a_white_tag_with_three_digits_first(self):
        img = put_tag(scene(), "419", 400, 300)
        tags = F.find_tags(img)
        self.assertTrue(tags)
        self.assertTrue(covers(tags[0], 400, 300))
        self.assertEqual(tags[0].chars, 3)

    def test_finds_tilted_and_upright_standing_tags(self):
        for angle in (-30, 25, 70):
            with self.subTest(angle=angle):
                img = put_tag(scene(), "305", 640, 360, angle=angle)
                tags = [t for t in F.find_tags(img) if covers(t, 640, 360)]
                self.assertTrue(tags)
                self.assertGreaterEqual(tags[0].chars, 2)

    def test_two_tags_are_two_candidates(self):
        img = put_tag(put_tag(scene(), "418", 300, 250), "419", 800, 450)
        tags = F.find_tags(img)
        self.assertTrue(any(covers(t, 300, 250) for t in tags))
        self.assertTrue(any(covers(t, 800, 450) for t in tags))

    def test_faint_print_is_found_by_relative_darkness(self):
        img = put_tag(scene(), "361", 500, 300, ink=(120, 120, 120))  # 옅게 찍힌 회색 숫자
        self.assertTrue(any(covers(t, 500, 300) and t.chars == 3 for t in F.find_tags(img)))

    def test_long_banner_text_is_not_a_tag(self):
        img = scene()
        cv2.rectangle(img, (500, 60), (1260, 130), (255, 255, 255), -1)
        cv2.putText(img, "010 7532 4118 0123", (510, 118), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 5, cv2.LINE_AA)
        self.assertFalse([t for t in F.find_tags(img) if covers(t, 880, 95) and t.chars >= 2])

    def test_gravel_alone_gives_no_multi_digit_candidate_with_high_score(self):
        tags = [t for t in F.find_tags(scene()) if t.chars >= 2 and t.score >= 0.7]
        self.assertEqual(tags, [])

    def test_crop_is_deskewed_to_requested_height(self):
        img = put_tag(scene(), "305", 640, 360, angle=25)
        tag = [t for t in F.find_tags(img) if covers(t, 640, 360)][0]
        crop = F.crop_tag(img, tag, pad=0.2, height=48)
        self.assertEqual(crop.shape[0], 48)
        self.assertGreater(crop.shape[1], 48)          # 글줄이 가로로 누웠다
        self.assertLess(abs(abs(tag.rect[2]) - 25), 6)  # 기울기를 잰 값이 붙인 각도와 비슷하다
        # 잘라 낸 조각의 가운데 줄에는 글자(어두운 점)와 종이(밝은 점)가 다 있다
        row = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)[24]
        self.assertLess(int(row.min()), 90)
        self.assertGreater(int(row.max()), 200)


    def test_crop_grows_to_take_in_a_digit_the_finder_missed(self):
        # 찾기가 "421"의 뒤 두 숫자만 묶었을 때: 넓히기를 켜면 바로 옆의 첫 숫자까지 조각에 들어온다
        img = put_tag(scene(), "421", 640, 360)
        tag = [t for t in F.find_tags(img) if covers(t, 640, 360)][0]
        (cx, cy), (gw, gh), ang = tag.rect
        part = F.Tag(tag.x, tag.y, tag.w, tag.h, tag.score, ((cx + gw / 6, cy), (gw * 2 / 3, gh), ang), 2)
        tight = F.crop_tag(img, part, pad=0.12, height=48, extend=False)
        grown = F.crop_tag(img, part, pad=0.12, height=48, extend=True)
        self.assertGreater(grown.shape[1], tight.shape[1] + 15)
        whole = F.crop_tag(img, tag, pad=0.12, height=48, extend=True)
        self.assertLess(abs(whole.shape[1] - F.crop_tag(img, tag, pad=0.12, height=48, extend=False).shape[1]), 3)  # 온전한 묶음은 그대로


class StaticMaskTest(unittest.TestCase):
    def test_text_fixed_on_screen_is_learned_and_removed(self):
        mask = F.StaticMask(horizon=20)
        last = None
        for k in range(30):
            img = put_tag(scene(seed=k), "419", 300 + 15 * k, 400)      # 번호표는 움직인다
            cv2.rectangle(img, (800, 50), (1000, 130), (255, 255, 255), -1)  # 띠는 그 자리
            cv2.putText(img, "118", (820, 115), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 5, cv2.LINE_AA)
            mask.update(img)
            last = img
        self.assertIsNotNone(mask.mask())
        tags = F.find_tags(last, ignore=mask.mask())
        self.assertFalse(any(covers(t, 900, 90) for t in tags))
        self.assertTrue(any(covers(t, 300 + 15 * 29, 400) for t in tags))

    def test_mask_is_not_used_before_it_has_seen_enough_frames(self):
        mask = F.StaticMask(horizon=20)
        for k in range(5):
            mask.update(scene(seed=k))
        self.assertIsNone(mask.mask())


if __name__ == "__main__":
    unittest.main()
