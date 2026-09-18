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

    const drawRegions = () => {
      layer.innerHTML = '';
      ref.regions.forEach((g) => {
        layer.appendChild(h('div', { class: 'pf-box done', style: 'left:' + g.x * 100 + '%;top:' + g.y * 100 + '%;width:' + g.w * 100 + '%;height:' + g.h * 100 + '%' },
          h('span', { class: 'pf-label' }, g.label)));
      });
    };
    drawRegions();

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
      if (r.w * b.width < 24 || r.h * b.height < 24) { live.remove(); live = null; return; } // 小さすぎる＝誤タップ
      openSheet(r);
    };
    stage.addEventListener('pointerup', finish);
    stage.addEventListener('pointercancel', () => { start = null; if (live) { live.remove(); live = null; } });

    // ---- 囲んだ品の名前と個数を決める ----
    function openSheet(r) {
      hint.hidden = true;
      const crop = cropCanvas(img, r, 800);
      crop.className = 'pf-crop';
      const name = h('input', { class: 'input', type: 'text', placeholder: '品名（下から選ぶか入力）' });
      const note = h('input', { class: 'input', type: 'text', placeholder: '色・柄など（任意）' });
      let qty = 1, consumable = false;
      const qtyEl = h('button', { class: 'step-n', onclick: async () => { const v = await U.qtyPad(name.value.trim(), qty, { min: 1 }); if (v != null) { qty = v; qtyEl.textContent = String(qty); } } }, '1');
      const chips = h('div', { class: 'chips pf-chips' });
      const cats = h('div', { class: 'chips cats pf-chips' });
      const drawChips = () => {
        cats.innerHTML = ''; chips.innerHTML = '';
        master.cats.forEach((c) => cats.appendChild(h('button', { class: 'chip cat' + (c === curCat ? ' on' : ''), onclick: () => { curCat = c; drawChips(); } }, c.name)));
        master.items.filter((m) => m.catId === curCat.id).forEach((m) => chips.appendChild(
          h('button', { class: 'chip item' + (name.value === m.name ? ' has' : ''), onclick: () => { name.value = m.name; consumable = m.consumable; drawChips(); } }, m.name)));
      };
      drawChips();
      const close = () => { sheet.innerHTML = ''; if (live) { live.remove(); live = null; } hint.hidden = false; };

      const aiBtn = h('button', { class: 'btn small' }, '✨ AIに品名を聞く');
      aiBtn.hidden = true;
      if (window.Lab && window.Lab.cached) window.Lab.cached().then((ok) => { aiBtn.hidden = !ok; });
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true; aiBtn.textContent = '調べています…（初回は読み込みに時間がかかります）';
        try {
          const res = await window.Lab.runOnImage(crop);
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
        // 決定ボタンは品名の一覧より上に置く（スマホで一覧の下に隠れないように）
        h('div', { class: 'modal-btns pf-btns' },
          h('button', { class: 'btn', onclick: close }, '囲み直す'),
          h('button', { class: 'btn primary', onclick: add }, 'この品を足す')),
        cats, chips));
    }
  };

  window.PickFrom = PickFrom;
})();
