// 방송 뒤 손님 정보 문자 읽기 (ORD-14, D-REAL-11) — 순수 함수. 시계·I/O 없음.
// "닉네임 길동이 / 성함 홍길동 / 주소 서울시 강남구 테헤란로 12 3층" 같은 문자에서 닉네임·이름·연락처·주소·상세 주소를 읽는다.
// 주소를 못 읽으면 null — 손님 정보 문자가 아니다(찜·잡담을 배송지로 잘못 넣지 않게).

export interface BuyerInfoText {
  /** 꼬리표로 적은 닉네임 */
  readonly nickname: string | null
  /** 꼬리표로 적은 이름(받는 분) */
  readonly name: string | null
  /** 꼬리표 없는 짧은 조각 (닉네임·이름 후보, 적힌 차례) */
  readonly words: readonly string[]
  /** 글 속 휴대폰 번호 (숫자만) */
  readonly phone: string | null
  readonly address: string
  readonly detail: string
}

type Label = 'nickname' | 'name' | 'address' | 'phone'

const LABELS: readonly (readonly [RegExp, Label])[] = [
  [/^(유튜브\s*닉네임|유튜브\s*닉|닉네임|닉넴|닉|유튜브|아이디)/, 'nickname'],
  [/^(받으시는\s*분|받는\s*분|받는\s*사람|수령인|수취인|성함|이름|성명)/, 'name'],
  [/^(배송지\s*주소|배송\s*주소|배송지|주소)/, 'address'],
  [/^(휴대폰\s*번호|핸드폰\s*번호|전화\s*번호|연락처|휴대폰|핸드폰|전화|번호)/, 'phone'],
]

const PROVINCE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(특별시|광역시|특별자치시|특별자치도|시|도)?$/
const PROVINCE_LONG = /^(충청북|충청남|전라북|전라남|경상북|경상남)도$/
const REGION = /^[가-힣]{1,8}(시|도|군|구)$/
const ROAD_WORD = /^[가-힣0-9·.]*[가-힣](로|길)$/
const ROAD_JOINED = /^[가-힣0-9·.]*[가-힣](로|길)\d+(-\d+)?$/
const LOT_WORD = /^[가-힣0-9]*[가-힣](동|리|가)$/
const LOT_JOINED = /^[가-힣]*[가-힣](동|리|가)\d+(-\d+)?(번지)?$/
const NUMBER = /^(산\s?)?\d{1,5}(-\d{1,5})?(번지)?$/
const PHONE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/
const FILLER = /^(안녕하세요|안녕하세용|감사합니다|감사해요|고맙습니다|입니다|이에요|예요|부탁드려요|부탁드립니다|부탁해요|보내주세요|보내드려요|주세요|사장님|님|네|넵|저는|제|저|입금했어요|입금했습니다|입금완료)$/
const WORD_TAIL = /(입니다|이에요|예요|이요|입니당|이용)$/

const isRegion = (token: string): boolean => PROVINCE.test(token) || PROVINCE_LONG.test(token) || REGION.test(token)

/** 조각 안에서 주소 시작(지역 낱말)과 번지 끝 자리를 찾는다. 없으면 null */
function findAddress(tokens: readonly string[]): { start: number; end: number } | null {
  for (let start = 0; start < tokens.length; start++) {
    if (!isRegion(tokens[start] as string)) continue
    for (let i = start + 1; i < tokens.length; i++) {
      const token = tokens[i] as string
      const next = tokens[i + 1]
      if (ROAD_JOINED.test(token) || (LOT_JOINED.test(token) && !/번$/.test(token))) return { start, end: i }
      if ((ROAD_WORD.test(token) || LOT_WORD.test(token)) && next !== undefined && NUMBER.test(next)) return { start, end: i + 1 }
    }
  }
  return null
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** 닉네임·이름 후보 다듬기: 앞 `@`·끝 "입니다" 같은 말을 뗀다. 남는 게 없거나 군말이면 null */
function wordOf(raw: string): string | null {
  let word = clean(raw).replace(/^[-•·*>:：]+/, '').replace(/[.!~^]+$/, '').trim()
  word = word.replace(WORD_TAIL, '').trim()
  if (word === '' || FILLER.test(word) || [...word].length > 20) return null
  return word
}

function labelOf(piece: string): { label: Label; value: string } | null {
  for (const [re, label] of LABELS) {
    const m = re.exec(piece)
    if (m === null) continue
    const rest = piece.slice(m[0].length)
    // 꼬리표 바로 뒤는 구분 기호·빈칸·끝이어야 한다("이름" 다음에 바로 글자가 붙은 "이름표" 같은 낱말은 꼬리표가 아님)
    if (rest !== '' && !/^[\s:：)\]=\-은는]/.test(rest)) continue
    return { label, value: clean(rest.replace(/^[\s:：)\]=-]*(은|는)?[\s:：]*/, '')) }
  }
  return null
}

/** 손님 정보 문자 읽기. 주소가 없으면 null */
export function readBuyerInfo(input: string): BuyerInfoText | null {
  const text = input.normalize('NFC')
  const phoneMatch = PHONE.exec(text)
  const phone = phoneMatch === null ? null : phoneMatch[0].replace(/\D/g, '')
  const pieces = text
    .split(/[\n\r/|,，]+/)
    .map(clean)
    .filter((piece) => piece !== '')
  let nickname: string | null = null
  let name: string | null = null
  let address: string | null = null
  let detail: string[] = []
  const words: string[] = []
  let pending: Label | null = null
  let afterAddress = false
  const pushWords = (tokens: readonly string[]) => {
    const kept = tokens.map(wordOf).filter((word): word is string => word !== null)
    if (kept.length > 1) words.push(kept.join(' '))
    words.push(...kept)
  }
  for (const rawPiece of pieces) {
    // 연락처 조각에서 번호는 이미 읽었다
    const piece = clean(rawPiece.replace(PHONE, ' '))
    const labeled = labelOf(piece)
    const label = labeled?.label ?? pending
    const value = labeled === null ? piece : labeled.value
    // 연락처 꼬리표는 번호를 글 전체에서 이미 읽었으니 다음 줄로 넘기지 않는다
    if (labeled !== null && value === '' && labeled.label !== 'phone') {
      pending = labeled.label
      afterAddress = false
      continue
    }
    pending = null
    if (label === 'phone') {
      afterAddress = false
      continue
    }
    if (label === 'nickname' || label === 'name') {
      const word = wordOf(value)
      if (word !== null) {
        if (label === 'nickname') nickname = word
        else name = word
      }
      afterAddress = false
      continue
    }
    if (value === '') continue
    const tokens = value.split(' ')
    const found = findAddress(tokens)
    if (address === null && found !== null) {
      pushWords(tokens.slice(0, found.start))
      address = tokens.slice(found.start, found.end + 1).join(' ')
      detail = tokens.slice(found.end + 1)
      afterAddress = true
      continue
    }
    if (label === 'address' && address === null) {
      // 꼬리표로 적은 주소인데 번지를 못 찾음: 주소로 믿되 상세 주소는 나누지 않는다 (지역 낱말은 있어야)
      if (tokens.some(isRegion)) {
        address = value
        afterAddress = true
        continue
      }
    }
    // 주소 바로 뒤 조각: 숫자가 들었으면 상세 주소("3층", "101동 1203호")
    if (afterAddress && /\d/.test(value) && [...value].length <= 40) {
      detail.push(value)
      continue
    }
    afterAddress = false
    if (tokens.length <= 3) pushWords(tokens)
  }
  if (address === null) return null
  return {
    nickname,
    name,
    words: [...new Set(words)],
    phone: phone !== null && /^01\d{8,9}$/.test(phone) ? phone : null,
    address: [...address].slice(0, 100).join(''),
    detail: [...clean(detail.join(' ')).replace(/^\(|\)$/g, '')].slice(0, 100).join(''),
  }
}

/** 이름 맞추기용 다듬기: NFC, 영문 소문자, 빈칸·`@` 지움 */
export function matchKey(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[\s@]/g, '')
}

/** 한국 사람 이름 모양 (한글 2~5자) */
export const looksLikeName = (value: string): boolean => /^[가-힣]{2,5}$/.test(value.replace(/\s/g, ''))
