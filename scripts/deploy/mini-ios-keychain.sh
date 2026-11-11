#!/bin/bash
# 맥 미니 자동 내보내기의 아이폰 서명 준비 (D-CI-01·D-OTA-01, 한 번만 — 다시 돌려도 있는 것은 그대로 둔다). 사용자 허락을 받고 돌린다.
# 왜: 자동 실행기는 화면 없이 돌아 로그인 키체인을 열 수 없고(User interaction is not allowed),
#     맥 미니에는 라이브지니 팀(N62U2LAB66) 인증서가 없었다. 그래서 전용 키체인을 만들고,
#     App Store Connect API 키(~/.livegenie-ci/asc.env)로 개발·배포 인증서를 하나씩 받아 넣는다(애플 개발자 계정에 인증서가 하나씩 생긴다).
# 비밀(키체인 비밀번호·개인 키)은 ~/.livegenie-ci에만(0600), 화면에 찍지 않는다. ship.yml이 빌드 전에 이 키체인을 연다.
set -euo pipefail
export PATH=/opt/homebrew/bin:$HOME/.local/share/mise/shims:$PATH
CI=$HOME/.livegenie-ci
KC=$HOME/Library/Keychains/livegenie-ci.keychain-db
umask 077
set -a; . "$CI/asc.env"; set +a
[ -f "$CI/keychain.pass" ] || openssl rand -hex 24 > "$CI/keychain.pass"
PASS=$(cat "$CI/keychain.pass")
[ -f "$KC" ] || security create-keychain -p "$PASS" "$KC"
security unlock-keychain -p "$PASS" "$KC"
security set-keychain-settings "$KC"   # 저절로 잠그지 않는다
# 찾는 목록에 넣는다(로그인 키체인은 그대로 둔다)
EXISTING=$(security list-keychains -d user | tr -d '"' | xargs)
case " $EXISTING " in *" $KC "*) ;; *) security list-keychains -d user -s $EXISTING "$KC" ;; esac

# 애플 중간 인증서(WWDR G3) — 없으면 서명 신원이 '유효'로 안 잡힌다
if ! security find-certificate -c "Apple Worldwide Developer Relations Certification Authority" -a "$KC" >/dev/null 2>&1; then
  curl -fsSL -o "$CI/AppleWWDRCAG3.cer" https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer
  security import "$CI/AppleWWDRCAG3.cer" -k "$KC" >/dev/null || true
fi

issue() { # $1 = DEVELOPMENT | DISTRIBUTION, $2 = 찾을 이름
  if security find-identity -v -p codesigning "$KC" | grep -q "$2"; then echo "있음: $2"; return; fi
  local d; d=$(mktemp -d)
  openssl req -new -newkey rsa:2048 -nodes -keyout "$d/key.pem" -subj "/CN=livegenie-ci $1/O=Livegenie" -out "$d/csr.pem" 2>/dev/null
  node - "$1" "$d" <<'JS'
const crypto = require('node:crypto'); const fs = require('node:fs')
const [type, dir] = process.argv.slice(2)
const b64u = (b) => Buffer.from(b).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const head = b64u(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }))
const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }))
const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: fs.readFileSync(process.env.ASC_KEY_PATH), dsaEncoding: 'ieee-p1363' })
const csr = fs.readFileSync(`${dir}/csr.pem`, 'utf8')
fetch('https://api.appstoreconnect.apple.com/v1/certificates', {
  method: 'POST',
  headers: { Authorization: `Bearer ${head}.${body}.${b64u(sig)}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { type: 'certificates', attributes: { certificateType: type, csrContent: csr } } }),
}).then(async (r) => {
  const j = await r.json()
  if (!r.ok) { console.error('인증서 받기 실패', r.status, JSON.stringify(j.errors?.map((e) => e.detail ?? e.title))); process.exit(1) }
  fs.writeFileSync(`${dir}/cert.der`, Buffer.from(j.data.attributes.certificateContent, 'base64'))
  console.log('받음:', j.data.attributes.name, j.data.attributes.expirationDate)
})
JS
  openssl x509 -inform der -in "$d/cert.der" -out "$d/cert.pem"
  local p; p=$(openssl rand -hex 12)
  openssl pkcs12 -export -legacy -inkey "$d/key.pem" -in "$d/cert.pem" -out "$d/id.p12" -passout "pass:$p" 2>/dev/null \
    || openssl pkcs12 -export -inkey "$d/key.pem" -in "$d/cert.pem" -out "$d/id.p12" -passout "pass:$p"
  security import "$d/id.p12" -k "$KC" -P "$p" -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productbuild >/dev/null
  rm -rf "$d"
}
issue DEVELOPMENT "Apple Development"
issue DISTRIBUTION "Apple Distribution"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KC" >/dev/null
security find-identity -v -p codesigning "$KC"
