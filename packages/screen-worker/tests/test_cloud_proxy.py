# 클라우드 일꾼: 유튜브 영상만 Mac mini 프록시를 거친다(D-SCR-CLOUD-01)
import importlib
import unittest
from unittest import mock


class YoutubeProxyTest(unittest.TestCase):
    def load(self, proxy):
        with mock.patch.dict("os.environ", {"LG_YT_PROXY": proxy}):
            import sw.__main__ as m
            return importlib.reload(m)

    def test_only_youtube_hosts(self):
        m = self.load("")
        self.assertTrue(m._is_youtube_media("https://rr3---sn-abc.googlevideo.com/videoplayback?x=1"))
        self.assertTrue(m._is_youtube_media("https://manifest.googlevideo.com/api/manifest/hls_playlist/x"))
        self.assertTrue(m._is_youtube_media("https://www.youtube.com/watch?v=abc"))
        self.assertFalse(m._is_youtube_media("https://pull-hls-f16.tiktokcdn.com/stage/stream.m3u8"))
        self.assertFalse(m._is_youtube_media("https://livegenie.kr/internal/screen/live"))
        self.assertFalse(m._is_youtube_media("video.mp4"))

    def test_ffmpeg_gets_proxy_only_for_youtube(self):
        m = self.load("http://10.0.0.1:18889")
        for url, want in (("https://rr1---sn-x.googlevideo.com/a", True), ("https://pull.tiktokcdn.com/a.m3u8", False)):
            w = m.Worker.__new__(m.Worker)
            w.a = mock.Mock(speed=1.0, t0=0, t1=0)
            w.out = "/tmp/lg-proxy-test"
            with mock.patch.object(m.subprocess, "Popen") as popen:
                w.start_ffmpeg([url], True)
            cmd = popen.call_args[0][0]
            self.assertEqual("-http_proxy" in cmd, want, url)
        self.load("")


if __name__ == "__main__":
    unittest.main()
