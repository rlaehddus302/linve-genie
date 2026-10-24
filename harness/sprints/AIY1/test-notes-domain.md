# AIY1 test-domain 메모

시험: `tests/adversarial/aiy1/` (모두 통과 — 깨진 곳을 찾지 못함, 회귀로 남김)

- `plan-property.test.ts`
  - `isYoutubeSource`: 정확히 `other`·`rehearsal`만 보낼 수 있다. `OTHER`·`Other`·앞뒤 공백·제로폭·전각·`Rehearsal`·`YouTube`·빈 값·null은 모두 유튜브 줄. 아무 문자열 속성 500회.
  - `planAssist` 속성 1000회: 보내는 목록에 유튜브 줄이 없고, 결과가 "유튜브 줄을 지운 목록"으로 고른 결과와 같다(묶음 수·같은 글 묶기 자리를 차지하지 않음). `youtube` 키 없음 = `false`.
- `server-aiy1.test.ts`
  - TD-AIY1-01 DB `chat_source`를 대소문자·공백·제로폭·전각으로 비튼 줄: 보내지 않고 `excluded: 'YOUTUBE_POLICY'`.
  - TD-AIY1-02 백업 바꾸기 복구: 실제 범위 채팅(복구 전 인스타 줄 포함)은 복구 뒤 `youtube`로 적히고 보내지 않음(호출 0). 리허설 범위 줄은 `rehearsal`로 적히고 보냄. 복구 뒤 범위 캐시를 비우지 않은 채 조회해도 글이 비어 보내지 않는 쪽(안전)이다.
  - TD-AIY1-03 유튜브·확장·인스타 줄을 무작위로 섞어 1~3번 제안 받기(6회): 가짜 LLM 원문에 유튜브 줄 표시 없음, 호출 수 = 인스타 줄 있으면 1, `excluded`가 출처와 맞고 유튜브 줄 제안은 `RULE` 또는 `null`.

확인한 경로 (코드 읽기): 공식 수집기·크롬 확장은 `youtube`·`extension`, 리허설 방송은 유튜브 연결이 막혀 있고(`REHEARSAL_LINK`) 확장 수집도 리허설을 거절. 인스타·틱톡·붙여넣기는 기록 기본값 `other`.
