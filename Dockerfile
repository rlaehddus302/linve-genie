# 라이브찜 컨테이너 이미지 (SYS-05, D-I3-13, AC-I3-73) — 화면 빌드 + 서버 하나. 업체에 매이지 않는다(D-001).
#   만들기: docker build -t livejjim .
#   돌리기: docker run --env-file .env -p 3000:3000 livejjim   (환경변수·절차는 docs/DEPLOY.md)
# - 여러 단계: 의존성 → 화면 빌드 → 운영 의존성 → 실행. 기반 이미지는 Node 24의 고정 버전 태그.
# - 작업 공간 패키지: 설치는 모든 package.json(잠금 파일의 작업 공간과 같게), 화면 빌드는 core·label·printer·voice(I1·I4),
#   서버 실행은 core·label(출력 기록의 라벨 데이터, I1)과 label의 운영 의존성.
# - 실행 이미지에는 화면 빌드(LIVEJJIM_WEB_DIR)·서버 소스·마이그레이션·운영 의존성만. 시험·하네스·.env·.git은 넣지 않는다(.dockerignore).
# - 비밀값(마스터 키·DB 주소·구글 비밀·운영 토큰)은 ENV·ARG에 두지 않는다 — 실행할 때 환경변수로 넘긴다.
# - 서버는 시작할 때 마이그레이션을 적용한다. 백업 명령이 쓰는 pg_dump(PostgreSQL 클라이언트)를 넣는다.

FROM node:24.20.0-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/documents/package.json packages/documents/package.json
COPY packages/label/package.json packages/label/package.json
COPY packages/printer/package.json packages/printer/package.json
COPY packages/voice/package.json packages/voice/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS web-build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/label packages/label
COPY packages/printer packages/printer
COPY packages/voice packages/voice
COPY apps/web apps/web
RUN pnpm --filter @livejjim/web build

FROM node:24.20.0-bookworm-slim AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/documents/package.json packages/documents/package.json
COPY packages/label/package.json packages/label/package.json
COPY packages/printer/package.json packages/printer/package.json
COPY packages/voice/package.json packages/voice/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter "@livejjim/server..."

# 방송 소리 주소 찾기 yt-dlp (LV1 D-LV1-11) — 고정 판 단일 실행 파일, 체크섬 확인. 판을 올릴 때 두 체크섬도 함께 바꾼다
FROM node:24.20.0-bookworm-slim AS ytdlp
ARG TARGETARCH
ARG YTDLP_VERSION=2026.10.26
ARG YTDLP_SHA256_AMD64=767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795
ARG YTDLP_SHA256_ARM64=e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && case "$TARGETARCH" in \
       arm64) name=yt-dlp_linux_aarch64; sum="$YTDLP_SHA256_ARM64" ;; \
       *) name=yt-dlp_linux; sum="$YTDLP_SHA256_AMD64" ;; \
     esac \
  && curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${name}" \
  && echo "${sum}  /usr/local/bin/yt-dlp" | sha256sum -c - \
  && chmod 0755 /usr/local/bin/yt-dlp

FROM node:24.20.0-bookworm-slim AS runtime
# pg_dump(백업), ffmpeg(방송 소리 받기 LV1 D-LV1-02)
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ytdlp /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LIVEJJIM_WEB_DIR=/app/apps/web/dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/label/node_modules ./packages/label/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/core/src packages/core/src
COPY packages/label/package.json packages/label/package.json
COPY packages/label/src packages/label/src
COPY packages/label/fonts packages/label/fonts
COPY apps/server/package.json apps/server/package.json
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
COPY --from=web-build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/server/src/main.ts"]
