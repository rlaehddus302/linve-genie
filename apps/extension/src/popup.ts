// 확장 팝업 (X1 YT-10 AC4·AC6): 연결 코드 넣기 · 지금 상태 · 회차 고르기 · 연결 지우기.
// 서버 문장은 글자로만 넣는다(textContent) — HTML로 넣지 않는다.
import { chromeApi } from './chrome.ts'
import type { BroadcastChoice, HubView } from './hub.ts'
import { WORDS } from './words.ts'

const chrome = chromeApi()
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const ask = async <T>(message: unknown): Promise<T | undefined> => {
  try {
    return (await chrome.runtime.sendMessage(message)) as T
  } catch {
    return undefined
  }
}

function show(view: HubView): void {
  const state = $('state')
  state.textContent = view.message
  state.dataset['light'] = view.light
  const dropped = $('dropped')
  dropped.hidden = view.dropped === 0
  dropped.textContent = view.dropped === 0 ? '' : `${WORDS.DROPPED} (${String(view.dropped)}개)`
  $('connect').hidden = view.connected
  $('connected').hidden = !view.connected
  if (view.connected && view.video !== null) void loadPick()
  else $('pick').hidden = true
}

async function refresh(): Promise<void> {
  const view = await ask<HubView>({ type: 'view' })
  if (view !== undefined) show(view)
}

let picked: string | null = null

async function loadPick(): Promise<void> {
  const result = await ask<{ bound: BroadcastChoice | null; broadcasts: readonly BroadcastChoice[]; message: string | null }>({ type: 'broadcasts' })
  const section = $('pick')
  if (result === undefined || result.bound !== null) {
    section.hidden = true
    return
  }
  section.hidden = false
  const list = $('pick-list')
  list.replaceChildren()
  $('pick-error').textContent = result.message ?? (result.broadcasts.length === 0 ? '오늘 진행 중인 방송이 없어요. 라이브지니에서 방송을 먼저 시작해 주세요.' : '')
  for (const item of result.broadcasts) {
    const label = document.createElement('label')
    label.className = 'choice'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'broadcast'
    input.value = item.id
    input.addEventListener('change', () => {
      picked = item.id
    })
    const text = document.createElement('span')
    text.textContent = item.title === '' ? item.date : `${item.title} (${item.date})`
    label.append(input, text)
    list.append(label)
  }
  ;($('pick-save') as HTMLButtonElement).disabled = result.broadcasts.length === 0
}

$('connect').addEventListener('submit', (event) => {
  event.preventDefault()
  const button = $('connect').querySelector('button') as HTMLButtonElement
  button.disabled = true
  void ask<{ ok: boolean; message: string; view: HubView }>({ type: 'connect', code: ($('code') as HTMLInputElement).value }).then((result) => {
    button.disabled = false
    $('connect-error').textContent = result === undefined || result.ok ? '' : result.message
    if (result !== undefined) {
      if (result.ok) ($('code') as HTMLInputElement).value = ''
      show(result.view)
    }
  })
})

$('pick-save').addEventListener('click', () => {
  if (picked === null) {
    $('pick-error').textContent = '받을 방송을 하나 골라 주세요.'
    return
  }
  void ask<{ ok: boolean; message: string | null }>({ type: 'bind', broadcast: picked }).then((result) => {
    if (result?.ok === true) {
      $('pick').hidden = true
      void refresh()
    } else $('pick-error').textContent = result?.message ?? '고르지 못했어요. 다시 해 주세요.'
  })
})

$('forget').addEventListener('click', () => {
  void ask<HubView>({ type: 'forget' }).then((view) => {
    if (view !== undefined) show(view)
  })
})

void refresh()
