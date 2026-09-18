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


  // ---- 2. モデルを入手して端末に保存 ----
  // スマホでは画面が消えると通信が止まる(2026-09-19 実機報告)。対策は3つ:
  //  ①入手中は画面を消さない(Wake Lock) ②小分け(PART)で保存し、止まっても続きから ③失敗したら画面が戻るのを待って自動で再開
  const PART = 32 * 1024 * 1024;
  const partKey = (i) => location.origin + '/__labmodel/' + encodeURIComponent(modelUrl) + '/' + i;
  const metaKey = () => location.origin + '/__labmodel/' + encodeURIComponent(modelUrl) + '/meta';

  async function readMeta(cache) {
    const r = await cache.match(metaKey());
    return r ? r.json() : null;
  }
  const writeMeta = (cache, meta) => cache.put(metaKey(), new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));

  Lab.cached = async function () {
    if (!window.caches) return false;
    const cache = await caches.open(CACHE);
    if (await cache.match(modelUrl)) return true; // 旧版(一括保存)で入手済みの端末
    const meta = await readMeta(cache);
    return !!(meta && meta.complete);
  };

  // 保存済みの小分けの数（続きから再開する位置）
  async function partsDone(cache, n) {
    let i = 0;
    while (i < n && (await cache.match(partKey(i)))) i++;
    return i;
  }

  function waitUntilActive() { // 画面が戻り、通信がつながるまで待つ
    return new Promise((resolve) => {
      const ok = () => document.visibilityState === 'visible' && navigator.onLine !== false;
      if (ok()) return resolve();
      const check = () => { if (ok()) { document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); resolve(); } };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('online', check);
    });
  }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* 対応していない端末ではそのまま進める */ }
  }

  Lab.download = async function (onProgress, opts) {
    if (!window.caches) throw new Error('このアドレスでは保存機能(Cache)が使えません（https が必要）');
    if (await Lab.cached()) { log('モデルは入手済みです'); return; }
    const t0 = performance.now();
    const cache = await caches.open(CACHE);
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { /* 無視 */ } }

    const head = await fetch(modelUrl, { method: 'HEAD' });
    const total = Number(head.headers.get('content-length')) || 0;
    if (!head.ok || !total) throw new Error('入手できません (HTTP ' + head.status + ')');
    const n = Math.ceil(total / PART);
    let meta = await readMeta(cache);
    if (!meta || meta.total !== total || meta.part !== PART) { meta = { total: total, part: PART, parts: n, complete: false }; await writeMeta(cache, meta); }

    let i = await partsDone(cache, n);
    log('■ モデル入手開始: ' + Math.round(total / 1e6) + ' MB を ' + n + ' 個に分けて保存' + (i ? '（' + i + ' 個目まで保存済み。続きから）' : ''));
    const regrab = () => { if (document.visibilityState === 'visible') keepAwake(true); }; // 画面が戻ったら Wake Lock を取り直す
    document.addEventListener('visibilitychange', regrab);
    await keepAwake(true);
    try {
      let fails = 0;
      while (i < n) {
        if (opts && opts.stopAfter && i >= opts.stopAfter) throw new Error('（試験用の中断）');
        const from = i * PART, to = Math.min(total, from + PART) - 1;
        try {
          const res = await fetch(modelUrl, { headers: { Range: 'bytes=' + from + '-' + to } });
          if (res.status !== 206) throw new Error('配布元が分割に応じません (HTTP ' + res.status + ')');
          const buf = await res.arrayBuffer();
          if (buf.byteLength !== to - from + 1) throw new Error('受け取った量が足りません');
          await cache.put(partKey(i), new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
          i++; fails = 0;
          onProgress(Math.min(total, i * PART), total);
        } catch (e) {
          fails++;
          log('  ' + (i + 1) + ' 個目で中断（' + e.message + '）→ ' + (fails <= 8 ? '自動で再開します' : '中止'));
          if (fails > 8 || (opts && opts.stopAfter)) throw new Error('モデルの入手が止まりました（' + Math.round(i * PART / 1e6) + ' / ' + Math.round(total / 1e6) + ' MB まで保存済み）。もう一度「モデルを入手」を押すと続きから再開します。[' + e.message + ']');
          await waitUntilActive();
          await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * fails)));
        }
      }
      meta.complete = true;
      await writeMeta(cache, meta);
      log('モデル入手完了: ' + Math.round(total / 1e6) + ' MB / ' + sec(t0) + ' 秒');
    } finally {
      document.removeEventListener('visibilitychange', regrab);
      await keepAwake(false);
    }
  };

  // 小分けを順につないで1本の流れにする（2.9GBを一度にメモリへ載せない）
  async function modelReader() {
    const cache = await caches.open(CACHE);
    const whole = await cache.match(modelUrl);
    if (whole) return whole.body.getReader();
    const meta = await readMeta(cache);
    if (!meta || !meta.complete) throw new Error('先にモデルを入手してください');
    let i = 0;
    return new ReadableStream({
      async pull(ctl) {
        if (i >= meta.parts) { ctl.close(); return; }
        const r = await cache.match(partKey(i++));
        if (!r) { ctl.error(new Error('保存したモデルが欠けています。削除して入手し直してください')); return; }
        ctl.enqueue(new Uint8Array(await r.arrayBuffer()));
      }
    }).getReader();
  }
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
    const reader = await modelReader();
    Lab.llm = await rt.LlmInference.createFromOptions(genai, {
      baseOptions: { modelAssetBuffer: reader },
      maxTokens: 2048, topK: 1, temperature: 0.1, randomSeed: 1, maxNumImages: 1
    });
    log('モデル読み込み完了: ' + sec(t0) + ' 秒');
  };

  // ---- 4. 写真1枚を認識 ----
  // 1枚に1種類だけ写した写真用の指示。品目の一覧を渡して、表記をそれに寄せさせる
  function promptOne(vocab) {
    return 'これは介護施設のショートステイに利用者が持参した持ち物を、1種類だけ写した写真です。写真の中心にある持ち物を答えてください。\n' +
      '次の書式の1行だけで答える（前置きや説明は書かない）:\n品名|個数|色や特徴\n例:\n靴下|2|黒\n' +
      '背景の机や床、手は数えない。靴下は1足を1と数える。\n' +
      (vocab && vocab.length ? '品名は、次の一覧に当てはまるものがあれば必ずその表記を使う。無ければ短い日本語の品名にする:\n' + vocab.join('、') : '');
  }

  Lab.runOnImage = async function (source, opts) { // source: URL文字列 / canvas / img。opts.one = 1種類だけの写真
    await Lab.load();
    const t0 = performance.now();
    log('■ 認識開始');
    let soFar = '', stopped = false;
    let text = await Lab.llm.generateResponse(
      ['<start_of_turn>user\n', { imageSource: source }, (opts && opts.one) ? promptOne(opts.vocab) : PROMPT, '<end_of_turn>\n<start_of_turn>model\n'],
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
      h('p', { class: 'sub' }, '最初にAIモデル（約2.9GB）を入手します。Wi-Fiで行ってください。入手は1回だけで、端末に保存されます。'),
      h('p', { class: 'sub' }, '入手中は画面が消えないようにしています。別のアプリに切り替えたり通信が切れたりして止まっても、保存済みの分は残り、この画面に戻ると自動で続きから再開します。')));

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
