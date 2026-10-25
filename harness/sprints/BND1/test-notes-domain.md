# BND1 test-domain 메모

시험 위치: `tests/adversarial/bnd1/` (세 파일, 25개 시험 — 2회차 기준 모두 통과)

- `comment-property.test.ts` (순수 함수, 모두 통과 — 회귀로 둔다)
  - `bandBatch`를 손으로 쓴 모형과 대조(fast-check 400번): 기록 차례 = 작성 시각 오름차순(같으면 읽은 차례), 이미 본 키 빠짐, 같은 읽기 안 두 번째부터 DUPLICATE, 입력을 바꾸지 않음, chat 다섯 키·owner false·band: 키
  - 시각이 뒤섞인 50개 한 묶음의 차례
  - user_key가 `ig:`·`tt:`·`sms:`·`UC_`·휴대폰 번호 모양이어도 `band:` 구매자, 판매자와 대소문자·공백·전각만 다르면 손님
  - 256자 키 경계(접두어 포함·UTF-16 단위)
  - `bandText`: 밴드가 이스케이프한 손님 글은 원래 글자 그대로 돌아온다(태그·@가 생기지 않음, 500번), 닫히지 않은 부르기·태그 안의 태그·1만 자 속성·여러 겹 이스케이프, 어떤 유니코드에도 예외 없음
  - 500 코드 포인트 경계(ZWJ 가족 이모지·결합 문자), `longerThan`·`clipWithEllipsis`가 서로게이트를 가르지 않음, 글 첫 줄
- `reading-attacks.test.ts` (서버 경로, 가짜 밴드·주입한 시계)
  - 통과: 휴대폰 번호 모양 user_key 구매자 합치기(D-079에 걸리지 않음), 대소문자만 다른 판매자 키, 50개 뒤섞인 묶음의 seq와 다음 읽기의 이른 댓글(1등 그대로), 쪽 경계의 같은 댓글 키(chat 하나·DUPLICATE 1이 늘지 않음), 지웠다 다시 보이기 3번(지운 알림 하나·찜 그대로), 두 회차에 동시에 다른 글 잇기(하나만, BAND_IN_USE)
  - **실패 TD-BND1-001** 고친 댓글 A→B→C→B에서 B 알림이 두 번 (`service.ts #edits`가 마지막 고친 글 해시 하나만 기억)
  - **실패 TD-BND1-002** 쪽 넘기기가 빈 쪽과 늘 새 `after`를 주면 전체 읽기(잇기의 기준선 읽기 포함)가 끝나지 않음 — 판매자 잠금을 쥔 채 밴드에 요청을 계속 보냄 (`#readComments` full 모드에 쪽 수 상한 없음)
  - **실패 TD-BND1-003** 늦어진 빠른 읽기가 답을 기다리는 동안 끊고 다른 회차에 이으면 기준선 읽기와 겹쳐 같은 토큰 동시 요청 2 (`unlink`·`#retire`가 진행 중인 읽기를 기다리지 않음)

돌린 명령: `pnpm exec vitest run --config vitest.adversarial.config.ts tests/adversarial/bnd1` (전체 verify는 돌리지 않음)

## 2회차 (감사 2회차 고침 확인 — ab0bbaa2·6a1cbc46 뒤)

- TD-BND1-001·002·003 모두 녹색. 001·002는 새 결정대로 **더 엄하게** 바꿨다(기대를 지우지 않음).
  - TD-BND1-001: A→B→C→B→A(처음 글로 돌아감)까지 — 알림 2개(B·C) (D-BND1-18). 300번 고침은 서버 시험에 있다.
  - TD-BND1-002: 잇기의 기준선 읽기 요청 ≤ ⌈1000÷20⌉+10 = 60 (예전 느슨한 100에서), 끝까지 되지 않은 읽기로는 잇지 않음 — 503 `UNAVAILABLE` "밴드 글을 읽지 못해 잇지 못했어요. 잠시 뒤 다시 눌러 주세요."(D-BND1-19), 연결 `NONE`.
- 새 파일 `fast-read-attacks.test.ts` (D-BND1-16, RA-BND1-03·04):
  - fast-check 모형(10번, 다른 씨앗으로 40번 더 돌려 통과): 쪽 크기 5·10·20·50 × 기준선 0~30 × 몰림 0~260개 × 쪽 중간 5xx(0~3번, 0~4쪽 뒤) × 10초 차례 1~7번(60초 차례 경계를 넘나듦) → 회복 뒤 모든 댓글이 정확히 한 번, seq 순서 = 작성 시각 순서, `READING`, STUCK 알림 0.
  - 1,000개 경계: 기준선 0 + 새 1,000개 → 빠른 읽기 한 번(50쪽)에 1,000개 차례대로, `BAND_FAST_UNREACHED` 없음. 기준선 5 + 새 1,000개(빠른 읽기는 본 댓글 쪽 직전에 1,000개를 넘음) → 같은 차례 전체 읽기 + 빠른 읽기 한 번 더로 1,000개 모두 차례대로, STUCK 0.
  - 끝나지 않는 쪽 넘기기(이은 뒤): 한 차례 요청 ≤ 3×60, 기록 0, STUCK 알림 한 번(세 차례 뒤에도)·문장 확인·`notices.unseen`에 듦(D-BND1-17), 회복하면 25개 차례대로, 닿은 뒤 다시 막히면 알림 하나 더.
  - 빠른 읽기가 밴드 답을 기다리는 동안 회차 끝 → 늦은 답의 댓글 기록 0, 연결 `FINISHED`, 그 뒤 다섯 차례 요청 0, 남은 타이머 0.
- 민감도: `apps/server/src/band/service.ts`를 잠깐 a4aa8ffb 판으로 돌려 돌렸더니 새·강화 시험 5개가 실패(모형 반례 `[50,7,[{n:4,…},{n:257,steps:2,…}]]` — 5쪽 상한으로 뒤 seq). 곧바로 되돌렸다(제품 코드 변경 없음).
- 지적으로 남기지 않은 관찰(설계대로): 한 글의 댓글이 1,000개를 넘으면 전체 읽기는 늘 오래된 1,000개만 보므로, 그 뒤 한 차례에 1,000개 넘게 몰리면 영원히 막다른 경우가 된다 — D-BND1-16의 막다른 경우 알림이 이를 판매자에게 알린다.

돌린 명령: `TZ=Asia/Seoul pnpm exec vitest run --config vitest.adversarial.config.ts tests/adversarial/bnd1` (25개 통과, 약 13초), `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm exec eslint tests/adversarial/bnd1`

## 3회차 (감사 3회차 고침 확인 — dadfc9ed·4efb185f 뒤, D-BND1-22·23)

- `fast-read-attacks.test.ts` TD-BND1-002를 D-BND1-23 (가)대로 **더 엄하게** 바꿨다(10초 차례를 기대하던 것):
  - 알림이 난 뒤 둘째·셋째 차례는 59초 동안 요청 0, 60초에 차례. 회복도 60초 차례에서(59초엔 기록 0). 닿은 뒤에는 9초 동안 요청 0·10초에 다음 차례.
  - 회복이 4분 뒤로 밀려 늦게 읽음 알림(AC-BND1-54) "밴드 댓글을 4분 동안 읽지 못했어요. 그 사이 달린 댓글 25개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요."가 하나 더 — 지우지 않고 글자 그대로 단언, 알림 차례 STUCK·LATE·STUCK, unseen 3, `BAND_STUCK` 로그 2.
- 새 파일 `pace-attacks.test.ts`:
  - fast-check(6번): 회차 끝이 아닌 거절 코드(NOT_FOUND·STATE_FORMAT·NOT_SUPPORTED·NOT_LINKED·ENGINE_ERROR·비슷한 이름 `BROADCAST_ENDED_X`·소문자 `sealed`·빈 문자열) 1~8번 → 간격 = min(10초×2^i, 300초)(0 없음), 걸린 타이머 늘 1, 차례마다 기록 시도 1, `RETRYING` 문장·마지막으로 읽은 때 그대로, `BAND_RECORD_REJECTED` 거절 코드 차례 그대로·로그에 댓글 글·이름 없음, 1ms 전엔 요청 0, 풀리면 그 댓글이 `chat` 1개·`READING`·그 뒤 130초 돌아도 두 번 없음.
  - 거절이 끝없이(1시간): 기록 시도 16번(다시 시도 시간표 그대로), 타이머 늘 1 — 그 사이 회차 끝 → `FINISHED`·"방송을 끝내서…"·그 뒤 900초 요청 0·타이머 0.
  - 끝나지 않는 쪽 넘기기 막다른 경우: 알림 뒤 120초 댓글 목록 요청 ≤ 306, 600초 동안 차례 10번·간격 정확히 60초, 알림 한 번.
  - 1001 × 세 판매자(읽는 중·막다른 경우·기록 거절로 다시 시도): 첫 신호 뒤 300초까지·둘째 신호 뒤 600초까지 세 판매자 모두 `sort=+created_at` 0, 그동안 빠른 읽기로 새 댓글 기록, 그 뒤 세 판매자 모두 전체 읽기가 다시.
- 민감도: `apps/server/src/band/service.ts`만 잠깐 dadfc9ed^ 판으로 돌려 돌렸더니 새·강화 시험 5개 모두 실패. 곧바로 되돌렸다(제품 코드 변경 없음).
- 관찰(지적 minor, 스펙 확인 필요): 한도 신호 뒤 600초 안에 판매자가 새로 잇기를 누르면 기준선 읽기(`#readComments` full, `sort=+created_at`)는 그대로 나간다. 잇기는 기준선이 있어야 하는 판매자 조작이라 막지 않는 것이 맞아 보이나 AC-BND1-53 글은 "600초 동안 전체 읽기를 하지 않는다"뿐이다.

돌린 명령: `TZ=Asia/Seoul pnpm exec vitest run --config vitest.adversarial.config.ts tests/adversarial/bnd1/` (4파일 29개 통과), `pnpm exec tsc --noEmit -p tsconfig.json`, `pnpm exec eslint tests/adversarial/bnd1/`
