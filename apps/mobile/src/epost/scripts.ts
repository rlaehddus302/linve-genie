// 앱 안 우체국 화면에 넣는 스크립트 (D-UX3-37). 판매자 휴대폰의 웹뷰 안, 우체국 화면 위에서만 돈다.
// - 하는 일: 판매자가 손으로 하던 입력(보내는 분 칸, [파일(주소) 등록]에 파일 올리기)을 대신한다. 우체국 화면 자체의 확인(보내는 분·방문 정보·목록 검사)을 그대로 거친다.
// - 하지 않는 일: [신청]·결제·비밀번호·동의 체크는 누르거나 넣지 않는다 — 판매자가 화면을 보고 직접 한다.
// - 결과는 window.ReactNativeWebView.postMessage(JSON)로 앱에 알린다 (글 칸 값은 보내지 않는다 — 종류·단계·건수만).
import { splitPhone, type EpostKit } from './kit.ts'

/** 앱 → 화면: 스크립트에 넣는 값 (JSON — 그대로 JS 식이 된다) */
function payload(kit: EpostKit): string {
  const sender = kit.sender
  return JSON.stringify({
    sender: sender === null ? null : { name: sender.name, zip: sender.zip, address: sender.address, detail: sender.detail, phone: splitPhone(sender.phone) },
    count: kit.receivers.length,
    file: kit.file.base64,
  }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * 방문접수소포 예약 화면(general.RetrieveGeneralNewGubun) 채우기:
 * ① 보내는 분 이름·전화(세 칸)·주소(우체국 화면의 회원 주소 넣기 함수 setCommOpenerMemAddress — 방문 우체국·날짜를 화면이 다시 고른다)·접수결과 메일 미수신(메일 주소가 없으면)
 * ② 화면의 [파일(주소) 등록] 창을 여는 대신 같은 두 요청(파일 올리기 → 파일 읽기)을 이 화면에서 보내고, 창이 하던 대로 setGridRowsToAddressFile로 목록에 넣는다
 * ③ 방문 날짜·시간이 정해지고 목록이 비어 있으면 화면의 [파일(주소) 등록]을 눌러(화면의 확인을 거친 뒤 ②) 받는 분을 넣는다. 한 화면에서 파일은 한 번만 올린다
 */
export function visitFillScript(kit: EpostKit): string {
  return `(function (kit) {
  var post = function (message) { try { window.ReactNativeWebView.postMessage(JSON.stringify(message)) } catch (e) {} };
  if (window.__ljEpost) { window.__ljEpost.run(); return true }
  var form = document.getElementById('genAmtForm');
  if (!form || typeof setGridRowsToAddressFile !== 'function') { post({ type: 'fill', ok: false, reason: 'PAGE' }); return true }
  var byId = function (id) { return document.getElementById(id) };
  var set = function (el, value) { if (!el || value === undefined || value === null) return; el.value = value; try { el.dispatchEvent(new Event('change', { bubbles: true })) } catch (e) {} };
  var uploaded = false;
  var uploading = false;
  function rows() { try { return typeof dataProvider !== 'undefined' ? dataProvider.getRowCount() : 0 } catch (e) { return 0 } }
  function fillSender() {
    var s = kit.sender;
    if (!s) return false;
    set(byId('labname'), s.name);
    if (s.phone) {
      var ids = s.phone.mobile ? ['cell1', 'labmobile_num', 'cell3'] : ['labphone1', 'phone2', 'phone3'];
      for (var i = 0; i < 3; i++) set(byId(ids[i]), s.phone.parts[i]);
    }
    var email = byId('labemail');
    if (email && !email.value) { var none = byId('method1'); if (none) none.checked = true }
    if (/^[0-9]{5}$/.test(s.zip) && typeof setCommOpenerMemAddress === 'function') setCommOpenerMemAddress(s.zip, s.address, s.detail);
    return true;
  }
  function fileBytes() {
    var bin = atob(kit.file);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function formOf(tempCode) {
    var data = new FormData();
    data.append('okChk', 'n');
    data.append('ext', '1');
    data.append('filetype', 't3');
    data.append('isHeader', '');
    data.append('tempCode', tempCode);
    data.append('fkind', 'xlsx');
    data.append('fileName', new File([fileBytes()], 'epost-visit.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    return data;
  }
  function loading(open) { try { $('#divLoading').dialog(open ? 'open' : 'close') } catch (e) {} }
  function upload() {
    if (uploading || uploaded) return;
    uploading = true;
    loading(true);
    post({ type: 'upload', step: 'start' });
    var query = '';
    fetch('/general.UseGridAddressFile.parcel?', { credentials: 'include' })
      .then(function (response) { return response.text() })
      .then(function (html) {
        var found = /name="tempCode"\\s+value="([0-9]+)"/.exec(html);
        if (!found) throw new Error('tempCode');
        query = '?tempCode=' + found[1] + '&isHeader=1&filetype=t3&fkind=xlsx';
        return fetch('/general.NewUpLoadFileCmdNew.parcel' + query, { method: 'POST', body: formOf(found[1]), credentials: 'include' })
          .then(function (response) {
            if (!response.ok) throw new Error('upload');
            return fetch('/general.NewCreateFileImportNew.parcel' + query, { method: 'POST', body: formOf(found[1]), credentials: 'include' });
          });
      })
      .then(function (response) { return response.text() })
      .then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, 'text/xml');
        var state = doc.querySelector('state');
        var list = doc.querySelector('list');
        state = state ? state.textContent : '';
        list = list ? list.textContent : '';
        if (state !== 'S') { post({ type: 'upload', ok: false, state: state || 'X' }); return }
        var json = list.replace(/\\[\\[/g, '[{').replace(/\\]\\]/g, '}]').replace(/\\], \\[/g, '},{').replace(/'/g, '"').replace(/", "/g, '","');
        if (json === '[]') { post({ type: 'upload', ok: false, state: 'EMPTY' }); return }
        uploaded = true;
        var messages = setGridRowsToAddressFile(json) || [];
        loading(false);
        for (var i = 0; i < messages.length; i++) alert(messages[i]);
        post({ type: 'upload', ok: true, count: kit.count, rows: rows() });
      })
      .catch(function () { post({ type: 'upload', ok: false, state: 'NETWORK' }) })
      .then(function () { uploading = false; loading(false) });
  }
  var realOpen = window.open;
  window.open = function (url) {
    if (String(url).indexOf('UseGridAddressFile') >= 0) { upload(); return null }
    return realOpen.apply(window, arguments);
  };
  function run() {
    var filled = fillSender();
    post({ type: 'fill', ok: true, sender: filled });
    if (uploaded || rows() > 0) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var day = typeof getWishDay === 'function' ? getWishDay() : '';
      var time = typeof getWishTime === 'function' ? getWishTime() : '';
      if (day && time) {
        clearInterval(timer);
        var button = byId('fncRegFile');
        if (button && rows() === 0 && !uploaded) button.click();
      } else if (tries >= 40) {
        clearInterval(timer);
        post({ type: 'fill', step: 'need-date' });
      }
    }, 500);
  }
  window.__ljEpost = { run: run };
  run();
  return true;
})(${payload(kit)});
true;`
}

/** 들고 가기 스크립트 값: 보내는 분 + 받는 분 칸 (이름·우편번호·주소·상세 주소·전화 세 칸) */
function counterPayload(kit: EpostKit): string {
  const sender = kit.sender
  return JSON.stringify({
    sender: sender === null ? null : { name: sender.name, zip: sender.zip, address: sender.address, detail: sender.detail, phone: splitPhone(sender.phone) },
    receivers: kit.receivers.map((receiver) => ({ name: receiver.name, zip: receiver.zip, address: receiver.address, detail: receiver.detail, phone: splitPhone(receiver.phone) })),
  }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * 창구소포 간편사전접수 입력 화면(commonpostplus.ParcelRetrieveAcceptPlus — 판매자가 동의·비밀번호를 넣은 뒤) 채우기:
 * ① 보내는 분 칸(tSndNm·tSndZipcd·tSndAddr1·tSndAddr2·휴대전화 tSndHTel 또는 일반전화 tSndTel 세 칸)
 * ② 받는 분마다 칸(tReceiverName·tReceiverZipcode1·tReceiverAddr1·tReceiverAddr2·tReceiverHTel/tReceiverTel)을 채우고 화면의 [목록 추가](inputReceiver — 화면의 확인을 그대로 거친다)를 부른다.
 *    목록이 늘지 않은 사람(우편번호·전화가 맞지 않음)은 건너뛰고 수만 알린다 — 그동안 화면 알림창은 모아서 띄우지 않는다. 목록에 이미 줄이 있으면 받는 분은 다시 넣지 않는다
 */
export function counterFillScript(kit: EpostKit): string {
  return `(function (kit) {
  var post = function (message) { try { window.ReactNativeWebView.postMessage(JSON.stringify(message)) } catch (e) {} };
  var byId = function (id) { return document.getElementById(id) };
  if (!byId('tSndNm') || !byId('tReceiverName') || typeof inputReceiver !== 'function') { post({ type: 'fill', ok: false, reason: 'PAGE' }); return true }
  var set = function (id, value) { var el = byId(id); if (!el || value === undefined || value === null) return; el.value = value; try { el.dispatchEvent(new Event('change', { bubbles: true })) } catch (e) {} };
  var phone = function (prefix, parts) {
    var mobile = parts && parts.mobile;
    for (var i = 0; i < 3; i++) {
      set(prefix + 'HTel' + (i + 1), mobile ? parts.parts[i] : '');
      set(prefix + 'Tel' + (i + 1), !mobile && parts ? parts.parts[i] : '');
    }
  };
  var s = kit.sender;
  if (s) {
    set('tSndNm', s.name);
    set('tSndZipcd', s.zip);
    set('tSndAddr1', s.address);
    set('tSndAddr2', s.detail);
    phone('tSnd', s.phone);
  }
  var table = byId('mainTable');
  var rows = function () { return table ? table.rows.length : 0 };
  if (!s) { post({ type: 'fill', ok: true, sender: false }); return true }
  if (rows() > 1) { post({ type: 'fill', ok: true, sender: true, added: 0, skipped: 0, existing: rows() - 1 }); return true }
  var realAlert = window.alert;
  var added = 0;
  var skipped = 0;
  window.alert = function () {};
  try {
    for (var i = 0; i < kit.receivers.length; i++) {
      var r = kit.receivers[i];
      set('tReceiverName', r.name);
      set('tReceiverZipcode1', r.zip);
      set('tReceiverAddr1', r.address);
      set('tReceiverAddr2', r.detail);
      phone('tReceiver', r.phone);
      var before = rows();
      try { inputReceiver() } catch (e) {}
      if (rows() > before) added++; else skipped++;
    }
  } finally {
    window.alert = realAlert;
    ['tReceiverName', 'tReceiverZipcode1', 'tReceiverAddr1', 'tReceiverAddr2'].forEach(function (id) { set(id, '') });
    phone('tReceiver', null);
  }
  post({ type: 'fill', ok: true, sender: true, added: added, skipped: skipped });
  return true;
})(${counterPayload(kit)});
true;`
}

/**
 * 화면 글 줄 모으기 (송장번호 찾기): 표 줄·목록 줄 글(공백 하나로, 600자까지)을 앱에 보낸다 — 숫자 4자리 이상이 든 줄만, 1500줄까지.
 * 같은 주소 안의 틀(iframe) 글도 본다. 짝짓기는 앱(match.ts)이 판매자 기기 안에서 한다
 */
export const ROWS_SCRIPT = `(function () {
  var out = [];
  function scan(doc) {
    var els = doc.querySelectorAll('tr, li, dl, p');
    for (var i = 0; i < els.length && out.length < 1500; i++) {
      var text = (els[i].innerText || els[i].textContent || '').replace(/\\s+/g, ' ').trim();
      if (text.length > 0 && text.length <= 600 && /[0-9]{4}/.test(text)) out.push(text);
    }
    var frames = doc.querySelectorAll('iframe, frame');
    for (var j = 0; j < frames.length; j++) { try { if (frames[j].contentDocument) scan(frames[j].contentDocument) } catch (e) {} }
  }
  scan(document);
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'rows', rows: out })) } catch (e) {}
  return true;
})();
true;`
