// 두 자리 교대 (D-RETRO-35~39, 복기 E2·E4): 같은 서버에 앱 자리 둘(a·b)을 두고, 새 판을 대기 자리에 띄워 확인한 뒤 갈아 끼운다.
// 이 파일은 "이 프로세스가 어느 자리이고 지금 대기인가 운영인가"만 안다. 뒤 작업을 켜고 끄는 일은 main.ts가 한다.
//
// 상태 (GET /health 의 mode, GET /health/active 의 판단):
//   standby   대기 — HTTP는 받지만 뒤 작업(채팅 수집·발송함·상품 동기화·정리 작업·자동 백업)을 돌리지 않는다. 앞단은 보내지 않는다.
//   active    운영 — 뒤 작업을 돌리고 앞단이 여기로 보낸다.
//   handover  넘기는 중 — 뒤 작업을 멈추고 임대를 내려놓았다. 요청은 그대로 받는다(앞단도 계속 보낸다). 이 사이에 새 자리를 올린다.
//   draining  내리는 중 — 앞단이 알아챌 때까지 잠깐 요청을 더 받고, 실시간 연결을 닫고, 진행 중 요청을 마친 뒤 끝난다.
//
// 대기로 뜰지는 환경값 하나로 못 박지 않고 **자리 표시 파일**로 정한다 (D-RETRO-36):
//   LIVEJJIM_SLOT       이 자리 이름 (a·b 같은 짧은 이름). 비우면 자리 없는 한 대 구성 — 늘 운영으로 뜬다(지금까지와 같다).
//   LIVEJJIM_SLOT_FILE  운영 자리 이름 한 줄이 든 파일(교체 스크립트 deploy/ec2/switch.sh가 올리기 직전에 고쳐 쓴다, 컨테이너는 읽기만).
//                       내용이 이 자리 이름과 같으면 운영, 다르거나 파일이 없으면 대기.
//   환경값으로 "늘 대기"를 못 박으면 운영 자리가 죽었다 살아나거나 서버가 다시 켜질 때 대기로 떠서 아무도 운영이 아니게 된다.
//   LIVEJJIM_COMMIT     이 자리가 도는 판(커밋). 건강 확인에 실어 교체 스크립트가 "새 판이 맞나"를 본다. 비밀값이 아니다.
//
// 올리기·내리기 신호는 HTTP 입구가 아니라 **프로세스 시그널**이다 (D-RETRO-37) — 앞단을 지나 바깥에서 부를 길이 없다:
//   SIGUSR2  대기 → 운영          (docker kill -s USR2 <컨테이너>)  뒤 작업 시작
//   SIGHUP   운영 → 넘기는 중      (docker kill -s HUP <컨테이너>)   뒤 작업만 멈춤 — 두 자리에서 뒤 작업이 같이 돌지 않게 새 자리를 올리기 **전에** 보낸다
//   SIGTERM  운영·넘기는 중 → 내리는 중 → 끝 (docker stop)
import { readFileSync } from 'node:fs'

export type SlotMode = 'standby' | 'active' | 'handover' | 'draining'

/** 앞단이 이 자리로 요청을 보내도 되는 상태인가 (/health/active가 200) */
export const takesTraffic = (mode: SlotMode): boolean => mode === 'active' || mode === 'handover'

/** 건강 확인에 싣는 것 — 자리 이름·판·상태뿐이다(비밀값·판매자 정보 없음) */
export interface SlotView {
  readonly slot: string | null
  readonly commit: string | null
  readonly mode: SlotMode
}

export type SlotSetting =
  | { readonly ok: true; readonly slot: string | null; readonly commit: string | null; readonly standby: boolean; readonly notice: string | null }
  | { readonly ok: false; readonly message: string }

const SLOT_RE = /^[a-z][a-z0-9-]{0,15}$/
const COMMIT_RE = /^[0-9a-f]{7,40}$/

/**
 * 환경값과 자리 표시 파일로 "어느 자리, 어느 판, 대기로 뜰지"를 정한다. 값은 문장에 넣지 않는다.
 * readFile은 파일 읽기(시험에서 바꿔 끼운다) — 못 읽으면 던진다.
 */
export function readSlotSetting(env: Readonly<Record<string, string | undefined>>, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): SlotSetting {
  const slot = env['LIVEJJIM_SLOT']?.trim() ?? ''
  const file = env['LIVEJJIM_SLOT_FILE']?.trim() ?? ''
  const commitRaw = env['LIVEJJIM_COMMIT']?.trim() ?? ''
  // 판 표시는 꾸밈이다 — 모양이 틀려도 서버를 막지 않고 모름(null)으로 둔다
  const commit = COMMIT_RE.test(commitRaw) ? commitRaw : null
  if (slot === '') {
    if (file !== '') return { ok: false, message: '자리 표시 파일(LIVEJJIM_SLOT_FILE)을 쓰려면 자리 이름(LIVEJJIM_SLOT)도 적어 주세요.' }
    return { ok: true, slot: null, commit, standby: false, notice: null }
  }
  if (!SLOT_RE.test(slot)) return { ok: false, message: '자리 이름(LIVEJJIM_SLOT)은 a·b처럼 영문 소문자로 시작하는 짧은 이름으로 적어 주세요.' }
  // 자리 이름만 있고 파일이 없는 구성은 받지 않는다 — 두 자리가 모두 운영으로 떠서 뒤 작업이 두 곳에서 돈다
  if (file === '') return { ok: false, message: '자리 이름(LIVEJJIM_SLOT)을 적었으면 자리 표시 파일(LIVEJJIM_SLOT_FILE)도 적어 주세요.' }
  let active: string
  try {
    active = readFile(file).trim()
  } catch {
    // 파일이 없으면 대기로 뜬다: 운영이 둘이 되는 것(뒤 작업 두 번)보다 교체 스크립트가 올려 줄 때까지 기다리는 쪽이 안전하다
    return { ok: true, slot, commit, standby: true, notice: '자리 표시 파일을 읽지 못해 대기로 떠요.' }
  }
  return { ok: true, slot, commit, standby: active !== slot, notice: null }
}

/** 이 프로세스의 자리 상태. 한 방향으로만 간다: standby → active → handover → draining */
export class SlotState {
  readonly #slot: string | null
  readonly #commit: string | null
  #mode: SlotMode

  constructor(setting: { readonly slot: string | null; readonly commit: string | null; readonly standby: boolean }) {
    this.#slot = setting.slot
    this.#commit = setting.commit
    this.#mode = setting.standby ? 'standby' : 'active'
  }

  get mode(): SlotMode {
    return this.#mode
  }

  get commit(): string | null {
    return this.#commit
  }

  view(): SlotView {
    return { slot: this.#slot, commit: this.#commit, mode: this.#mode }
  }

  /** 대기 → 운영. 바뀌었으면 true (이미 운영이거나 내리는 중이면 false — 내리는 자리를 다시 올리지 않는다) */
  promote(): boolean {
    if (this.#mode !== 'standby') return false
    this.#mode = 'active'
    return true
  }

  /** 운영 → 넘기는 중 (뒤 작업을 다 멈춘 **뒤에** 부른다 — 교체 스크립트가 이 상태를 보고 새 자리를 올린다). 바뀌었으면 true */
  handover(): boolean {
    if (this.#mode !== 'active') return false
    this.#mode = 'handover'
    return true
  }

  /** 운영·넘기는 중·대기 → 내리는 중. 바뀌었으면 true */
  drain(): boolean {
    if (this.#mode === 'draining') return false
    this.#mode = 'draining'
    return true
  }
}
