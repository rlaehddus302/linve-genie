// 우체국 창구소포 간편사전접수 — 앱 안 화면에 넣는 스크립트와 그 답 읽기 (EP1 PARCEL_RULES PC-9, D-EP1-05~D-EP1-07).
// - 넣는 스크립트는 우체국 화면 안에서 돈다: 칸 이름(라벨·title·placeholder·name·id·표 머리글)으로 칸을 찾아 값만 채우고, 아무 단추도 누르지 않는다.
//   약관 동의·주소 검색·신청은 판매자가 직접 누른다.
// - 배송지는 우체국 호스트에서만 넣는다: 앱이 주소를 보고 넣고, 스크립트도 location.hostname을 다시 본다(D-EP1-06).
// - 받는 분/보내는 분 구역을 가릴 수 없는데 같은 칸이 둘 이상이면 채우지 않는다 — 잘못 채우는 것이 못 채우는 것보다 나쁘다(PC-0 1).
// - 스크립트는 글(문자열)로 둔다: 번들러가 함수를 바꿔 쓰면 웹 화면 안에서 깨질 수 있다. 시험은 jsdom에서 이 글을 그대로 돌린다.
import type { EpostFieldKey, EpostFillView } from '@livejjim/web/src/api/parcel-types.ts'

/** 채운 칸 이름 (`receiver.name` · `sender.zip` · `item` …) */
export type EpostSlot = `${'receiver' | 'sender'}.${Exclude<EpostFieldKey, 'item' | 'memo'>}` | 'item' | 'memo'

export type AgentMessage =
  | {
      readonly type: 'fill'
      readonly filled: readonly EpostSlot[]
      readonly readonly: readonly EpostSlot[]
      readonly missing: readonly EpostSlot[]
      readonly ambiguous: readonly EpostSlot[]
    }
  | { readonly type: 'receipt'; readonly lines: readonly string[] }
  /** 비회원 신청 비밀번호 칸을 채운 수 (EP1 D-EP1-14) */
  | { readonly type: 'password'; readonly filled: number }
  /** [다음]으로 받는 분을 목록에 더한 결과 (EP1 D-EP1-19). reason: agree = [필수동의] 체크 전 · notfound = 단추·목록 없음 · refused = 신청서가 받지 않음(messages에 신청서 문장) */
  | { readonly type: 'commit'; readonly ok: boolean; readonly reason: 'agree' | 'notfound' | 'refused' | null; readonly count: number; readonly messages: readonly string[] }
  /** [받는 분 추가]로 받는 분 칸을 비운 결과 */
  | { readonly type: 'added'; readonly ok: boolean }
  | { readonly type: 'host'; readonly ok: false }

const SLOTS: readonly EpostSlot[] = [
  'receiver.name',
  'receiver.zip',
  'receiver.address',
  'receiver.detail',
  'receiver.mobile',
  'receiver.phone',
  'sender.name',
  'sender.zip',
  'sender.address',
  'sender.detail',
  'sender.mobile',
  'sender.phone',
  'item',
  'memo',
]
const isSlot = (value: unknown): value is EpostSlot => typeof value === 'string' && (SLOTS as readonly string[]).includes(value)
const slotList = (value: unknown): EpostSlot[] | null => (Array.isArray(value) && value.every(isSlot) ? [...value] : null)

/** 화면 이름 (못 찾은 칸 안내) */
export const SLOT_WORDS: Readonly<Record<EpostSlot, string>> = {
  'receiver.name': '받는 분 이름',
  'receiver.zip': '받는 분 우편번호',
  'receiver.address': '받는 분 주소',
  'receiver.detail': '받는 분 상세 주소',
  'receiver.mobile': '받는 분 휴대전화',
  'receiver.phone': '받는 분 전화',
  'sender.name': '보내는 분 이름',
  'sender.zip': '보내는 분 우편번호',
  'sender.address': '보내는 분 주소',
  'sender.detail': '보내는 분 상세 주소',
  'sender.mobile': '보내는 분 휴대전화',
  'sender.phone': '보내는 분 전화',
  item: '내용품',
  memo: '배송 메모',
}

/** 웹 화면이 보낸 글 → 답 (모양이 틀리면 null — 우체국 화면의 다른 스크립트가 보낸 것일 수 있다) */
export function readAgentMessage(data: unknown): AgentMessage | null {
  if (typeof data !== 'string' || data.length > 20_000) return null
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record['source'] !== 'livejjim-epost') return null
  if (record['type'] === 'host') return { type: 'host', ok: false }
  if (record['type'] === 'password') {
    const filled = record['filled']
    return typeof filled === 'number' && Number.isInteger(filled) && filled >= 0 && filled <= 10 ? { type: 'password', filled } : null
  }
  if (record['type'] === 'commit') {
    const { ok, reason, count, messages } = record as Record<string, unknown>
    if (typeof ok !== 'boolean' || typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null
    if (reason !== null && reason !== 'agree' && reason !== 'notfound' && reason !== 'refused') return null
    const list = Array.isArray(messages) ? messages.filter((item): item is string => typeof item === 'string').slice(0, 5).map((item) => item.slice(0, 200)) : []
    return { type: 'commit', ok, reason: reason as 'agree' | 'notfound' | 'refused' | null, count, messages: list }
  }
  if (record['type'] === 'added') {
    return typeof record['ok'] === 'boolean' ? { type: 'added', ok: record['ok'] } : null
  }
  if (record['type'] === 'receipt') {
    const lines = record['lines']
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string')) return null
    return {
      type: 'receipt',
      lines: (lines as string[]).slice(0, 20).map((line) => line.slice(0, 200)),
    }
  }
  if (record['type'] === 'fill') {
    const filled = slotList(record['filled'])
    const readonly = slotList(record['readonly'])
    const missing = slotList(record['missing'])
    const ambiguous = slotList(record['ambiguous'])
    if (filled === null || readonly === null || missing === null || ambiguous === null) return null
    return { type: 'fill', filled, readonly, missing, ambiguous }
  }
  return null
}

/** 주소가 우체국 호스트인지 (https만) */
export function isEpostUrl(url: string, hosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return hosts.some((item) => host === item || host.endsWith(`.${item}`))
}

/** 앱 안 화면이 열어도 되는 주소: https와 빈 쪽만 (전화·앱 열기 등 다른 주소는 막는다) */
export const canOpenInView = (url: string): boolean => url.startsWith('https://') || url === 'about:blank'

/**
 * 완료 화면 글줄 → 접수번호 후보 (앞에서부터, 같은 것은 하나). 줄에서 접수번호 낱말 뒤의 영숫자·하이픈 덩어리 중 숫자가 6개 이상인 것.
 * 판매자가 확인한 뒤에만 잇는다 — 여기서 찾은 것을 저절로 저장하지 않는다.
 */
export function receiptCandidates(lines: readonly string[], words: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').normalize('NFKC')
    const word = words.find((item) => line.includes(item))
    if (word === undefined) continue
    // 낱말 뒤 같은 줄, 없으면 다음 줄 (표에서 머리글과 값이 다른 줄일 때)
    const tail = line.slice(line.indexOf(word) + word.length)
    const pool = [tail, (lines[i + 1] ?? '').normalize('NFKC')]
    for (const text of pool) {
      const found = (text.match(/[0-9A-Za-z][0-9A-Za-z-]{4,38}[0-9A-Za-z]/g) ?? []).find((token) => (token.match(/[0-9]/g) ?? []).length >= 6)
      if (found !== undefined) {
        const clean = found.replace(/-/g, '').toUpperCase()
        if (!out.includes(clean)) out.push(clean)
        break
      }
    }
  }
  return out
}

/** 스크립트에 넣는 값 (배송지·보내는 사람·칸 힌트·우체국 호스트) */
function agentData(view: EpostFillView): string {
  const data = { fill: view.fill, form: view.form, hosts: view.hosts }
  // </script> 같은 글이 섞여도 스크립트 글이 끊기지 않게 < > & 와 줄 구분자를 \u로
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** 칸 채우기 스크립트 (그 쪽에서 한 번 — 칸이 늦게 그려지면 0.7초마다 15초까지 다시 본다) */
export function fillScript(view: EpostFillView): string {
  return `(function(){${AGENT_CORE}
var DATA=${agentData(view)};
if(!hostOk(DATA.hosts)){post({type:'host',ok:false});return;}
var tries=0;
function attempt(){
  var report=fillAll(DATA);
  if(report.filled.length===0&&tries<21){tries++;setTimeout(attempt,700);return;}
  post(report);
  late(report,0);
}
// 늦게 그려지는 칸(모바일 신청서의 물품 정보 등 — D-EP1-19): 내용품·배송 요청을 못 채웠으면 0.7초마다 14초까지 그 칸만 다시 본다
function late(report,n){
  var want=report.missing.filter(function(s){return s==='item'||s==='memo';});
  if(want.length===0||n>=20)return;
  setTimeout(function(){
    var r=fillAll(DATA,want);
    if(r.filled.length>0){
      r.filled.forEach(function(s){report.filled.push(s);report.missing=report.missing.filter(function(m){return m!==s;});if(r.readonly.indexOf(s)>=0)report.readonly.push(s);});
      post(report);
    }
    late(report,n+1);
  },700);
}
attempt();
})();true;`
}

/** 화면 안 단추 찾기 공통 (보이는 것만) */
const BATCH_CORE = `
function q(sel){var out=[];docs().forEach(function(d){try{out=out.concat(Array.prototype.slice.call(d.querySelectorAll(sel)));}catch(e){}});return out;}
function shown(el){return !!(el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length));}
`

function batchData(view: EpostFillView): string {
  return JSON.stringify({ batch: view.form.batch ?? null, hosts: view.hosts }).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/**
 * [다음]으로 지금 받는 분을 우체국 받는 분 목록에 더한다 (EP1 D-EP1-19). 판매자의 [필수동의]가 없으면 누르지 않는다.
 * 그 사이 신청서가 띄우는 알림·확인 창은 막아 문장만 돌려준다(확인 창은 '아니요'). [접수신청]·결제는 누르지 않는다.
 */
export function commitScript(view: EpostFillView): string {
  return `(function(){${AGENT_CORE}${BATCH_CORE}
var DATA=${batchData(view)};
if(!hostOk(DATA.hosts))return;
var B=DATA.batch;
if(!B){post({type:'commit',ok:false,reason:'notfound',count:0,messages:[]});return;}
var agree=q(B.agree)[0];
var before=q(B.list).length;
if(agree&&!agree.checked){post({type:'commit',ok:false,reason:'agree',count:before,messages:[]});return;}
var next=q(B.next).filter(shown)[0];
if(!next){post({type:'commit',ok:false,reason:'notfound',count:before,messages:[]});return;}
var msgs=[],oa=window.alert,oc=window.confirm;
window.alert=function(m){msgs.push(String(m));};window.confirm=function(m){msgs.push(String(m));return false;};
try{next.click();}catch(e){}
var t=0;
(function wait(){
  var n=q(B.list).length;
  if(n>before||t>=25){window.alert=oa;window.confirm=oc;post({type:'commit',ok:n>before,reason:n>before?null:'refused',count:n,messages:msgs.slice(0,5)});return;}
  t++;setTimeout(wait,200);
})();
})();true;`
}

/** [받는 분 추가 +]로 받는 분 칸을 비운다 (목록에 한 명 이상 있을 때만 — 비어 있으면 신청서가 쪽을 다시 읽는다) */
export function addScript(view: EpostFillView): string {
  return `(function(){${AGENT_CORE}${BATCH_CORE}
var DATA=${batchData(view)};
if(!hostOk(DATA.hosts))return;
var B=DATA.batch;
if(!B||q(B.list).length===0){post({type:'added',ok:false});return;}
var btn=q('a,button').filter(function(x){return shown(x)&&squash(x.textContent).indexOf(squash(B.add))>=0;})[0];
if(!btn){post({type:'added',ok:false});return;}
var oa=window.alert,oc=window.confirm;window.alert=function(){};window.confirm=function(){return false;};
try{btn.click();}catch(e){}
setTimeout(function(){window.alert=oa;window.confirm=oc;post({type:'added',ok:true});},800);
})();true;`
}

/**
 * 새 창 대신 같은 쪽 위 판 (D-EP1-11): 우체국 주소 찾기는 window.open("", 이름)으로 빈 창을 열고 양식을 그 창 이름으로 보낸 뒤,
 * 그 창이 opener의 칸에 주소를 적는다. 앱 안 화면은 새 창을 따로 열면 양식이 그 창에 닿지 않고 opener도 없다 —
 * 그래서 window.open을 같은 이름의 iframe을 담은 전체 화면 판으로 바꾸고, iframe 창의 opener를 이 쪽으로, close를 판 닫기로 잇는다.
 * 실제 인터넷우체국 화면(2026-11-08)에서 주소 찾기 → 고르기 → 완료로 우편번호·주소·상세 주소가 채워지고 판이 닫히는 것을 확인했다.
 */
export function popupShimScript(hosts: readonly string[]): string {
  return `(function(){${AGENT_CORE}
if(!hostOk(${JSON.stringify(hosts)})||window.__ljPopup)return;window.__ljPopup=true;
window.open=function(url,name){
  name=name||'ljpop';
  var old=document.getElementById('__ljpop');if(old)old.remove();
  var wrap=document.createElement('div');wrap.id='__ljpop';
  wrap.setAttribute('style','position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#fff;display:flex;flex-direction:column');
  var bar=document.createElement('div');bar.setAttribute('style','display:flex;justify-content:flex-end;padding:8px;border-bottom:1px solid #ddd');
  var btn=document.createElement('button');btn.type='button';btn.textContent='창 닫기';btn.setAttribute('style','font-size:16px;padding:8px 14px');
  btn.onclick=function(){wrap.remove();};bar.appendChild(btn);
  var frame=document.createElement('iframe');frame.setAttribute('name',name);frame.setAttribute('style','flex:1;border:0;width:100%');
  wrap.appendChild(bar);wrap.appendChild(frame);(document.body||document.documentElement).appendChild(wrap);
  function patch(){try{var w=frame.contentWindow;w.opener=window;w.close=function(){wrap.remove();};}catch(e){}}
  frame.addEventListener('load',patch);patch();
  if(url)frame.src=url;
  return frame.contentWindow;
};
})();true;`
}

/**
 * 비회원 신청 비밀번호 칸 채우기 (EP1 D-EP1-14): 판매자가 설정에 적은 숫자 4자리를 우체국 비회원 약관 쪽의 "신청 비밀번호"·"비밀번호 확인" 칸에만 넣는다.
 * - 칸: 서버 힌트의 정확한 선택자 → 없으면 type=password 칸 중 설명에 신청 비밀번호·guest·orderpw가 든 것. 결제 카드 칸(credit·card·카드…)은 보지 않는다.
 * - 빈 칸에만 넣고, 약관 체크·[다음]은 누르지 않는다(약관 동의는 판매자가 한다).
 */
export function passwordScript(password: string, selectors: string | undefined, hosts: readonly string[]): string {
  const data = JSON.stringify({ password, selectors: selectors ?? '', hosts }).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `(function(){${AGENT_CORE}
var DATA=${data};
if(!hostOk(DATA.hosts)||!/^[0-9]{4}$/.test(DATA.password))return;
var PAY=/credit|card|cvc|cvv|birth|카드|생년월일|유효기간/i;
var WANT=/신청비밀번호|비밀번호확인|guest|orderpw|reqpassword/i;
var tries=0;
function attempt(){
  var els=[];
  if(DATA.selectors){docs().forEach(function(doc){try{Array.prototype.forEach.call(doc.querySelectorAll(DATA.selectors),function(el){els.push(el);});}catch(e){}});}
  if(els.length===0){docs().forEach(function(doc){Array.prototype.forEach.call(doc.querySelectorAll('input[type=password]'),function(el){
    var id=(el.getAttribute('name')||'')+' '+(el.id||'')+' '+(el.getAttribute('title')||'')+' '+(el.getAttribute('placeholder')||'');
    if(PAY.test(id))return;
    if(WANT.test(id)||WANT.test(describe(el)))els.push(el);
  });});}
  var n=0;
  els.forEach(function(el){if(el.tagName==='INPUT'&&!el.disabled&&String(el.value||'')===''&&!PAY.test((el.getAttribute('name')||'')+' '+(el.id||''))){if(setValue(el,DATA.password))n++;}});
  if(n===0&&els.length===0&&tries<10){tries++;setTimeout(attempt,700);return;}
  if(n>0)post({type:'password',filled:n});
}
attempt();
})();true;`
}

/** 접수번호 찾기 스크립트 (배송지를 담지 않는다 — 접수번호 낱말이 든 줄과 그 다음 줄만 돌려준다) */
export function receiptScript(words: readonly string[], hosts: readonly string[]): string {
  const data = JSON.stringify({ words, hosts }).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `(function(){${AGENT_CORE}
var DATA=${data};
if(!hostOk(DATA.hosts))return;
var lines=[];
docs().forEach(function(doc){
  var text=(doc.body&&(doc.body.innerText||doc.body.textContent))||'';
  var all=text.split(/\\n+/).map(function(line){return line.replace(/\\s+/g,' ').trim();}).filter(Boolean);
  for(var i=0;i<all.length;i++){
    if(DATA.words.some(function(w){return all[i].indexOf(w)>=0;})){lines.push(all[i]);if(all[i+1])lines.push(all[i+1]);}
  }
});
if(lines.length>0)post({type:'receipt',lines:lines.slice(0,20)});
})();true;`
}

/**
 * 화면 안 공통 함수 (ES2017). 칸을 찾고 채우는 일만 한다 — click·submit·약관 체크는 하지 않는다.
 * - 칸 설명 = label[for]·감싼 label·aria-label·title·placeholder·name·id·같은 줄의 th/앞 칸 글 (공백을 빼고 소문자로)
 * - 구역 = name/id의 recv·snd 표지 → 칸 앞에 나온 가장 가까운 구역 제목(받는분/보내는분 낱말이 든 짧은 글)
 * - 칸 종류 = 상세주소 → 우편번호 → 휴대전화 → 일반전화 → 주소 → 내용품 → 메모 → 이름 순서로 처음 맞는 것
 */
const AGENT_CORE = `
function post(msg){msg.source='livejjim-epost';try{window.ReactNativeWebView.postMessage(JSON.stringify(msg));}catch(e){}}
function hostOk(hosts){var h=String(location.hostname||'').toLowerCase();return location.protocol==='https:'&&hosts.some(function(x){return h===x||h.slice(-x.length-1)==='.'+x;});}
function docs(){var out=[document];try{Array.prototype.forEach.call(document.querySelectorAll('iframe'),function(f){try{if(f.contentDocument&&f.contentDocument.body)out.push(f.contentDocument);}catch(e){}});}catch(e){}return out;}
function squash(s){return String(s||'').replace(/\\s+/g,'').toLowerCase();}
function ownText(el){if(!el)return '';var t=el.textContent||'';return t.length>40?'':t;}
function describe(el){
  var doc=el.ownerDocument,parts=[];
  if(el.id){try{var l=doc.querySelector('label[for="'+el.id.replace(/"/g,'')+'"]');if(l)parts.push(l.textContent);}catch(e){}}
  var wrap=el.closest('label');if(wrap)parts.push(wrap.textContent);
  ['aria-label','title','placeholder','name','id'].forEach(function(a){var v=el.getAttribute(a);if(v)parts.push(v);});
  var cell=el.closest('td,dd');
  if(cell){var row=cell.closest('tr');var th=row?row.querySelector('th'):null;if(th)parts.push(ownText(th));var prev=cell.previousElementSibling;if(prev&&(prev.tagName==='TH'||prev.tagName==='DT'))parts.push(ownText(prev));}
  var before=el.previousElementSibling;if(before&&/^(LABEL|SPAN|STRONG|EM|B)$/.test(before.tagName))parts.push(ownText(before));
  return squash(parts.join(' '));
}
function controls(){
  var out=[];
  docs().forEach(function(doc){Array.prototype.forEach.call(doc.querySelectorAll('input,textarea,select'),function(el){
    var type=String(el.getAttribute('type')||'text').toLowerCase();
    if(el.tagName==='INPUT'&&['text','tel','number','search','email',''].indexOf(type)<0)return;
    if(el.disabled)return;
    if(GUARD.test((el.getAttribute('name')||'')+' '+(el.id||'')+' '+(el.getAttribute('title')||'')+' '+(el.getAttribute('placeholder')||'')))return;
    out.push(el);
  });});
  return out;
}
function headings(words){
  var out=[];
  docs().forEach(function(doc){Array.prototype.forEach.call(doc.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,caption,th,dt,strong,p,span,div,li,label'),function(el){
    var t=squash(el.textContent);
    if(t.length===0||t.length>14)return;
    if(words.receiver.some(function(w){return t.indexOf(squash(w))>=0;}))out.push({el:el,side:'receiver'});
    else if(words.sender.some(function(w){return t.indexOf(squash(w))>=0;}))out.push({el:el,side:'sender'});
  });});
  return out;
}
function sideOf(el,marks,words){
  var id=squash((el.getAttribute('name')||'')+' '+(el.id||''));
  var r=words.receiver.some(function(w){return /^[a-z]+$/.test(w)&&id.indexOf(w)>=0;});
  var s=words.sender.some(function(w){return /^[a-z]+$/.test(w)&&id.indexOf(w)>=0;});
  if(r&&!s)return 'receiver';if(s&&!r)return 'sender';
  var side=null;
  for(var i=0;i<marks.length;i++){
    var m=marks[i];if(m.el.ownerDocument!==el.ownerDocument)continue;
    if(m.el.contains(el))continue;
    if(m.el.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)side=m.side;
  }
  return side;
}
var GUARD=/credit|card|pwd|passw|cvc|cvv|birth|카드|비밀번호|생년월일|유효기간|사업자번호/i;
var KEY_ORDER=['detail','zip','mobile','phone','address','item','memo','name'];
function keyOf(desc,fields){
  for(var i=0;i<KEY_ORDER.length;i++){var k=KEY_ORDER[i];if((fields[k]||[]).some(function(w){return desc.indexOf(squash(w))>=0;}))return k;}
  return null;
}
function pick(el,value){
  var v=squash(value);if(v==='')return -1;
  for(var i=0;i<el.options.length;i++){var o=el.options[i];if(o.value!==''&&(o.value===value||squash(o.text)===v))return i;}
  for(var j=0;j<el.options.length;j++){if(el.options[j].value!==''&&squash(el.options[j].text).indexOf(v)>=0)return j;}
  return -1;
}
function fire(el){['input','change','blur'].forEach(function(t){try{el.dispatchEvent(new Event(t,{bubbles:true}));}catch(e){}});}
function setValue(el,value){
  if(el.tagName==='SELECT'){
    var hit=pick(el,value);
    if(hit<0)return false;el.selectedIndex=hit;
  }else{
    var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    var desc=Object.getOwnPropertyDescriptor(proto,'value');
    var max=el.maxLength>0?el.maxLength:0;
    var v=max>0&&value.length>max?value.slice(0,max):value;
    if(desc&&desc.set)desc.set.call(el,v);else el.value=v;
  }
  fire(el);
  return true;
}
/** 고르기 + 글 칸 한 쌍 (내용품·배송 요청): 맞는 항목이 있으면 그것만, 없으면 '직접' 항목을 고른 뒤 글 칸에 */
function setChoice(els,value){
  var sels=els.filter(function(e){return e.tagName==='SELECT';}),txts=els.filter(function(e){return e.tagName!=='SELECT';});
  if(sels.length===0)return txts.length>0&&setValue(txts[0],value);
  var s=sels[0],hit=pick(s,value);
  if(hit>=0){s.selectedIndex=hit;fire(s);return true;}
  if(txts.length===0)return false;
  var direct=-1;for(var i=0;i<s.options.length;i++){if(squash(s.options[i].text).indexOf('직접')>=0){direct=i;break;}}
  if(direct>=0){s.selectedIndex=direct;fire(s);txts[0].readOnly=false;}
  return setValue(txts[0],value);
}
function phoneValues(parts,els){
  if(els.length>=3)return [parts[0],parts[1],parts[2]];
  if(els.length===2)return [parts[0],parts[1]+parts[2]];
  var el=els[0];var joined=parts.join('-');
  return [el&&el.maxLength>0&&el.maxLength<joined.length?parts.join(''):joined];
}
function fillAll(data,only){
  var form=data.form,fill=data.fill;
  var marks=headings(form.sections);
  var groups={};var used=[];var bySelector={};
  Object.keys(form.selectors||{}).forEach(function(slot){
    var sel=form.selectors[slot];if(!sel)return;
    docs().some(function(doc){var els=[];try{els=Array.prototype.slice.call(doc.querySelectorAll(sel));}catch(e){}if(els.length>0){groups[slot]=els;bySelector[slot]=true;used=used.concat(els);return true;}return false;});
  });
  var unknown={};
  controls().forEach(function(el){
    if(used.indexOf(el)>=0)return;
    var key=keyOf(describe(el),form.fields);if(!key)return;
    // 고르기는 전화 앞자리·내용품·배송 요청에만 (실제 화면의 숨은 준등기 semiDetailCode가 detail 낱말로 상세 주소에 끼던 일 — D-EP1-12)
    if(el.tagName==='SELECT'&&['mobile','phone','item','memo'].indexOf(key)<0)return;
    var slot;
    if(key==='item'||key==='memo')slot=key;
    else{var side=sideOf(el,marks,form.sections);if(side===null){(unknown[key]=unknown[key]||[]).push(el);return;}slot=side+'.'+key;}
    // 선택자 힌트가 이 화면에서 칸을 찾았을 때만 그것이 이긴다 (PC 신청서용 힌트가 모바일에서 아무것도 못 찾으면 글로 찾은 칸을 모두 쓴다 — D-EP1-19)
    if(bySelector[slot])return;
    (groups[slot]=groups[slot]||[]).push(el);
  });
  var report={type:'fill',filled:[],readonly:[],missing:[],ambiguous:[]};
  Object.keys(unknown).forEach(function(key){
    var els=unknown[key];
    var multi=key==='mobile'||key==='phone'?els.length>3:els.length>1;
    var hasRecv=!!groups['receiver.'+key],hasSend=!!groups['sender.'+key];
    if(multi||hasRecv||hasSend){report.ambiguous.push('receiver.'+key);return;}
    groups['receiver.'+key]=els;
  });
  function put(slot,value,onlyEmpty){
    if(only&&only.indexOf(slot)<0)return;
    var els=groups[slot];
    if(!els||els.length===0){if(value&&report.ambiguous.indexOf(slot)<0)report.missing.push(slot);return;}
    if(value===null||value===undefined||value==='')return;
    // 이미 적힌 칸(주소 찾기·회원 정보)은 그대로 둔다 — 글 칸 중 하나라도 차 있으면 그 칸 무리를 건드리지 않는다
    if(onlyEmpty&&els.some(function(el){return el.tagName!=='SELECT'&&String(el.value||'').trim()!=='';}))return;
    var ok=false;
    if(Array.isArray(value)){var values=phoneValues(value,els);for(var i=0;i<els.length&&i<values.length;i++){if(setValue(els[i],values[i]))ok=true;}}
    else ok=setChoice(els,value);
    if(ok){report.filled.push(slot);if(els.some(function(el){return el.readOnly;}))report.readonly.push(slot);}
    else report.missing.push(slot);
  }
  ['receiver','sender'].forEach(function(side){
    var p=fill[side];var onlyEmpty=side==='sender';
    put(side+'.name',p.name,onlyEmpty);put(side+'.zip',p.zip,onlyEmpty);put(side+'.address',p.address,onlyEmpty);put(side+'.detail',p.detail,onlyEmpty);
    if(p.mobile)put(side+'.mobile',p.mobile,onlyEmpty);
    if(p.phone){if(groups[side+'.phone'])put(side+'.phone',p.phone,onlyEmpty);else put(side+'.mobile',p.phone,onlyEmpty);}
  });
  put('item',fill.item,false);
  if(fill.memo)put('memo',fill.memo,false);
  return report;
}
`
