#!/bin/bash
# 클라우드 화면 일꾼 서버 설치 (EC2 user-data, Ubuntu 24.04 · c7i.4xlarge 16코어, D-SCR-CLOUD-01)
# launch-worker.sh가 __BUNDLE_URL__을 바꿔 넣는다. 끝나면 /opt/lg/READY. 일꾼(lg-screen)은 설치만 하고 켜지 않는다 — 시험 뒤 손으로 켠다.
set -x
export DEBIAN_FRONTEND=noninteractive HOME=/root
apt-get update -q
apt-get install -y -q ffmpeg python3-venv python3-pip curl unzip nodejs npm
curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip && unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install
npm install -g @anthropic-ai/claude-code
useradd -m -d /opt/lg -s /bin/bash lg || true
cd /opt/lg && curl -s -o sw.tgz "__BUNDLE_URL__" && tar xzf sw.tgz && rm sw.tgz
cd /opt/lg/packages/screen-worker
python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip
grep -v -E "^(mlx|llama|ocrmac)" requirements.txt > /tmp/req-linux.txt
.venv/bin/pip install -q -r /tmp/req-linux.txt faster-whisper
chown -R lg:lg /opt/lg
# 모델은 미리 받아 둔다(켤 때 받지 않게)
sudo -u lg -H .venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('mobiuslabsgmbh/faster-whisper-large-v3-turbo', device='cpu', compute_type='int8')"
sudo -u lg -H .venv/bin/python -c "from rapidocr import RapidOCR; RapidOCR()"
sudo -u lg -H .venv/bin/python -c "import silero_vad; silero_vad.load_silero_vad()"
cat > /etc/lg-screen.env <<'ENV'
LG_SERVER=https://livegenie.kr
STT_BACKEND=faster
OCR_BACKEND=rapid
RAPID_THREADS=2
FW_THREADS=6
LG_YT_PROXY=http://172.31.62.27:18889
LLM_CLAUDE_TOKEN_FILE=/run/lg/claude-token
HF_HUB_OFFLINE=1
PYTHONUNBUFFERED=1
ENV
cp /opt/lg/deploy/screen-cloud/lg-screen.service /etc/systemd/system/lg-screen.service 2>/dev/null || true
systemctl daemon-reload
touch /opt/lg/READY
