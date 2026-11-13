#!/bin/bash
# DB 변경 규칙 검사 (D-RETRO-38, 복기 E7) — 두 자리 교대에서는 옛 판과 새 판이 같은 DB에 잠깐 같이 떠 있다(docs/DEPLOY.md 6-2절).
# 그래서 새 마이그레이션은 **더하기만** 한다(표·열·색인 추가). 옛 판이 깨지는 문장이 있으면 실패한다.
#   bash scripts/deploy/check-migrations.sh                 저장소의 apps/server/drizzle 검사 (내보내기의 "빠른 시험"이 돌린다)
#   bash scripts/deploy/check-migrations.sh <폴더> [기준]    다른 폴더 검사(시험용). 기준 = 검사하지 않는 마지막 번호(기본 55)
#
# 무엇을 검사하나: 번호가 기준보다 큰 파일만. 이미 있는 마이그레이션(0000~0055)은 운영 DB에 적용이 끝나 건드리지 않는다.
# 막는 문장 (옛 판 서버가 계속 돌고 있을 때 깨지는 것):
#   - DROP …                                   표·열·색인·제약·기본값 지우기 (ALTER … DROP NOT NULL 은 조건을 푸는 것이라 괜찮다)
#   - RENAME …                                 표·열·제약 이름 바꾸기 — 옛 판은 옛 이름으로 읽고 쓴다
#   - ALTER COLUMN … SET NOT NULL              옛 판이 그 열을 비워 넣으면 실패한다
#   - ADD COLUMN … NOT NULL (DEFAULT 없이)     옛 판은 그 열을 모르고 INSERT 한다
#   - ALTER COLUMN … TYPE / SET DATA TYPE      열의 뜻·모양 바꾸기
#   - 이 파일에서 만들지 않은 표에 UNIQUE·CHECK·FOREIGN KEY·EXCLUDE 제약이나 UNIQUE 색인 더하기 — 옛 판이 쓰는 값이 거절될 수 있다
#   - TRUNCATE · DELETE FROM                   기록 지우기
# 지우거나 뜻을 바꾸는 변경은 **옛 판이 완전히 내려간 다음 판**에서 한다. 그때는 그 파일에 한 줄을 적어 통과시킨다(결정 번호와 까닭이 있어야 한다):
#   -- lg:breaking-ok D-XXXX-00 옛 판(커밋 abcdef12)은 운영에서 완전히 내려갔고 이 열을 쓰는 코드가 없다
# 그 줄이 있는 배포는 되돌리기(switch.sh --back)로 옛 판을 다시 올릴 수 없다는 뜻이다.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-$HERE/../../apps/server/drizzle}"
BASELINE="${2:-55}"
PYTHON="${LG_PYTHON:-python3}"

exec "$PYTHON" - "$DIR" "$BASELINE" <<'PY'
import os
import re
import sys

folder, baseline = sys.argv[1], int(sys.argv[2])
NAME = re.compile(r"^(\d{4})_[A-Za-z0-9_]+\.sql$")
ALLOW = re.compile(r"^[ \t]*--[ \t]*lg:breaking-ok[ \t]+(D-[A-Z0-9]+(?:-[A-Z0-9]+)*)[ \t]+\S.{9,}$", re.M)
IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)'
TABLE = rf"(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?((?:{IDENT}\.)?{IDENT})"


def strip(sql):
    """주석·따옴표 속 글을 빈칸으로 바꾼다(문장 판단에 섞이지 않게). 길이는 그대로 둔다."""
    out, i, n = [], 0, len(sql)
    while i < n:
        two = sql[i:i + 2]
        if two == "--":
            j = sql.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i)); i = j
        elif two == "/*":
            j = sql.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", sql[i:j])); i = j
        elif sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j + 1:j + 2] == "'": j += 2
                elif sql[j] == "'": break
                else: j += 1
            out.append("'" + re.sub(r"[^\n]", " ", sql[i + 1:j]) + "'"); i = j + 1
        elif sql[i] == "$":
            m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
            if m:
                tag = m.group(0); j = sql.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                out.append(re.sub(r"[^\n]", " ", sql[i:j])); i = j
            else:
                out.append(sql[i]); i += 1
        else:
            out.append(sql[i]); i += 1
    return "".join(out)


def norm(name):
    return name.replace('"', "").split(".")[-1].lower()


def check(sql):
    clean = strip(sql)
    problems = []
    created = {norm(m.group(1)) for m in re.finditer(rf"\bCREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+{TABLE}", clean, re.I)}
    for raw in re.split(r";", clean):
        stmt = " ".join(raw.split())
        if not stmt:
            continue
        up = stmt.upper()
        short = stmt[:110]
        def bad(why):
            problems.append(f"{why}: {short}")
        if re.search(r"\bTRUNCATE\b", up): bad("기록을 지워요(TRUNCATE)")
        if re.search(r"\bDELETE\s+FROM\b", up): bad("기록을 지워요(DELETE)")
        if re.search(r"\bRENAME\b", up): bad("이름을 바꿔요(RENAME)")
        # DROP: ALTER COLUMN … DROP NOT NULL 만 괜찮다
        without_relax = re.sub(r"\bDROP\s+NOT\s+NULL\b", " ", up)
        if re.search(r"\bDROP\b", without_relax): bad("지워요(DROP)")
        if re.search(r"\bSET\s+NOT\s+NULL\b", up): bad("있던 열을 비울 수 없게 바꿔요(SET NOT NULL)")
        if re.search(r"\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b", up):
            bad("열의 종류를 바꿔요(TYPE)")
        alter = re.match(rf"ALTER\s+TABLE\s+{TABLE}\s+(.*)$", stmt, re.I | re.S)
        if alter:
            table, rest = norm(alter.group(1)), alter.group(2)
            for part in re.split(r",(?![^()]*\))", rest):
                pu = part.upper()
                if re.search(r"\bADD\s+(?:COLUMN\s+)?", pu) and not re.search(r"\bADD\s+(?:CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b", pu):
                    if re.search(r"\bNOT\s+NULL\b", pu) and not re.search(r"\bDEFAULT\b", pu) and not re.search(r"\bGENERATED\b", pu):
                        bad("기본값 없이 비울 수 없는 열을 더해요(ADD COLUMN … NOT NULL)")
                    if table not in created and re.search(r"\b(UNIQUE|CHECK)\b", pu):
                        bad("있던 표에 제약이 붙은 열을 더해요")
                if table not in created and re.search(r"\bADD\s+(?:CONSTRAINT\s+\S+\s+)?(UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE|PRIMARY\s+KEY)\b", pu):
                    bad("있던 표에 제약을 더해요")
        index = re.match(rf"CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:{IDENT}\s+)?ON\s+{TABLE}", stmt, re.I)
        if index and norm(index.group(1)) not in created:
            bad("있던 표에 겹침 금지 색인을 더해요(CREATE UNIQUE INDEX)")
    return problems


try:
    names = sorted(os.listdir(folder))
except OSError:
    print(f"DB 변경 규칙 검사: 폴더를 읽지 못했어요 ({folder})", file=sys.stderr)
    sys.exit(2)

checked = failed = allowed = 0
for name in names:
    m = NAME.match(name)
    if not m:
        if name.endswith(".sql"):
            print(f"실패 {name}: 파일 이름이 0000_이름.sql 모양이 아니에요", file=sys.stderr); failed += 1
        continue
    if int(m.group(1)) <= baseline:
        continue
    checked += 1
    with open(os.path.join(folder, name), encoding="utf-8") as f:
        sql = f.read()
    problems = check(sql)
    if not problems:
        continue
    ok = ALLOW.search(sql)
    if ok:
        allowed += 1
        print(f"넘김 {name}: 옛 판이 깨지는 문장 {len(problems)}개 — {ok.group(1)} 로 허락됨(이 배포는 되돌리기로 옛 판을 올릴 수 없어요)")
        continue
    failed += 1
    for p in problems:
        print(f"실패 {name}: {p}", file=sys.stderr)

if failed:
    print("DB 변경 규칙(D-RETRO-38): 새 마이그레이션은 더하기만 해요. 지우거나 뜻을 바꾸는 변경은 옛 판이 완전히 내려간 다음 판에서 하고,", file=sys.stderr)
    print("그때 파일에 `-- lg:breaking-ok D-번호 까닭` 한 줄을 적어 주세요 (scripts/deploy/check-migrations.sh 머리말).", file=sys.stderr)
    sys.exit(1)
print(f"DB 변경 규칙 검사: 새 마이그레이션 {checked}개 통과" + (f" (허락된 것 {allowed}개)" if allowed else ""))
PY
