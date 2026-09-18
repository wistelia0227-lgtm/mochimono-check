// ===== 実験室（削除可能モジュール） =====
// 目的: 「この端末の中だけで、写真から持ち物を認識できるか」を、機種の情報から推測せず実機で試して確かめる。
// 写真は端末の外へ出ない。外から取ってくるのはAIモデルのファイル(約2.9GB)とその実行部品だけ。
// 外し方: このファイルと index.html の <script src="modules/lab.js"> の行を消す。
(function () {
  'use strict';
  const U = window.U, h = U.h, App = window.App;
  const MP_VER = '0.10.29';
  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@' + MP_VER;
  const DEFAULT_MODEL_URL = 'https://huggingface.co/xnohat/gemma-3n-it-int4-Web-litertlm/resolve/main/gemma-3n-E2B-it-int4-Web.litertlm';
  const CACHE = 'mochimono-lab-model';
  // 小さいモデルは JSON を崩しやすい(2026-09-18 実測: 途中で切れる／同じキーを繰り返す)ので、1行1品の単純な書式にする
  const PROMPT = 'これは介護施設のショートステイに利用者が持参した荷物の写真です。写っている持ち物を、左上から右下へ順に全て挙げてください。\n' +
    '1行に1種類、次の書式だけで答える（前置きや説明は書かない）:\n品名|個数|色や特徴\n' +
    '例:\n靴下|2|黒\nタオル|3|白・青のしま\n' +
    '同じ種類で色が違う物は別の行にする。靴下は1足を1と数える。写っていない物は書かない。';

  // 「品名|個数|特徴」の行を読む。崩れた行は捨てる
  // 小さいモデルは同じ行を延々と繰り返す暴走を起こす(2026-09-18 実測)。同じ「品名|特徴」が再び出た所で打ち切る
  function parseLines(text) {
    const items = [], seen = {};
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i].replace(/^[\s・\-*\d.]+/, '').split(/[|｜]/).map((s) => s.trim());
      if (p.length < 2 || !p[0] || /^品名$/.test(p[0])) continue;
      const qty = parseInt(String(p[1]).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)), 10);
      if (!(qty > 0)) continue;
      const key = p[0] + '|' + (p[2] || '');
      if (seen[key]) { items.looped = true; break; }
      seen[key] = true;
      items.push({ name: p[0], qty: qty, note: p[2] || '' });
    }
    return items;
  }
  // 生成の途中で暴走に気づいたら止める（同じ行が3回出たら）
  function isLooping(text) {
    const count = {};
    return String(text).split(/\r?\n/).some((l) => { l = l.trim(); if (l.length < 3) return false; count[l] = (count[l] || 0) + 1; return count[l] >= 3; });
  }

  const Lab = { llm: null, report: [], parse: parseLines };
  let modelUrl = new URLSearchParams(location.search).get('labmodel') || DEFAULT_MODEL_URL;
  let logEl = null;
  const sec = (t0) => Math.round((performance.now() - t0) / 100) / 10;
  function log(line) {
    Lab.report.push(line);
    if (logEl) { logEl.textContent = Lab.report.join('\n'); logEl.scrollTop = logEl.scrollHeight; }
  }

  // ---- 1. 端末の事実を集める（判断はしない。書き出すだけ） ----
  Lab.inspect = async function () {
    log('■ 端末の状態  ' + new Date().toLocaleString());
    log('ブラウザ: ' + navigator.userAgent);
    log('アドレス: ' + location.protocol + '//' + location.host + '  安全な接続(secure context): ' + window.isSecureContext);
    log('メモリ(ブラウザ申告・上限8): ' + (navigator.deviceMemory || '不明') + ' GB　CPUコア: ' + (navigator.hardwareConcurrency || '不明'));
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      log('保存領域: 使用 ' + Math.round((e.usage || 0) / 1e6) + ' MB / 上限 ' + Math.round((e.quota || 0) / 1e6) + ' MB');
    }
    if (!navigator.gpu) {
      log('WebGPU: 使えない' + (window.isSecureContext ? '（このブラウザが未対応か無効）' : '（http のアドレスでは使えない。https で開く必要がある）'));
    } else {
      try {
        const a = await navigator.gpu.requestAdapter();
        if (!a) log('WebGPU: あるがGPUを取得できない');
        else {
          const i = a.info || {};
          log('WebGPU: 使える  GPU=' + [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' '));
          log('  maxBufferSize=' + Math.round(a.limits.maxBufferSize / 1e6) + ' MB  maxStorageBufferBindingSize=' + Math.round(a.limits.maxStorageBufferBindingSize / 1e6) + ' MB');
        }
      } catch (e) { log('WebGPU: 取得時にエラー ' + e.message); }
    }
    log('モデルの保存: ' + ((await Lab.cached()) ? '済み' : 'まだ'));
  };

  Lab.cached = async function () {
    if (!window.caches) return false;
    return !!(await (await caches.open(CACHE)).match(modelUrl));
  };

  // ---- 2. モデルを入手して端末に保存（進み具合つき） ----
  Lab.download = async function (onProgress) {
    if (!window.caches) throw new Error('このアドレスでは保存機能(Cache)が使えません（https が必要）');
    if (await Lab.cached()) { log('モデルは入手済みです'); return; }
    const t0 = performance.now();
    log('■ モデル入手開始: ' + modelUrl);
    const res = await fetch(modelUrl);
    if (!res.ok || !res.body) throw new Error('入手できません (HTTP ' + res.status + ')');
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const counter = new TransformStream({ transform(chunk, ctl) { got += chunk.byteLength; onProgress(got, total); ctl.enqueue(chunk); } });
    const cache = await caches.open(CACHE);
    await cache.put(modelUrl, new Response(res.body.pipeThrough(counter), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(total) } }));
    log('モデル入手完了: ' + Math.round(got / 1e6) + ' MB / ' + sec(t0) + ' 秒');
  };

  Lab.removeModel = async function () {
    if (Lab.llm && Lab.llm.close) { try { Lab.llm.close(); } catch (e) { /* 無視 */ } }
    Lab.llm = null;
    if (window.caches) await caches.delete(CACHE);
    log('モデルを端末から削除しました');
  };

  // 公式手順の genai_bundle.cjs は CDN が application/node で返すためブラウザに拒否される(2026-09-18 実測)。.mjs を使う
  let mp = null;
  async function loadRuntime() {
    if (mp) return mp;
    try { mp = await import(MP_BASE + '/genai_bundle.mjs'); }
    catch (e) { throw new Error('実行部品を読み込めません（ネット接続を確認）: ' + e.message); }
    return mp;
  }

  // ---- 3. モデルをGPUに載せる ----
  Lab.load = async function () {
    if (Lab.llm) return;
    const t0 = performance.now();
    log('■ モデル読み込み開始');
    const rt = await loadRuntime();
    const genai = await rt.FilesetResolver.forGenAiTasks(MP_BASE + '/wasm');
    const hit = await (await caches.open(CACHE)).match(modelUrl);
    if (!hit) throw new Error('先にモデルを入手してください');
    Lab.llm = await rt.LlmInference.createFromOptions(genai, {
      baseOptions: { modelAssetBuffer: hit.body.getReader() }, // 2.9GBを一度にメモリへ載せず、流し込みで渡す
      maxTokens: 2048, topK: 1, temperature: 0.1, randomSeed: 1, maxNumImages: 1
    });
    log('モデル読み込み完了: ' + sec(t0) + ' 秒');
  };

  // ---- 4. 写真1枚を認識 ----
  Lab.runOnImage = async function (source) { // source: URL文字列 / canvas / img
    await Lab.load();
    const t0 = performance.now();
    log('■ 認識開始');
    let soFar = '', stopped = false;
    let text = await Lab.llm.generateResponse(
      ['<start_of_turn>user\n', { imageSource: source }, PROMPT, '<end_of_turn>\n<start_of_turn>model\n'],
      (partial) => {
        soFar += partial;
        if (!stopped && isLooping(soFar) && Lab.llm.cancelProcessing) { stopped = true; try { Lab.llm.cancelProcessing(); } catch (e) { /* 止められない版もある */ } }
      });
    if (!text) text = soFar;
    text = text.replace(/<end_of_turn>/g, '').trim();
    log('認識完了: ' + sec(t0) + ' 秒' + (stopped ? '（同じ行の繰り返しが出たため途中で止めました）' : ''));
    log('--- AIの答え（そのまま） ---\n' + text);
    const items = Lab.parse(text);
    if (items.looped) log('（繰り返しが出た所から後ろは捨てました）');
    log('--- 読み取れた品 ' + items.length + '件 ---\n' + (items.length ? items.map((i) => '・' + i.name + ' ×' + i.qty + (i.note ? '（' + i.note + '）' : '')).join('\n') : '（読み取れませんでした）'));
    return { text: text, items: items, sec: sec(t0) };
  };

  function pickToCanvas() {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
      document.body.appendChild(input);
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) return resolve(null);
        const url = URL.createObjectURL(f), img = new Image();
        img.onload = () => {
          const r = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
      input.click();
    });
  }

  // ---- 画面 ----
  App.registerScreen('lab', async function (params, root) {
    Lab.report = [];
    root.appendChild(h('header', { class: 'topbar' },
      h('a', { class: 'back', href: '#/settings' }, '‹ 設定'),
      h('div', { class: 'topbar-title' }, h('h1', null, '実験室：写真の認識'))));
    root.appendChild(h('div', { class: 'card' },
      h('p', null, 'この端末の中だけで、写真から持ち物を読み取れるかを実際に試します。写真は端末の外へ出ません。'),
      h('p', { class: 'sub' }, '最初にAIモデル（約2.9GB）を入手します。Wi-Fiで行ってください。入手は1回だけで、端末に保存されます。')));

    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-in' }));
    const barText = h('div', { class: 'sub' });
    const preview = h('div', { class: 'photo-strip' });
    logEl = h('pre', { class: 'lablog' });
    const busy = (btn, on) => { btn.disabled = on; };
    const guard = (btn, fn) => async () => {
      busy(btn, true);
      try { await fn(); } catch (e) { log('★エラー: ' + (e && e.message || e)); U.toast('エラー: ' + (e && e.message || e), true); }
      busy(btn, false);
    };

    const bDl = h('button', { class: 'btn primary' }, '① モデルを入手');
    bDl.addEventListener('click', guard(bDl, async () => {
      if (await Lab.cached()) { log('モデルは入手済みです'); return; }
      await Lab.download((got, total) => {
        bar.firstChild.style.width = (total ? got / total * 100 : 0) + '%';
        barText.textContent = Math.round(got / 1e6) + ' / ' + Math.round(total / 1e6) + ' MB';
      });
    }));
    const bRun = h('button', { class: 'btn primary' }, '② 写真を撮って試す');
    bRun.addEventListener('click', guard(bRun, async () => {
      const c = await pickToCanvas();
      if (!c) return;
      preview.innerHTML = '';
      c.className = 'labphoto';
      preview.appendChild(c);
      await Lab.runOnImage(c);
    }));
    const bCopy = h('button', { class: 'btn' }, '結果をコピー');
    bCopy.addEventListener('click', async () => {
      const text = Lab.report.join('\n');
      try { await navigator.clipboard.writeText(text); U.toast('コピーしました'); }
      catch (e) { const ta = h('textarea', { class: 'input', rows: '8' }, text); U.modal(h('div', null, h('p', null, '下を長押しでコピーしてください'), ta, h('div', { class: 'modal-btns' }, h('button', { class: 'btn primary', onclick: (ev) => ev.target.closest('.modal-bg').remove() }, '閉じる')))); ta.select(); }
    });
    const bDel = h('button', { class: 'btn danger' }, 'モデルを削除（2.9GBを空ける）');
    bDel.addEventListener('click', guard(bDel, async () => {
      if (await U.confirm('入手したAIモデルをこの端末から削除しますか？', { okLabel: '削除', danger: true })) await Lab.removeModel();
    }));

    root.appendChild(h('div', { class: 'toolrow' }, bDl, bRun));
    root.appendChild(bar);
    root.appendChild(barText);
    root.appendChild(preview);
    root.appendChild(h('h2', { class: 'sec' }, '記録（この内容をそのまま教えてください）'));
    root.appendChild(logEl);
    root.appendChild(h('div', { class: 'toolrow' }, bCopy, bDel));
    await Lab.inspect();
  });

  App.registerSettings({
    order: 80, title: '実験室：この端末で写真の認識を試す',
    render: async function (box) {
      box.appendChild(h('p', { class: 'sub' }, '写真を端末の外へ出さずに、持ち物を自動で読み取れるかを試すページです。普段の利用には関係しません。'));
      box.appendChild(h('a', { class: 'btn', href: '#/lab' }, '実験室を開く'));
    }
  });

  window.Lab = Lab;
})();
