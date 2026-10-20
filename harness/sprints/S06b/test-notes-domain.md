# S06b test-domain 노트 (라운드 0)

## 결과
- 재현한 버그: 없음. 공격한 것은 모두 스펙대로 동작해 회귀 테스트로 남겼다.
- 새 파일
  - `tests/adversarial/s06b/merge-preview-property.test.ts` (AC-S06b-03)
    - fast-check 무작위 로그를 쓴다. 방송 둘은 선언 순서가 사전 순과 반대다. 재고 1·2, READY 상품, 채팅·문자찜(뒤 4자리만 같은 두 번호·지정 구매자·초/분/전날 시각)·취소·거절·올리기·확정·지정·충돌 결정·공개·재고 수정·번호 변경·차단·입금(잠금)·합치기·떼어 내기를 섞었다.
    - 세 시점에서 모든 구매자 쌍과 모르는 ID·`__proto__`·`sms:r999`를 본다.
    - 막힘 이유·target·bothConfirmed는 공개 조회로 따로 계산해 비교한다. 순서는 위에서부터 처음 맞는 것이다.
    - 막힘 ⇔ 실제 merge가 아무 일도 하지 않음, DUPLICATE = duplicates, after = 합친 뒤 getBuyer(target), moving = 적용 전 getBuyer(from).
    - duplicates의 product·buyer(자신)·status는 적용 전 찜과 같고, 상품 순이다. keep은 합친 뒤 target의 활성 찜이고, 상태 순서(대기는 순번)에서 뒤지지 않는다.
    - 합친 뒤 checkInvariants가 비어 있다. 상태 직렬화가 그대로이고, 두 번 불러도 같다.
    - 미리 본 대로 차례로 합쳐 가는 장부 정리 흐름도 본다.
    - 실측 분포(120회): 막힘 없음 1,932 · BOTH_CONFIRMED 177 · FROM_MERGED 15 · CYCLE 6, 중복 상태 PENDING 467 · WAITLISTED 370 · CONFLICT 9.
  - `tests/adversarial/s06b/server-s06b.test.ts` (AC-S06b-10·11·12)
    - 미리 보기: 두 인스턴스에서 따라잡음, 다른 판매자의 구매자 ID는 UNKNOWN_BUYER, 다른 판매자의 리허설 날짜 404는 없는 날짜·날짜 조회와 같은 본문, 리허설·실제 분리, 휴대폰 번호 다섯 표기(400, 응답·로그·DB에 없음), 기록 없음·보기 캐시로 세지 않음, 쓰기와 겹친 조회는 응답 seq의 상태와 같다.
    - 문자찜 buyer: 전화번호로 이은 문자 구매자가 유튜브 구매자에 합쳐진 뒤에도 구매자 자신이다. 떼어 낸 뒤와 재시작 인스턴스에서 같은 요청 번호로 재전송해도 같은 본문이다. 지정 구매자와 번호를 함께 적으면 지정 구매자이고, 동시 재전송은 같은 본문이다.
    - 보기 캐시: 실제·리허설 범위 6개를 범위·증분·메시지 조회로 오가면 그 판매자는 4개이고 조용한 판매자는 그대로다. 비운 범위의 전체·증분은 같은 값이고, 비운 뒤 쓰기도 증분에 담긴다. 10분 지난 범위는 다른 판매자의 쓰기 때 비워진다.

## AC-S06b-51 시간 여유
- `pnpm adversarial`의 시험별 시간을 쟀다(기계 부하 load avg 약 13). 기본 5초의 절반을 넘는데 제한을 적지 않았거나 낮게 적은 시험에 시험 자체의 제한을 적었다. 검사 내용은 그대로이고, `vitest.adversarial.config.ts`·`scripts/verify/**`는 바꾸지 않았다.
  - `s00/golden-runner.test.ts`: 환경변수·작업 폴더 변형 120초(측정 27초), 허용 목록 suite 빼기 60초, 어휘 키 변형 60초
  - `s00/server.test.ts`: 기동 대기 10초 → 60초, 시험 20초 → 120초(부하에서 "10초 안에 시작하지 않았다"로 실제 실패함), 잘못된 PORT 90초
  - `s00/lint-guards.test.ts` 순수성 it.each 60초, `s02/engine-random.test.ts` 60초, `s02/engine-model.test.ts` 30초 → 60초, `s03b/privacy-s03b.test.ts` "매 이벤트 뒤" 60초
- 나머지 오래 걸리는 시험(s04·s05 서버, verify-gates)은 이미 60~600초를 적어 두었다.
