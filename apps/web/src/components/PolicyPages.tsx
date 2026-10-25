// 개인정보처리방침·이용약관 초안 (SYS-05, D-I3-15, AC-I3-77·78). 로그인 없이 열린다(앱이 세션 확인을 기다리지 않는다).
// 법률 검토 전 초안이다 — 확정은 사용자 몫(D-012). 정해지지 않은 값은 "[미정]"·"[검토 필요]"로 둔다.
// N4b: 개인정보처리방침에 "구매자 확인서 공유 링크" 문단(AC-N4b-35).
// T1: 개인정보처리방침에 "택배 배송지" 문단(AC-T1-80 — 수집 항목·목적·제공(택배사)·보관(주문 날짜 + 30일)), 처리하는 정보·제3자 제공에도 한 줄씩.
// L1: 수집 항목에 간편 로그인 연결 정보(공급자 계정 번호·가린 이메일 — AC-L1-13), 쿠키에 간편 로그인 확인 쿠키.
// A1: "AI 제안(선택)" 문단(AC-A1-23, D-A1-06) — 판매자가 켠 경우에만 확인 필요 댓글의 글(닉네임·전화번호 뺀 것)과 상품 이름·옵션이 Anthropic(미국)으로.
// 바깥 주소(구글·유튜브)는 새 탭으로 연다 — 이 화면은 그 주소를 부르지 않는다.
import type { ReactNode } from 'react'
import { SERVICE_NAME } from '../brand.ts'

export const DRAFT_NOTICE = '초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.'
export const GOOGLE_PRIVACY_URL = 'https://policies.google.com/privacy'
export const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions'
export const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms'
/** 구매자 확인서 공유 링크 문단 (N4b AC-N4b-35, D-N4b-01·02) */
export const RECEIPT_LINK_WHAT = '판매자가 만든 링크를 받은 사람은 로그인 없이 그 구매자 한 명의 구매 내역·결제 금액·입금 계좌를 볼 수 있어요.'
export const RECEIPT_LINK_PERIOD = '링크는 만든 때부터 14일 뒤에 열리지 않아요. 판매자는 언제든 링크를 끊을 수 있어요.'
export const RECEIPT_LINK_PHONE = '링크 화면에는 휴대폰 번호의 끝 4자리만 보여요.'
/** 택배 배송지 문단 (T1 AC-T1-80, PARCEL_RULES PC-3, D-T1-04·D-T1-14) */
/** 택배 문단의 초안 표시 (위 초안 안내와 다른 글 — 같은 문장이 두 번 보이지 않게) */
export const PARCEL_DRAFT = '이 문단은 택배사 계약과 법률 검토 전의 초안 문장이라 바뀔 수 있어요.'
export const PARCEL_WHAT = '수집하는 항목: 받는 분, 연락처, 주소(상세 주소·우편번호 포함), 배송 메모'
export const PARCEL_WHY = '목적: 그 주문을 택배로 보내는 데(택배 접수·운송장·배송 조회)만 써요.'
export const PARCEL_SHARE = '제공: 판매자가 택배 접수를 하면 그 주문의 받는 분·연락처·주소·배송 메모를 판매자가 고른 택배사에 보내요.'
export const PARCEL_KEEP = '보관: 주문 날짜로부터 30일이 지나면 지워요. 송장번호·택배사·배송 상태는 판매 기록으로 남아요.'
/** 네이버 밴드 연결 때 처리하는 정보 (BND1 AC-BND1-78, D-BND1-14) */
export const BAND_ITEM = '네이버 밴드를 연결하면: 밴드 이름, 내가 쓴 글 목록, 이은 글의 댓글(작성자 이름·작성자 구분 값·글·작성 시각). 밴드에 글이나 댓글을 쓰지 않아요. [검토 필요]'
/** 간편 로그인 연결 정보 (L1 AC-L1-13, D-L1-05) — 공급자 토큰·이메일 원문은 저장하지 않는다 */
export const SOCIAL_LOGIN_ITEM = '간편 로그인을 연결하면: 공급자 계정 번호, 가린 이메일(예: se***@gmail.com)'
/** AI 제안(선택) 문단 (A1 AC-A1-23, D-A1-06) */
export const AI_ASSIST_TITLE = '14. AI 제안(선택)'
export const AI_ASSIST_WHAT =
  '판매자가 설정에서 AI 제안을 켠 경우에만, 확인 필요 댓글의 글(닉네임·전화번호를 뺀 것)과 그 방송의 상품 이름·옵션이 AI 회사 Anthropic(미국)으로 보내져 주문 제안을 만드는 데 쓰여요.'
export const AI_ASSIST_STORE = '서비스는 보낸 글을 따로 저장하지 않아요. 만든 제안(상품 번호·옵션·수량)만 보관해요.'
export const AI_ASSIST_OFF = '판매자는 설정 → AI 제안 → "끄기"로 언제든 끌 수 있어요. 끄면 그때부터 보내지 않아요.'
/** 14번 본문 끝 (QL2 D-QL2-05 ③ — D-AIY1-05 ③을 이 페이지 말투로) */
export const AI_ASSIST_YOUTUBE = '유튜브에서 받은 채팅 글은 보내지 않아요.'
export const TAX_NOTE = '구매 내역 확인서는 세금계산서·현금영수증 같은 세법상 증빙이 아니에요'

function Outside({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a className="text-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="policy-section stack-tight" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function PrivacyPage() {
  return (
    <main className="page policy-page stack">
      <h1>개인정보처리방침(초안)</h1>
      <p className="warning" role="note">
        {DRAFT_NOTICE}
      </p>
      <p>{SERVICE_NAME}(이하 "서비스")는 유튜브 라이브 판매자가 주문(찜)을 받고 정산하도록 돕는 서비스예요. 서비스가 어떤 정보를 왜, 얼마나 보관하는지 알려 드려요.</p>
      <Section title="1. 처리하는 정보">
        <ul>
          <li>판매자·보조자 계정: 아이디, 비밀번호(알아볼 수 없게 바꾼 값만 저장), 가게 이름, 보조자 이름</li>
          <li>유튜브 연결 정보: 연결한 채널의 이름과 채널 번호, 구글 인증 정보(암호로 바꿔 보관)</li>
          <li>시청자 정보: 판매자의 방송 채팅에 쓴 시청자의 유튜브 채널 번호·표시 이름·채팅 내용</li>
          <li>{BAND_ITEM}</li>
          <li>문자찜 구매자 정보: 판매자가 적은 이름·메모. 휴대폰 번호 원문은 저장하지 않아요(알아볼 수 없게 바꾼 값과 뒤 4자리만 저장해요).</li>
          <li>정산 기록: 판매·입금·배송비·할인·환불 기록</li>
          <li>택배 배송지: 구매자나 판매자가 적은 받는 분·연락처·주소·배송 메모(암호로 바꿔 보관 — 13번 참고)</li>
          <li>{SOCIAL_LOGIN_ITEM}</li>
          <li>로그인 쿠키: 로그인 상태를 지키는 쿠키 하나(간편 로그인을 하는 동안에는 10분만 쓰는 확인 쿠키 하나가 더 있어요)</li>
        </ul>
      </Section>
      <Section title="2. 처리 목적">
        <p>주문(찜) 판정, 구매자별 정산, 라벨 출력, 판매자가 동의한 경우의 구매 감사 메시지 게시, 계정 보호에만 써요.</p>
      </Section>
      <Section title="3. 보관 기간">
        <ul>
          <li>유튜브 채팅 내용과 시청자 이름은 방송 날짜부터 30일 뒤에 지워요.</li>
          <li>판매 장부(판매·정산 기록)는 판매자가 계정을 해지할 때까지 남아요.</li>
          <li>백업은 30일 동안 보관하고 그 뒤 지워요.</li>
        </ul>
      </Section>
      <Section title="4. 유튜브 API 서비스">
        <p>서비스는 유튜브 API 서비스를 써서 판매자의 채널 이름, 라이브 방송 목록, 방송 채팅을 읽고, 판매자가 동의하면 구매 감사 메시지를 게시해요.</p>
        <p>
          구글이 정보를 처리하는 방식은 <Outside href={GOOGLE_PRIVACY_URL}>구글 개인정보처리방침</Outside>에서 볼 수 있어요.
        </p>
        <p>
          서비스에 준 권한은 {SERVICE_NAME} 설정 → 유튜브 → "연결 끊기"로 언제든 끊을 수 있고, <Outside href={GOOGLE_PERMISSIONS_URL}>구글 계정 권한 페이지</Outside>에서도 거둘 수 있어요.
        </p>
      </Section>
      <Section title="5. 제3자 제공">
        <p>개인정보를 다른 회사나 사람에게 제공하지 않아요. 다만 판매자가 택배 접수를 하면 그 주문의 배송지를 택배사에 보내요(13번 참고).</p>
      </Section>
      <Section title="6. 처리 위탁">
        <p>서버 운영(호스팅): [미정]</p>
        <p>AI 제안(판매자가 켠 경우만): Anthropic(미국) — 14번 'AI 제안(선택)'을 보세요. [검토 필요]</p>
      </Section>
      <Section title="7. 쿠키">
        <p>로그인 쿠키만 써요. 광고·분석 쿠키는 쓰지 않아요.</p>
      </Section>
      <Section title="8. 안전 조치">
        <p>비밀번호·구글 인증 정보·휴대폰 번호는 암호로 바꾸거나 알아볼 수 없게 바꿔 보관하고, 판매자마다 자기 기록만 볼 수 있게 접근을 막아요.</p>
      </Section>
      <Section title="9. 권리 행사">
        <p>판매자와 구매자는 자기 정보를 보거나 고치거나 지워 달라고 요청할 수 있어요. 아래 연락처로 알려 주세요.</p>
      </Section>
      <Section title="10. 책임자와 연락처">
        <p>개인정보 보호 책임자: [미정] · 연락처: [미정]</p>
      </Section>
      <Section title="11. 판매자와 서비스의 역할">
        <p>판매자가 모은 구매자 정보에 대한 판매자와 서비스의 역할: [검토 필요]</p>
      </Section>
      <Section title="12. 구매자 확인서 공유 링크">
        <ul>
          <li>{RECEIPT_LINK_WHAT}</li>
          <li>{RECEIPT_LINK_PERIOD}</li>
          <li>{RECEIPT_LINK_PHONE}</li>
          <li>링크는 판매자가 구매자에게 직접 보내요. 서비스가 링크를 채팅·메시지로 보내지 않아요. 링크 화면은 검색에 나오지 않게 하고, 메신저 미리 보기에는 이름·금액·그림을 내보내지 않아요.</li>
        </ul>
      </Section>
      <Section title="13. 택배 배송지">
        <p className="hint">{PARCEL_DRAFT}</p>
        <ul>
          <li>{PARCEL_WHAT}</li>
          <li>{PARCEL_WHY}</li>
          <li>{PARCEL_SHARE}</li>
          <li>{PARCEL_KEEP}</li>
          <li>배송지는 판매자 본인만 볼 수 있어요. 구매자 링크에는 받는 분 이름과 연락처 끝 4자리만 다시 보여요. 보조자 계정은 볼 수 없어요.</li>
          <li>택배사: [미정 — 계약 뒤 적어요]</li>
        </ul>
      </Section>
      <Section title={AI_ASSIST_TITLE}>
        <ul>
          <li>{AI_ASSIST_WHAT}</li>
          <li>{AI_ASSIST_STORE}</li>
          <li>{AI_ASSIST_OFF}</li>
          <li>{AI_ASSIST_YOUTUBE}</li>
        </ul>
      </Section>
      <Section title="15. 시행일">
        <p>[미정]</p>
      </Section>
    </main>
  )
}

export function TermsPage() {
  return (
    <main className="page policy-page stack">
      <h1>이용약관(초안)</h1>
      <p className="warning" role="note">
        {DRAFT_NOTICE}
      </p>
      <Section title="1. 서비스 내용">
        <p>{SERVICE_NAME}는 유튜브 라이브 판매의 주문(찜) 받기, 문자찜 입력, 구매자·정산 관리, 라벨 출력, 구매 감사 메시지 게시를 돕는 서비스예요.</p>
      </Section>
      <Section title="2. 계정">
        <ul>
          <li>판매자 계정은 운영자가 만들어 드려요.</li>
          <li>판매자는 설정에서 보조자 계정을 만들 수 있어요. 보조자는 문자찜 입력만 할 수 있어요.</li>
          <li>아이디와 비밀번호는 판매자가 관리해요.</li>
        </ul>
      </Section>
      <Section title="3. 판매자의 책임">
        <p>판매·배송·환불, 세금 신고, 구매자 정보를 모으고 쓰는 일은 판매자의 책임이에요.</p>
        <p>{TAX_NOTE}</p>
      </Section>
      <Section title="4. 유튜브 연결">
        <p>
          유튜브 연결을 쓰면 <Outside href={YOUTUBE_TERMS_URL}>유튜브 이용약관</Outside>에 동의하는 거예요.
        </p>
        <p>구매 감사 메시지 자동 게시는 판매자가 설정에서 동의할 때만 해요. 동의는 언제든 끌 수 있어요.</p>
      </Section>
      <Section title="5. 요금">
        <p>[미정]</p>
      </Section>
      <Section title="6. 서비스 중단과 책임 제한">
        <p>[검토 필요]</p>
      </Section>
      <Section title="7. 해지와 데이터 삭제">
        <p>판매자가 해지를 요청하면 계정과 기록을 지워요. 지운 기록은 되돌릴 수 없어요. 백업에 남은 기록은 30일 안에 지워져요.</p>
      </Section>
      <Section title="8. 시행일">
        <p>[미정]</p>
      </Section>
    </main>
  )
}
