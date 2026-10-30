# PRN2 위험 감사 (risk-auditor)

- 범위: `git diff d605751c..HEAD` (HEAD `45b218e5`). 코드 읽기만 했다 — 시험을 돌리지 않았고 이 파일 말고는 고치지 않았다.
- 근거: `harness/sprints/PRN2/acceptance.md`, `docs/DECISIONS.md` D-PRN2-01~26, `docs/spec/LABEL_RULES.md` L-7·L-11·L-12, `harness/sprints/PRN2/*.md`.
- 심각도: 보통 = major, 낮음 = minor (HARNESS §4, D-036). 높음(blocker)은 없다.

## 문제 없음으로 본 것 (근거만)

- **PNG 입구 격리**: `GET /api/print/jobs/:id/png`는 비트맵과 같은 `jobImage`(기기 ID·시도 형식 검사 → `print.jobBitmap(seller, device, attempt, id)`)를 지나므로 다른 판매자·기기·끝난 시도 처리가 비트맵 입구와 같다(`apps/server/src/print-api.ts` 89-106). `test-png`는 그 판매자의 가게 이름만 담고, `?size=`는 `isLabelSize`로 걸러 고정 문장만 돌려준다(받은 값을 되돌려 보내지 않음, `packages/label/src/render.ts` 614-618).
- **profileId 입력**: 글이 아니면 400(고정 문장), 글이면 표에 있는 ID만 저장하고 나머지는 null(`print.ts` 366-368, `print-api.ts` 54-59). 받은 값을 오류·로그에 남기지 않는다. 새로 더한 `console`/로그 호출은 없다.
- **기기 이름·ID 유출**: 서버로 가는 값은 프로필 ID뿐이다(웹 `#report`/`become`, 앱 `#report`/`become`). 공유 창으로 넘기는 파일은 테스트 라벨 PNG뿐이다(구매자 정보 없음, D-PRN2-26).
- **끝 알림**: Marklife는 정확히 `AA` 한 바이트, Luck Jingle만 정확히 `4F 4B`(`job.ts` `isEndNotice`). 소문자·줄바꿈·`AA AA`는 끝이 아니다.
- **실험 기종 "예" 전 받기 멈춤(D-PRN2-10·15)**: 웹 `#canClaim`에 `!awaitingTest`, `#report`가 `linked && !awaitingTest`로 서버에 연결 안 됨을 알리고, `#connect`·`#onAdapterState`(DISCONNECTED/CONNECTING)·`testPrint`·`dismissTest`에서 확인을 지운다. 앱도 `#canClaim`·`#report`·`#syncPrinter`(연결이 끊기거나 프로필이 바뀌면 지움)·`connect`/`reconnect`에서 같다. 앱을 다시 켜면 확인값이 false에서 시작한다. 탭마다 기기 ID가 따로라(`apps/web/src/lib/device.ts`) 여러 탭으로 우회할 수 없다. 우회 길을 찾지 못했다.
- **크기 목록 밖 템플릿**: 웹(`printer-station.ts` 1069-1075)·앱(`label-queue.ts` 449-454)은 그리기 전에 `INVALID_TEMPLATE`(size)를 보내고, 서버는 `LABEL_ERROR`로 멈춘다. D110은 `IMAGE_TOO_WIDE`가 두 번째로 막는다.
- **Web Bluetooth**: `acceptAllDevices` 없음. `optionalServices` = ff00·fd00·NIIMBOT 서비스(D-PRN2-20 그대로).
- **외부 코드 출처**: 바이트 순서는 공개 문서·niimbluelib 표를 근거로 했다고 적혀 있고, 옮긴 라이선스 헤더나 통째로 복사한 흔적은 보지 못했다.
- **성능**: PNG 입구는 요청마다 라벨 한 장을 그리고 인코딩한다(비트맵 입구와 같은 비용, 무제한 반복 없음).
- **기존 시험 기대 수정**(211cfb2c 등): D-PRN2-01·02·05(켠 프로필 표·Luck Jingle 바이트·WRONG_MODEL 문장)에 따른 바뀜만 있고, 바이트 수(19,233 → 19,236)도 머리 길이 계산과 맞다. 꼼수로 통과시킨 흔적은 없다. 웹 `prn2-printer.test.tsx:133`의 `toEqual([printerRequestOptions()])`는 구현 결과와 비교하는 동어반복이지만, `packages/printer/test/prn2.test.ts:145`가 ff00·fd00·NIIMBOT 값을 따로 단언하므로 빈틈은 아니다.

## 지적

### RA-PRN2-001 — 보통(major) · spec/ux · web·server · CONFIRMED
- **제목**: 테스트 인쇄가 저장된 라벨 크기가 아니라 프로필 기본 크기(B1이면 늘 50×30)로 나간다 — 기존 B1 판매자의 50×20·50×40 용지에서 테스트가 넘치고, 실험 기종의 "예"가 실제 작업과 다른 크기로 확인된다.
- **파일**: `apps/web/src/lib/printer-station.ts:1170-1171` (`profile?.defaultSize ?? input.size` — 화면이 넘긴 템플릿 크기는 프로필을 모를 때만 쓴다), `apps/mobile/src/lib/label-queue.ts:180-182`, `apps/server/src/print.ts:1073` (크기가 없으면 템플릿 크기 대신 `50x30`, a5ccab9a).
- **재현**: B1(확인됨)에 50×20 롤을 끼우고 라벨 설정을 50×20으로 저장한다 → 라벨 화면에서 "테스트 인쇄"를 누른다. PRN2 전에는 50×20 그림이 나갔고, 지금은 50×30(240점) 그림이 50×20 라벨에 나가 간격을 넘어 두 장에 걸치고 "네 변 테두리"가 잘린다. 판매자는 "아니요"를 누르고 문제없는 프린터를 의심한다. 실험 기종도 같다: D110에 15×50 테이프를 끼우고 템플릿도 그 크기면, 테스트는 tape12×40으로 나가 "예"를 받은 뒤 실제 작업은 확인하지 않은 크기로 찍힌다(D-PRN2-10의 안전장치가 확인하려던 것과 어긋난다).
- **고칠 곳**: spec-keeper가 D-PRN2-11을 다시 판정한다(dev-notes 135줄에 같은 제안이 있다). 안전한 쪽: "저장된 템플릿 크기가 이은 프로필의 크기 목록에 있으면 그 크기, 없으면 프로필 기본 크기". 그 뒤 dev-web(웹·앱 `testPrint`/`#testSize`)을 고친다. 서버의 `?size=` 계약은 그대로 둬도 된다.

### RA-PRN2-002 — 보통(major) · 내구성 · server · CONFIRMED (합칠 때 주의)
- **제목**: 마이그레이션 `0030`과 journal `when: 1794960000004`가 다른 갈래 둘과 겹친다 — 그대로 합치면 drizzle이 한쪽을 조용히 건너뛰어 `print_queues.printer_profile_id`가 없는 채로 출력 대기열 조회가 깨질 수 있다.
- **파일**: `apps/server/drizzle/0030_prn2_printer_profile.sql`, `apps/server/drizzle/meta/_journal.json`(idx 30).
- **근거**: `claude/great-haslett-9379fe`의 `0030_ytsrv_thanks_official`(when …004), `claude/youthful-taussig-064c9a`의 `0030_sms3_inbox`(when …004). `claude/hopeful-agnesi-e0d485`(KP1)는 0031·0032(when …005·…006)를 쓰고 0030은 비워 둔다. drizzle pg 마이그레이터는 DB에 마지막으로 적용된 `created_at`보다 큰 `when`만 적용하므로, 다른 0030이 먼저 배포된 DB에서는 when이 같거나 작은 PRN2 줄이 건너뛰어진다. 그러면 스키마에 있는 칸을 읽는 `readQueue`/`lockQueue`가 실패해 방송 중 출력 전체가 멈춘다.
- **고칠 곳**: 오케스트레이터가 합칠 때 번호와 `when`을 다시 매긴다(합치는 순서대로 0030~0033, when은 단조 증가). 합친 뒤 빈 DB와 "다른 0030이 적용된 DB" 양쪽에서 마이그레이션을 확인한다.

### RA-PRN2-003 — 낮음(minor) · device · PLAUSIBLE
- **제목**: 꾸러미 A의 `ff03` 조회 실패를 모두 "없음"으로 삼킨다 — 일시적인 GATT 오류도 흐름 제어 없이 보내고, 전에는 꾸러미 C(fd00)로 넘어가던 기기가 흐름 제어 없는 A로 붙는다.
- **파일**: `packages/printer/src/marklife.ts:123` (`getCharacteristic(spec.flow).catch(() => undefined)`).
- **시나리오**: ff00에 ff01·ff02는 있고 ff03 조회만 실패하는 기기(또는 일시 오류) → 크레딧 없이 30ms·90바이트로 연속 전송 → 프린터 버퍼가 넘쳐 바이트를 잃으면 깨진 라벨이 나오거나 `TIMEOUT`이 난다. 실험 기종에 테스트 "예"를 받아야 하므로 기본 설정의 사고는 아니다.
- **고칠 곳**: dev-device. "특성 없음"(NotFoundError)만 없음으로 보고, 다른 오류는 그 꾸러미를 실패로 처리해 C로 넘어간다. HG-5 실물 확인 항목에 넣는다.

### RA-PRN2-004 — 낮음(minor) · device · PLAUSIBLE
- **제목**: 끝 알림을 "첫 조각을 쓴 뒤 아무 때나" 받으면 기억해 두고, 모두 쓰는 순간 출력함으로 처리한다 — Luck Jingle에서 `OK`를 끝으로 인정하면서 이 창이 넓어졌다.
- **파일**: `packages/printer/src/marklife.ts:344-347`(`ended = true`가 `written` 전에도 남는다), `:254`.
- **시나리오**: 실제 바우아토가 작업 중간 명령(`1F 11 51` 위치 맞춤 등)에 `OK`로 답하면, 용지가 없거나 걸려 안 찍힌 라벨도 "출력함"으로 기록된다. 골든 G-PRT-PRN2-57의 메모는 "작업 끝 전에 OK로 답하는 명령이 없다(검증 문서 표)"라고 적고 있어 실물(HG-5)로만 판별된다.
- **고칠 곳**: dev-device. Luck Jingle의 `OK`는 `written` 뒤에 받은 것만 세는 쪽이 판매자에게 안전하다(D-PRN2-03의 "안 찍힌 라벨을 찍힌 것으로 기록하지 않는다"). 바꾸려면 spec-keeper가 L-12 5에 반영한다.

### RA-PRN2-005 — 낮음(minor) · web(앱) · PLAUSIBLE
- **제목**: 앱 `printTest`가 `#syncGate()`로 `pump()`를 새로 부르는데, 앱 `#canClaim`에는 웹의 `testing` 막이 없다 — B1 출력 기기에서 테스트 출력과 작업 출력이 겹칠 수 있다.
- **파일**: `apps/mobile/src/lib/label-queue.ts:325-331`, `:400-402` (웹은 `printer-station.ts:986` `!this.#snapshot.testing`).
- **시나리오**: 대기 작업이 있는 B1 출력 기기에서 두 장 사이(job=null)에 "테스트 인쇄"를 누른다 → 테스트 그림을 받는 동안 `pump`가 다음 작업을 받는다 → 두 `ble.print`가 겹쳐 하나가 `BUSY`가 된다 → 작업 결과가 프린터 오류로 멈출 수 있다. 앞부터 있던 틈이지만 PRN2가 `pump`를 직접 부르는 길을 더했다.
- **고칠 곳**: dev-web(앱). 웹처럼 `testing` 상태를 두고 `#canClaim`에서 막거나, `job`/`busy`일 때 `printTest`를 막는다.

### RA-PRN2-006 — 낮음(minor) · web · CONFIRMED (스펙 결정 D-PRN2-18의 부작용)
- **제목**: 웹에서 Marklife·바우아토를 한 번만 이어도 NIIMBOT(B1) 기억이 지워진다 — 다시 B1을 이어 쓰는 방송에서 B1이 끊기면 저절로 다시 잇기가 되지 않는다.
- **파일**: `packages/printer/src/one-list.ts:215` (`forgetNiimbot()`).
- **시나리오**: 방송 전에 실험 삼아 P12를 잇고 → B1로 돌아온다(고르기 창으로 다시 고르면 기억이 다시 생긴다). 판매자가 "다시 연결"로 돌아왔다면 기억이 없어 고르기 창이 뜬다. 고르기 창으로 B1을 이은 뒤라면 문제가 없다. 영향은 작다.
- **고칠 곳**: 고치지 않아도 된다(스펙 결정). E2E에 "L-12 → B1 다시 고름 → 저절로 다시 잇기 됨" 사례가 있는지 test-e2e가 확인한다.

### RA-PRN2-007 — 낮음(minor) · server·web · CONFIRMED
- **제목**: 실험 기종이 "예"를 기다리는 동안 서버가 `printerProfileId`를 null로 두어, 라벨 설정의 크기 목록이 B1 목록으로 돌아가고 D-PRN2-24 경고도 사라진다.
- **파일**: `apps/server/src/print.ts:870` (`printerProfileId: connected ? profileId : null`) + 웹·앱 `#report`(awaitingTest면 connected=false).
- **시나리오**: 출력 기기에 D110을 이음 → "예" 전 → 다른 화면의 라벨 설정에 50×30 등 B1 목록이 보이고 테이프 크기가 없다 → 판매자가 50×30으로 저장 → "예" 뒤 출력하면 `LABEL_ERROR`로 멈춘다(잘못 찍히지는 않는다).
- **고칠 곳**: 선택 사항. 연결 안 됨 알림에도 profileId를 기록하는 별도 칸(예: `pendingProfileId`)을 두거나, 고치지 않고 놔둔다. spec-keeper가 판단한다.

## 요약
- 높음 0 · 보통 2(RA-PRN2-001·002) · 낮음 5(003~007). 보안·개인정보·데이터 손실 blocker 없음.
