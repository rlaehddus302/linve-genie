// 개인정보처리방침·이용약관 초안 (SYS-05, D-I3-15, AC-I3-77·78). 로그인 없이 열린다(앱이 세션 확인을 기다리지 않는다).
// 법률 검토 전 초안이다 — 확정은 사용자 몫(D-012). 정해지지 않은 값은 "[미정]"·"[검토 필요]"로 둔다.
// 바깥 주소(구글·유튜브)는 새 탭으로 연다 — 이 화면은 그 주소를 부르지 않는다.
import type { ReactNode } from 'react'

export const DRAFT_NOTICE = '초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.'
export const GOOGLE_PRIVACY_URL = 'https://policies.google.com/privacy'
export const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions'
export const YOUTUBE_TERMS_URL = 'https://www.youtube.com/t/terms'
export const TAX_NOTE = '구매 내역 확인서는 세금계산서·현금영수증 같은 세법상 증빙이 아니에요'

function Outside({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
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
      <p>라이브찜(이하 "서비스")은 유튜브 라이브 판매자가 주문(찜)을 받고 정산하도록 돕는 서비스예요. 서비스가 어떤 정보를 왜, 얼마나 보관하는지 알려 드려요.</p>
      <Section title="1. 처리하는 정보">
        <ul>
          <li>판매자·보조자 계정: 아이디, 비밀번호(알아볼 수 없게 바꾼 값만 저장), 가게 이름, 보조자 이름</li>
          <li>유튜브 연결 정보: 연결한 채널의 이름과 채널 번호, 구글 인증 정보(암호로 바꿔 보관)</li>
          <li>시청자 정보: 판매자의 방송 채팅에 쓴 시청자의 유튜브 채널 번호·표시 이름·채팅 내용</li>
          <li>문자찜 구매자 정보: 판매자가 적은 이름·메모. 휴대폰 번호 원문은 저장하지 않아요(알아볼 수 없게 바꾼 값과 뒤 4자리만 저장해요).</li>
          <li>정산 기록: 판매·입금·배송비·할인·환불 기록</li>
          <li>로그인 쿠키: 로그인 상태를 지키는 쿠키 하나</li>
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
          서비스에 준 권한은 라이브찜 설정 → 유튜브 → "연결 끊기"로 언제든 끊을 수 있고, <Outside href={GOOGLE_PERMISSIONS_URL}>구글 계정 권한 페이지</Outside>에서도 거둘 수 있어요.
        </p>
      </Section>
      <Section title="5. 제3자 제공">
        <p>개인정보를 다른 회사나 사람에게 제공하지 않아요.</p>
      </Section>
      <Section title="6. 처리 위탁">
        <p>서버 운영(호스팅): [미정]</p>
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
      <Section title="12. 시행일">
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
        <p>라이브찜은 유튜브 라이브 판매의 주문(찜) 받기, 문자찜 입력, 구매자·정산 관리, 라벨 출력, 구매 감사 메시지 게시를 돕는 서비스예요.</p>
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
