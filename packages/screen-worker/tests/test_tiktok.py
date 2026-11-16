# 틱톡 라이브 읽기(D-SCR-TT-01) 시험. 실제 틱톡은 부르지 않는다 — 방 정보는 가짜 JSON, 여는 함수는 가짜로 바꾼다.
import io
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest import mock

from sw import __main__ as main
from sw import post, serve, tiktok


def room(status=2, streams=None):
    streams = {"hd": {"main": {"hls": "https://pull-hls.example/hd/index.m3u8", "flv": "https://pull.example/hd.flv"}},
               "ao": {"main": {"hls": "", "flv": "https://pull.example/ao.flv"}}} if streams is None else streams
    return {"data": {"user": {"status": status}, "liveRoom": {"status": status, "streamData": {"pull_data": {"stream_data": json.dumps({"data": streams})}}}}}


class TiktokTest(unittest.TestCase):
    def test_key_of(self):
        self.assertEqual(tiktok.key_of("https://www.tiktok.com/@bit_succulent_farm/live"), "@bit_succulent_farm")
        self.assertEqual(tiktok.key_of("https://m.tiktok.com/@Bit.Farm/live?lang=ko"), "@bit.farm")
        self.assertEqual(tiktok.key_of("@bit_succulent_farm"), "@bit_succulent_farm")
        for bad in ("https://www.youtube.com/watch?v=sA_V-s07VjE", "sA_V-s07VjE", "@a", "https://www.tiktok.com/@x_y/video/1", "", None):
            self.assertIsNone(tiktok.key_of(bad), bad)

    def test_pick_prefers_hd_hls_and_skips_audio_only(self):
        self.assertEqual(tiktok.pick(room()), "https://pull.example/hd.flv")   # FLV 먼저(HLS는 ffmpeg가 5초 뒤 멈춤)
        only_flv = room(streams={"ao": {"main": {"flv": "https://pull.example/ao.flv"}}, "ld": {"main": {"hls": "", "flv": "https://pull.example/ld.flv"}}})
        self.assertEqual(tiktok.pick(only_flv), "https://pull.example/ld.flv")
        only_hls = room(streams={"sd": {"main": {"hls": "https://pull-hls.example/sd/index.m3u8", "flv": ""}}})
        self.assertEqual(tiktok.pick(only_hls), "https://pull-hls.example/sd/index.m3u8")
        with self.assertRaises(tiktok.NotLive):
            tiktok.pick(room(status=4))
        with self.assertRaises(tiktok.NotLive):
            tiktok.pick(room(streams={"ao": {"main": {"flv": "https://pull.example/ao.flv"}}}))

    def test_resolve_reads_room_and_fails_softly(self):
        seen = []

        def opener(req, timeout):
            seen.append(req.full_url)
            return io.BytesIO(json.dumps(room()).encode())

        self.assertEqual(tiktok.resolve("@bit_succulent_farm", opener=opener), ["https://pull.example/hd.flv"])
        self.assertTrue(seen[0].endswith("uniqueId=bit_succulent_farm"))

        def broken(req, timeout):
            raise OSError("down")

        with self.assertRaises(tiktok.NotLive):
            tiktok.resolve("@bit_succulent_farm", opener=broken)

    def test_main_resolve_tiktok_is_live_and_not_live_exits_like_youtube(self):
        with mock.patch.object(tiktok, "resolve", return_value=["https://pull-hls.example/hd/index.m3u8"]):
            self.assertEqual(main.resolve("https://www.tiktok.com/@bit_succulent_farm/live"), (["https://pull-hls.example/hd/index.m3u8"], True))
        with mock.patch.object(tiktok, "resolve", side_effect=tiktok.NotLive("아님")):
            with self.assertRaises(subprocess.CalledProcessError):
                main.resolve("https://www.tiktok.com/@bit_succulent_farm/live")

    def test_live_key_and_request_ids(self):
        self.assertTrue(post.VIDEO_RE.match("@bit_succulent_farm"))
        self.assertTrue(post.VIDEO_RE.match("sA_V-s07VjE"))
        self.assertFalse(post.VIDEO_RE.match("@Bit_Farm"))
        self.assertEqual(post.video_id("https://www.tiktok.com/@bit_succulent_farm/live"), "@bit_succulent_farm")
        self.assertEqual(post.video_id("https://www.youtube.com/watch?v=sA_V-s07VjE"), "sA_V-s07VjE")
        # 서버 요청 번호(screen-[A-Za-z0-9_.:-])에 @가 없어 틱톡은 tt.아이디로
        self.assertEqual(post.rid_key("@bit_succulent_farm"), "tt.bit_succulent_farm")
        self.assertEqual(post.rid_key("sA_V-s07VjE"), "sA_V-s07VjE")
        body = post.make_body("@bit_succulent_farm", 7, 30000, "청개구리", "칠번 삼만원", 0.9)
        self.assertEqual(body["videoId"], "@bit_succulent_farm")
        self.assertRegex(body["requestId"], r"^screen-[A-Za-z0-9_.:-]{1,100}$")

    def test_serve_command_uses_tiktok_live_url(self):
        mgr = serve.Serve.__new__(serve.Serve)
        mgr.a = SimpleNamespace(worker_cmd="echo {url} {video_id}")
        self.assertEqual(mgr.command("@bit_succulent_farm", "/tmp/o"), ["echo", "https://www.tiktok.com/@bit_succulent_farm/live", "@bit_succulent_farm"])
        self.assertEqual(mgr.command("sA_V-s07VjE", "/tmp/o"), ["echo", "https://www.youtube.com/watch?v=sA_V-s07VjE", "sA_V-s07VjE"])


if __name__ == "__main__":
    unittest.main()
