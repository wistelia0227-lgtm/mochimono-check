// 共通の小道具。window.U で公開。
(function () {
  'use strict';
  const U = {};

  // エラーは握りつぶさず画面上部に出す
  function showError(msg) {
    const bar = document.getElementById('errbar');
    if (!bar) return;
    bar.hidden = false;
    bar.textContent = 'エラー: ' + msg;
  }
  window.addEventListener('error', (e) => showError(e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')'));
  window.addEventListener('unhandledrejection', (e) => showError(String(e.reason && e.reason.message || e.reason)));
  U.showError = showError;

  // DOM生成: h('div', {class:'x', onclick:fn}, 子...)
  const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1 };
  function append(el, kid) {
    if (kid == null || kid === false || kid === true) return;
    if (Array.isArray(kid)) { kid.forEach((k) => append(el, k)); return; }
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  U.h = function (tag, attrs) {
    const el = document.createElement(tag);
    const later = [];
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (PROPS[k]) later.push(k);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    later.forEach((k) => { el[k] = attrs[k]; }); // selectのvalueは子の後でないと効かない
    return el;
  };
  const h = U.h;

  U.uid = function (prefix) {
    return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  // 日付
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  U.today = function () {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  U.fmtDate = function (s) {
    if (!s) return '';
    const p = s.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return p[1] + '/' + p[2] + '(' + WD[d.getDay()] + ')';
  };
  U.fmtDateTime = function (ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ') ' +
      d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  U.fmtRange = function (a, b) {
    return U.fmtDate(a) + ' 〜 ' + (b ? U.fmtDate(b) : '未定');
  };

  // トースト
  let toastTimer = null;
  U.toast = function (msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = isError ? 'err' : '';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2200);
  };

  // モーダル。close() を返す。背景タップでは閉じない（入力の消失防止）
  U.modal = function (content, opts) {
    const bg = h('div', { class: 'modal-bg' + (opts && opts.wide ? ' wide' : '') }, h('div', { class: 'modal' }, content));
    document.body.appendChild(bg);
    return function close() { bg.remove(); };
  };

  // 確認ダイアログ → Promise<boolean>
  U.confirm = function (message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let close;
      const done = (v) => { close(); resolve(v); };
      const body = h('div', null,
        h('div', { class: 'modal-msg' }, message),
        h('div', { class: 'modal-btns' },
          h('button', { class: 'btn', onclick: () => done(false) }, opts.cancelLabel || 'やめる'),
          h('button', { class: 'btn ' + (opts.danger ? 'danger' : 'primary'), onclick: () => done(true) }, opts.okLabel || 'OK')
        )
      );
      close = U.modal(body);
    });
  };

  // 画像 → 縮小した dataURL
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像として開けません')); };
      img.src = url;
    });
  }
  function scale(img, max, quality) {
    const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * r));
    c.height = Math.max(1, Math.round(img.naturalHeight * r));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  // 写真を1枚撮る/選ぶ → {id, thumb} か null。本体は photos ストアへ
  // opts.gallery = true なら、カメラを直接開かず端末の画像から選ぶ
  U.pickPhoto = function (opts) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: 'image/*', capture: (opts && opts.gallery) ? null : 'environment', style: 'display:none' });
      document.body.appendChild(input);
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) return resolve(null);
        try {
          const img = await loadImage(f);
          const ref = await U.storePhoto(scale(img, 1280, 0.8), scale(img, 160, 0.7));
          resolve(ref);
        } catch (e) {
          U.toast('写真を読み込めませんでした: ' + e.message, true);
          resolve(null);
        }
      });
      input.click();
    });
  };
  U.storePhoto = async function (data, thumb) {
    const id = U.uid('p');
    await window.DB.put('photos', { id: id, data: data, createdAt: Date.now() });
    return { id: id, thumb: thumb };
  };

  // 写真を大きく見る
  U.viewPhoto = async function (ref) {
    const rec = await window.DB.get('photos', ref.id);
    let close;
    const body = h('div', null,
      h('img', { class: 'photo-full', src: rec ? rec.data : ref.thumb }),
      h('div', { class: 'modal-btns' }, h('button', { class: 'btn primary', onclick: () => close() }, '閉じる'))
    );
    close = U.modal(body, { wide: true });
  };

  // ファイルとして保存
  U.download = function (filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  window.U = U;
})();
