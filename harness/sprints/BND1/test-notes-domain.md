# BND1 test-domain 메모

시험 위치: `tests/adversarial/bnd1/` (두 파일, 20개 시험 — 실패 3개는 아래 지적)

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
