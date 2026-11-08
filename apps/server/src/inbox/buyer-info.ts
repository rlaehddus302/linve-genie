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
  [/^(휴대폰\s*번호|핸드폰\s*번호|전화\s*번호|휴대\s*전화|연락처|휴대폰|핸드폰|핸폰|전화|번호|폰)/, 'phone'],
]

const PROVINCE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(특별시|광역시|특별자치시|특별자치도|시|도)?$/
const PROVINCE_LONG = /^(충청북|충청남|전라북|전라남|경상북|경상남)도$/
const PROVINCE_HEAD = /^((충청북|충청남|전라북|전라남|경상북|경상남)도|(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(특별자치시|특별자치도|특별시|광역시|시|도)?)/
const REGION = /^[가-힣]{1,8}(시|도|군|구)$/
const REGION_HEAD = /^[가-힣]{1,4}?(시|군|구|읍|면)(?=[가-힣])/
const ROAD_WORD = /^[가-힣0-9·.]*[가-힣](로|길)$/
const ROAD_JOINED = /^[가-힣0-9·.]*[가-힣](로|길)\d+(-\d+)?$/
const LOT_WORD = /^[가-힣0-9]*[가-힣](동|리|가)$/
const LOT_JOINED = /^[가-힣]*[가-힣](동|리|가)\d+(-\d+)?(번지)?$/
const NUMBER = /^(산\s?)?\d{1,5}(-\d{1,5})?(번지)?$/
const PHONE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/
const FILLER =
  /^(안녕하세요|안녕하세용|감사합니다|감사해요|고맙습니다|입니다|이에요|예요|부탁드려요|부탁드립니다|부탁해요|보내주세요|보내드려요|주세요|사장님|님|네|넵|저는|제|저|입금했어요|입금했습니다|입금완료|아까|방금|찜한|찜했던|주문한|구매한|산|그리고|이랑)$/
const WORD_TAIL = /(입니다|이에요|예요|이요|입니당|이용|이고요|이구요|이고)$/
const NOISE_TAIL = /[!~.^ㅎㅋㅠㅜ]+$/
/** 문자 꾸밈 그림(이모지)은 빈칸으로 */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu
/** 줄 가운데 꼬리표("…99 이고요 받는분은 박지성", "…주소는 서울…")는 줄을 나눈다. 꼬리표 뒤에 은·는·쌍점이 있을 때만 */
const MID_LABEL = /\s+(?=(받으시는\s*분|받는\s*분|받는\s*사람|수령인|수취인|성함|이름|주소|배송지|연락처|전화\s*번호|휴대폰\s*번호|닉네임)(은|는|\s*[:：]))/g
/** 상세 주소 끝의 "보내주세요" 같은 부탁 말 (정보가 없어 뺀다). 두는 곳 부탁("경비실 앞에 놔주세요")은 택배 기사가 보게 상세 주소에 남긴다 */
const SEND_ASK = /^(보내|발송해|배송해|부쳐|택배)\s*(주세요|주셔요|주시면|주십시오|줘요|부탁)|^(부탁드려요|부탁드립니다|부탁해요|감사합니다|감사해요|고맙습니다)$/
const SEND_TO = /^(앞으로|으로|로|에게|한테|께|님께|님앞으로)$/
const DETAIL_FILLER = /^(이고요|이구요|이에요|예요|입니다|이요|요|이랑|그리고|입니당|이고)$/
/** 사람 이름 모양: 흔한 성 + 두 글자(세 글자 이름), 또는 두 글자 성 + 두 글자 */
const SURNAME =
  /^(김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|진|나|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|소|석|선|설|마|길|연|위|표|명|기|반|왕|금|옥|육|인|맹|제|모|탁|국|어|은|편|용|예|봉|경|태|목|형|피|두|감|음|빈|온|호|범|좌|팽|승|간|상|갈|단|견|당)[가-힣]{2}$/
const COMPOUND_SURNAME = /^(남궁|황보|제갈|선우|독고|사공|서문|동방)[가-힣]{2}$/
/** 이름이 아닌 장소 끝말 (우편함·경비실·관리실·정문앞·우체국·서울역·주차장…) */
const PLACE_END = /(함|실|관|앞|뒤|옆|층|문|점|청|장|소|터|집|방|당|사|국|과|역|교|빌|텔|트|타|단지|센터)$/
const NAME_SUFFIX = /(님께|님에게|님앞|님|씨)$/

const isRegion = (token: string): boolean => PROVINCE.test(token) || PROVINCE_LONG.test(token) || REGION.test(token)
const isRoadOrLot = (token: string): boolean => ROAD_JOINED.test(token) || LOT_JOINED.test(token) || ROAD_WORD.test(token) || LOT_WORD.test(token)

/** 붙여 쓴 주소 조각("서울시강남구테헤란로12")을 시·군·구·읍·면 단위로 나눈다. 나눈 끝이 도로명·지번이 아니면 그대로 */
function splitJoined(token: string): string[] {
  if ([...token].length < 5) return [token]
  const out: string[] = []
  let rest = token
  const head = PROVINCE_HEAD.exec(rest)
  // "서울시"·"경기도"처럼 끝말이 붙은 지역만 홀로 믿는다 ("세종대로110"의 "세종"은 지역이 아님)
  const headSure = head !== null && head[0] !== head[3]
  if (head !== null && head[0].length < rest.length) {
    out.push(head[0])
    rest = rest.slice(head[0].length)
  }
  let regions = 0
  for (;;) {
    const m = REGION_HEAD.exec(rest)
    if (m === null) break
    out.push(m[0])
    rest = rest.slice(m[0].length)
    regions++
  }
  if (out.length === 0 || rest === '' || !isRoadOrLot(rest) || (regions === 0 && !headSure)) return [token]
  return [...out, rest]
}

const tokensOf = (value: string): string[] => value.split(' ').filter((token) => token !== '').flatMap(splitJoined)

/** 사람 이름 모양 낱말이면 이름(님·씨를 뗀), 아니면 null */
function personName(token: string): string | null {
  const word = token.replace(NOISE_TAIL, '').replace(NAME_SUFFIX, '')
  if (PLACE_END.test(word)) return null
  return SURNAME.test(word) || COMPOUND_SURNAME.test(word) ? word : null
}

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

/** 닉네임·이름 후보 다듬기: 앞 `@`·끝 "입니다"·"ㅎㅎ" 같은 말을 뗀다. 남는 게 없거나 군말·숫자 든 조각이면 null */
function wordOf(raw: string): string | null {
  let word = clean(raw).replace(/^[-•·*>:：]+/, '').replace(NOISE_TAIL, '').trim()
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

/** 상세 주소 다듬기: 군말·"보내주세요" 같은 부탁 말을 빼고, 끝에 붙은 사람 이름은 떼어 이름 후보로 */
function tidyDetail(tokens: readonly string[]): { detail: string[]; name: string | null } {
  let detail = tokens.map((token) => (/\d/.test(token) ? token : token.replace(NOISE_TAIL, ''))).filter((token) => token !== '' && !DETAIL_FILLER.test(token))
  while (detail.length > 0 && SEND_ASK.test(detail[detail.length - 1] as string)) detail = detail.slice(0, -1)
  while (detail.length > 0 && SEND_TO.test(detail[detail.length - 1] as string)) detail = detail.slice(0, -1)
  const last = detail[detail.length - 1]
  const name = last === undefined ? null : personName(last)
  if (name !== null) detail = detail.slice(0, -1)
  return { detail, name }
}

/** 손님 정보 문자 읽기. 주소가 없으면 null */
export function readBuyerInfo(input: string): BuyerInfoText | null {
  const text = input.normalize('NFC').replace(EMOJI, ' ')
  const phoneMatch = PHONE.exec(text)
  const phone = phoneMatch === null ? null : phoneMatch[0].replace(/\D/g, '')
  const pieces = text
    .replace(MID_LABEL, '\n')
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
    const kept = tokens.filter((token) => !/\d/.test(token)).map(wordOf).filter((word): word is string => word !== null)
    if (kept.length > 1 && kept.length <= 3) words.push(kept.join(' '))
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
    if (value === '') continue
    let tokens = tokensOf(value)
    let found = findAddress(tokens)
    if (label === 'nickname' || label === 'name') {
      // "닉네임 나래 김나래 부산 …", "받는사람 정우성 서울 …": 꼬리표 낱말 뒤에 주소가 이어지면 앞 낱말만 꼬리표 값
      const before = found === null ? tokens : tokens.slice(0, found.start)
      const word = before.length === 0 ? null : wordOf(found === null ? value : (before[0] as string))
      if (word !== null) {
        if (label === 'nickname') nickname = word
        else name = word
      }
      if (found === null || address !== null) {
        afterAddress = false
        continue
      }
      pushWords(before.slice(1))
      tokens = tokens.slice(found.start)
      found = { start: 0, end: found.end - found.start }
    }
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
      detail.push(...tokens)
      continue
    }
    afterAddress = false
    if (tokens.length <= 3) pushWords(tokens)
  }
  if (address === null) return null
  const tidy = tidyDetail(detail)
  if (tidy.name !== null) words.push(tidy.name)
  return {
    nickname,
    name,
    words: [...new Set(words)],
    phone: phone !== null && /^01\d{8,9}$/.test(phone) ? phone : null,
    address: [...address].slice(0, 100).join(''),
    detail: [...clean(tidy.detail.join(' ')).replace(/^\(|\)$/g, '')].slice(0, 100).join(''),
  }
}

/** 이름 맞추기용 다듬기: NFC, 영문 소문자, 빈칸·`@` 지움 */
export function matchKey(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[\s@]/g, '')
}

/** 한국 사람 이름 모양 (한글 2~5자) */
export const looksLikeName = (value: string): boolean => /^[가-힣]{2,5}$/.test(value.replace(/\s/g, ''))
