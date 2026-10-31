// KP1 RA-KP1-006: 공개 양식(확인서 링크 동의 칸·공개 일정 알림 신청)에 그 가게 판매자(또는 보조자)의 유효한 로그인 세션 쿠키가 함께 왔는지.
// 판매자가 자기 링크·자기 공개 페이지에서 손님 대신 동의하지 못하게 한다(손님 동의와 구별할 수 없다).
// 세션을 늘리지 않는 읽기만 한다(공개 경로가 판매자 세션을 바꾸지 않는다). 토큰·쿠키는 로그에 남기지 않는다.
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE } from './auth.ts'
import type { Db } from './db/database.ts'
import { tokenHash } from './secrets.ts'
import { findSession } from './store.ts'
import type { Clock } from './time.ts'

/** 손님 대신 동의할 수 없다는 한 문장 (확인서 링크·공개 일정 페이지 같은 문장) */
export const SELLER_CANNOT_CONSENT = '판매자 로그인 화면에서는 손님 대신 동의할 수 없어요.'

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/

/** 요청 쿠키의 세션이 살아 있고 그 판매자의 것인지 (역할은 판매자·보조자 모두) */
export async function sellerSignedIn(c: Context, db: Db, clock: Clock, sellerId: string): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token === undefined || !TOKEN_RE.test(token)) return false
  const row = await findSession(db, tokenHash(token), new Date(clock.now()))
  return row !== null && row.sellerId === sellerId
}
