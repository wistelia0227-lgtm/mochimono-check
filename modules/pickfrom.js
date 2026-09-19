// 全体写真の上で品を指で囲んで登録する（独立モジュール。外すにはこのファイルと index.html の script 行を消す）
// 囲んだ部分を切り抜いて品の写真にし、囲んだ場所は全体写真の側に覚えておく（ref.regions。無くても動く追加フィールド）。
// 実験室のAIモデルが端末に入っていれば、切り抜きから品名を提案させられる（写真は端末の外へ出ない）。
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model;
  const PickFrom = {};

  function loadImg(src) {
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('写真を開けません')); i.src = src; });
  }
  function cropCanvas(img, r, max) {
    const sw = Math.max(1, Math.round(r.w * img.naturalWidth)), sh = Math.max(1, Math.round(r.h * img.naturalHeight));
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(img, Math.round(r.x * img.naturalWidth), Math.round(r.y * img.naturalHeight), sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  PickFrom.open = async function (stay, ref, onDone) {
    const rec = await DB.get('photos', ref.id);
    const img = await loadImg(rec ? rec.data : ref.thumb);
    const master = await window.Master.load();
    if (!ref.regions) ref.regions = [];
    let curCat = master.cats[0];
    let added = 0;

    const pic = h('img', { class: 'pf-img', src: img.src, draggable: 'false' });
    const layer = h('div', { class: 'pf-layer' });
    const stage = h('div', { class: 'pf-stage' }, pic, layer);
    const sheet = h('div', { class: 'pf-sheet' });
    const hint = h('div', { class: 'pf-hint' }, '登録したい品を、指でなぞって四角く囲んでください');
    const bg = h('div', { class: 'pf-bg' },
      h('div', { class: 'pf-head' },
        h('div', { class: 'pf-title' }, '写真から品を選ぶ'),
        h('button', { class: 'btn primary', onclick: () => { bg.remove(); onDone(added); } }, '完了')),
      hint, stage, sheet);
    document.body.appendChild(bg);

    // 自動で見つけた枠の候補（点線）。登録済みの枠と大きく重なる候補は「使用済み」として出さない
    let auto = [], showAuto = true;
    const overlap = (a, b) => {
      const i = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return i / (a.w * a.h + b.w * b.h - i);
    };
    const freeAuto = () => auto.filter((c) => !ref.regions.some((g) => overlap(c, g) > 0.5));
    const boxStyle = (g) => 'left:' + g.x * 100 + '%;top:' + g.y * 100 + '%;width:' + g.w * 100 + '%;height:' + g.h * 100 + '%';
    const drawRegions = () => {
      layer.innerHTML = '';
      if (showAuto) freeAuto().forEach((c) => layer.appendChild(h('div', { class: 'pf-box cand', style: boxStyle(c) })));
      ref.regions.forEach((g) => {
        layer.appendChild(h('div', { class: 'pf-box done', style: boxStyle(g) }, h('span', { class: 'pf-label' }, g.label)));
      });
    };
    drawRegions();
    const autoBtn = h('button', { class: 'btn small', hidden: true, onclick: () => { showAuto = !showAuto; autoBtn.textContent = showAuto ? '候補を隠す' : '候補を出す'; drawRegions(); } }, '候補を隠す');
    bg.querySelector('.pf-head').insertBefore(autoBtn, bg.querySelector('.pf-head').lastChild);

    // ---- タップで自動的に囲む（segment.js があれば）。下準備は裏で進め、済むまでは指で囲む方法だけ ----
    const HINT_DRAW = '登録したい品を、指でなぞって四角く囲んでください';
    let seg = null, segBusy = false;
    if (window.Segment) {
      hint.textContent = HINT_DRAW + '（タップで自動的に囲む機能を準備中…）';
      window.Segment.prepare(img.src).then((s) => {
        seg = s;
        const READY = '品をタップすると自動で囲みます。指でなぞって囲むこともできます（準備 ' + s.prepSec + '秒・' + window.Segment.info + '）';
        if (!sheet.firstChild) hint.textContent = READY;
        // 続けて、写真の中の品を自動で探して候補の枠を出す（人のタップが来たらそちらを優先）
        const t1 = performance.now();
        s.propose({
          shouldPause: () => segBusy,
          onProgress: (p) => { if (!sheet.firstChild) hint.textContent = READY + '　品を自動で探しています… ' + Math.round(p * 100) + '%'; }
        }).then((boxes) => {
          if (!bg.isConnected) return;
          auto = boxes;
          autoBtn.hidden = !boxes.length;
          if (!sheet.firstChild && !live) drawRegions();
          const msg = boxes.length
            ? '点線の枠が ' + boxes.length + ' 個見つかりました。登録したい枠をタップしてください。枠が無い品はその上をタップ、または指でなぞって囲めます'
            : '品を自動では見つけられませんでした。品をタップするか、指でなぞって囲んでください';
          if (!sheet.firstChild) hint.textContent = msg + '（探索 ' + ((performance.now() - t1) / 1000).toFixed(0) + '秒）';
        }).catch((e) => { if (!sheet.firstChild) hint.textContent = READY + '（自動で探す機能は使えませんでした: ' + (e && e.message || e) + '）'; });
      }).catch((e) => { hint.textContent = HINT_DRAW + '（自動で囲む機能は使えません: ' + (e && e.message || e) + '）'; });
    }
    const setLive = (r) => { live.style.cssText = 'left:' + r.x * 100 + '%;top:' + r.y * 100 + '%;width:' + r.w * 100 + '%;height:' + r.h * 100 + '%'; };
    async function tapAt(p) {
      // 自動で見つけた候補の枠の中をタップしたら、その枠を使う（重なっていれば小さい順。「狭く／広く」で切り替え）
      const hits = showAuto ? freeAuto().filter((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h).sort((a, b) => a.w * a.h - b.w * b.h) : [];
      if (hits.length) { setLive(hits[0]); openSheet(hits[0], { cands: hits, idx: 0 }); return; }
      if (!seg) { live.remove(); live = null; if (window.Segment) U.toast('自動で囲む機能を準備中です。指でなぞって囲むこともできます'); return; }
      if (segBusy) { live.remove(); live = null; return; }
      segBusy = true;
      live.classList.add('thinking');
      setLive({ x: Math.max(0, p.x - 0.03), y: Math.max(0, p.y - 0.03), w: 0.06, h: 0.06 });
      try {
        const res = await seg.tap(p.x, p.y);
        if (!res.cands.length) {
          live.remove(); live = null;
          U.toast('うまく囲めませんでした。指でなぞって囲んでください', true);
          // 何が起きたかを画面に残す（実機でしか分からない不具合を報告してもらうため）
          hint.hidden = false;
          hint.textContent = '自動で囲めませんでした。指でなぞって囲んでください。［診断: ' + seg.diag + '］';
          return;
        }
        live.classList.remove('thinking');
        setLive(res.cands[res.best]);
        openSheet(res.cands[res.best], { cands: res.cands, idx: res.best });
      } catch (e) {
        if (live) { live.remove(); live = null; }
        U.toast('自動で囲めませんでした: ' + (e && e.message || e), true);
        hint.hidden = false;
        hint.textContent = '自動で囲めませんでした。指でなぞって囲んでください。［エラー: ' + (e && e.message || e) + '］';
      } finally { segBusy = false; }
    }

    // ---- なぞって囲む ----
    let start = null, live = null;
    const pos = (e) => {
      const b = pic.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
    };
    const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    stage.addEventListener('pointerdown', (e) => {
      if (sheet.firstChild) return; // 入力中は新しく囲まない
      start = pos(e);
      live = h('div', { class: 'pf-box' });
      layer.appendChild(live);
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      e.preventDefault();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!start) return;
      const r = rectOf(start, pos(e));
      live.style.cssText = 'left:' + r.x * 100 + '%;top:' + r.y * 100 + '%;width:' + r.w * 100 + '%;height:' + r.h * 100 + '%';
    });
    const finish = (e) => {
      if (!start) return;
      const r = rectOf(start, pos(e));
      start = null;
      const b = pic.getBoundingClientRect();
      if (r.w * b.width < 24 || r.h * b.height < 24) { tapAt(pos(e)); return; } // ほとんど動いていない＝タップ
      openSheet(r);
    };
    stage.addEventListener('pointerup', finish);
    stage.addEventListener('pointercancel', () => { start = null; if (live) { live.remove(); live = null; } });

    // ---- 囲んだ品の名前と個数を決める ----
    // ctx: タップで囲んだ時の枠の候補 { cands, idx } と、枠を切り替えた時に引き継ぐ入力 { keep }
    function openSheet(r, ctx) {
      hint.hidden = true;
      sheet.innerHTML = '';
      const keep = (ctx && ctx.keep) || {};
      const crop = cropCanvas(img, r, 800);
      crop.className = 'pf-crop';
      const name = h('input', { class: 'input', type: 'text', placeholder: '品名（下から選ぶか入力）', value: keep.name || '' });
      const note = h('input', { class: 'input', type: 'text', placeholder: '色・柄など（任意）', value: keep.note || '' });
      let qty = keep.qty || 1, consumable = !!keep.consumable;
      // 自動で囲んだ枠が違う時: 候補（狭い順）を「狭く」「広く」で切り替える。入力した内容は引き継ぐ
      const resize = (ctx && ctx.cands && ctx.cands.length > 1) ? h('div', { class: 'pf-resize' },
        h('span', { class: 'sub' }, '枠が違う時 →'),
        h('button', { class: 'btn small', disabled: ctx.idx <= 0, onclick: () => swap(ctx.idx - 1) }, '狭く'),
        h('button', { class: 'btn small', disabled: ctx.idx >= ctx.cands.length - 1, onclick: () => swap(ctx.idx + 1) }, '広く')) : null;
      function swap(i) {
        setLive(ctx.cands[i]);
        openSheet(ctx.cands[i], { cands: ctx.cands, idx: i, keep: { name: name.value, note: note.value, qty: qty, consumable: consumable } });
      }
      const qtyEl = h('button', { class: 'step-n', onclick: async () => { const v = await U.qtyPad(name.value.trim(), qty, { min: 1 }); if (v != null) { qty = v; qtyEl.textContent = String(qty); } } }, String(qty));
      const chips = h('div', { class: 'chips pf-chips' });
      const cats = h('div', { class: 'chips cats pf-chips' });
      const drawChips = () => {
        cats.innerHTML = ''; chips.innerHTML = '';
        master.cats.forEach((c) => cats.appendChild(h('button', { class: 'chip cat' + (c === curCat ? ' on' : ''), onclick: () => { curCat = c; drawChips(); } }, c.name)));
        master.items.filter((m) => m.catId === curCat.id).forEach((m) => chips.appendChild(
          h('button', { class: 'chip item' + (name.value === m.name ? ' has' : ''), onclick: () => { name.value = m.name; consumable = m.consumable; drawChips(); } }, m.name)));
      };
      drawChips();
      const close = () => { sheet.innerHTML = ''; if (live) { live.remove(); live = null; } hint.hidden = false; drawRegions(); };

      const aiBtn = h('button', { class: 'btn small' }, '✨ AIに品名を聞く');
      aiBtn.hidden = true;
      if (window.Lab && window.Lab.cached) window.Lab.cached().then((ok) => { aiBtn.hidden = !ok; });
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true; aiBtn.textContent = '調べています…（初回は読み込みに時間がかかります）';
        try {
          const res = await window.Lab.runOnImage(crop, { one: true, vocab: master.items.map((m) => m.name) });
          const it = res.items && res.items[0];
          if (it) {
            name.value = it.name; note.value = note.value || it.note; qty = it.qty; qtyEl.textContent = String(qty);
            const m = master.items.find((x) => x.name === it.name);
            if (m) { curCat = master.cats.find((c) => c.id === m.catId) || curCat; consumable = m.consumable; }
            drawChips();
          } else U.toast('読み取れませんでした。手で選んでください', true);
        } catch (e) { U.toast('AIを使えませんでした: ' + e.message, true); }
        aiBtn.disabled = false; aiBtn.textContent = '✨ AIに品名を聞く';
      });

      const add = async () => {
        const nm = name.value.trim();
        if (!nm) { U.toast('品名を選ぶか入力してください', true); return; }
        const thumb = cropCanvas(img, r, 160).toDataURL('image/jpeg', 0.7);
        const pref = await U.storePhoto(crop.toDataURL('image/jpeg', 0.85), thumb);
        const it = Model.addItem(stay, { name: nm, cat: curCat.name, consumable: consumable, qty: qty, note: note.value.trim(), photos: [pref] });
        if (!it.photos.some((p) => p.id === pref.id)) it.photos.push(pref); // 既にある品に足された場合も写真は付ける
        ref.regions.push({ x: r.x, y: r.y, w: r.w, h: r.h, itemId: it.id, label: nm + (qty > 1 ? ' ×' + qty : '') });
        await DB.put('stays', stay);
        added++;
        live = null;
        sheet.innerHTML = '';
        hint.hidden = false;
        hint.textContent = '「' + nm + '」を足しました（計 ' + added + ' 品）。続けて次の品を囲めます';
        drawRegions();
      };

      sheet.appendChild(h('div', { class: 'pf-sheet-in' },
        h('div', { class: 'pf-row' }, crop,
          h('div', { class: 'pf-fields' }, name, note,
            h('div', { class: 'pf-row2' },
              h('div', { class: 'stepper' },
                h('button', { class: 'step', onclick: () => { qty = Math.max(1, qty - 1); qtyEl.textContent = String(qty); } }, '−'), qtyEl,
                h('button', { class: 'step', onclick: () => { qty++; qtyEl.textContent = String(qty); } }, '＋')),
              aiBtn))),
        resize,
        // 決定ボタンは品名の一覧より上に置く（スマホで一覧の下に隠れないように）
        h('div', { class: 'modal-btns pf-btns' },
          h('button', { class: 'btn', onclick: close }, '囲み直す'),
          h('button', { class: 'btn primary', onclick: add }, 'この品を足す')),
        cats, chips));
    }
  };

  window.PickFrom = PickFrom;
})();
