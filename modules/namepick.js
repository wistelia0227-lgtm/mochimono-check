// 連続撮影した「名前未設定」の品に、写真を見ながら名前と個数を付ける（独立モジュール）
// 決めると自動で次の未設定の品へ進む。端末に実験室のAIモデルがあれば品名を提案させられる（写真は端末の外へ出ない）。
// 注: 品名チップの選び方は pickfrom.js の入力欄と同じ作り。片方を直す時はもう片方も見ること。
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB;
  const NamePick = {};

  function loadImg(src) {
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('写真を開けません')); i.src = src; });
  }

  // stay の中の名前未設定の品を順に処理する。onDone は全部終わるか閉じた時に1回呼ぶ
  NamePick.run = async function (stay, startItem, onDone) {
    const master = await window.Master.load();
    let curCat = master.cats[0];
    const pending = () => stay.items.filter((it) => it.unnamed);
    let it = startItem || pending()[0];
    if (!it) { onDone(); return; }

    const next = async () => {
      await DB.put('stays', stay);
      const rest = pending();
      if (!rest.length) { U.toast('全ての品に名前が付きました'); onDone(); return; }
      it = rest[0];
      show();
    };

    async function show() {
      let close;
      let qty = it.qty || 1, consumable = false;
      const ref = it.photos[0];
      const rec = ref ? await DB.get('photos', ref.id) : null;
      const pic = h('img', { class: 'np-photo', src: rec ? rec.data : (ref ? ref.thumb : '') });
      const name = h('input', { class: 'input', type: 'text', placeholder: '品名（下から選ぶか入力）' });
      const note = h('input', { class: 'input', type: 'text', placeholder: '色・柄など（任意）', value: it.note || '' });
      const qtyBtn = h('button', { class: 'step-n' }, String(qty));
      const setQty = (v) => { qty = Math.max(1, v); qtyBtn.textContent = String(qty); };
      qtyBtn.addEventListener('click', async () => { const v = await U.qtyPad(name.value.trim(), qty, { min: 1 }); if (v != null) setQty(v); });
      const cats = h('div', { class: 'chips cats pf-chips' }), chips = h('div', { class: 'chips pf-chips' });
      const drawChips = () => {
        cats.innerHTML = ''; chips.innerHTML = '';
        master.cats.forEach((c) => cats.appendChild(h('button', { class: 'chip cat' + (c === curCat ? ' on' : ''), onclick: () => { curCat = c; drawChips(); } }, c.name)));
        master.items.filter((m) => m.catId === curCat.id).forEach((m) => chips.appendChild(
          h('button', { class: 'chip item' + (name.value === m.name ? ' has' : ''), onclick: () => { name.value = m.name; consumable = m.consumable; drawChips(); } }, m.name)));
      };
      drawChips();

      const aiBtn = h('button', { class: 'btn small' }, '✨ AIに品名を聞く');
      aiBtn.hidden = true;
      const askAi = async () => {
        aiBtn.disabled = true; aiBtn.textContent = '調べています…';
        try {
          const res = await window.Lab.runOnImage(await loadImg(pic.src));
          const g = res.items && res.items[0];
          if (g && !name.value.trim()) { // 人が先に入力していたら上書きしない
            name.value = g.name; if (!note.value) note.value = g.note; setQty(g.qty);
            const m = master.items.find((x) => x.name === g.name);
            if (m) { curCat = master.cats.find((c) => c.id === m.catId) || curCat; consumable = m.consumable; }
            drawChips();
          } else if (!g) U.toast('読み取れませんでした。手で選んでください', true);
        } catch (e) { U.toast('AIを使えませんでした: ' + e.message, true); }
        aiBtn.disabled = false; aiBtn.textContent = '✨ AIに品名を聞く';
      };
      aiBtn.addEventListener('click', askAi);
      if (window.Lab && window.Lab.cached) window.Lab.cached().then((ok) => {
        aiBtn.hidden = !ok;
        if (ok && window.Lab.llm) askAi(); // モデルが既に読み込み済みなら、開いた時点で自動で聞く
      });

      const decide = async () => {
        const nm = name.value.trim();
        if (!nm) { U.toast('品名を選ぶか入力してください', true); return; }
        const same = stay.items.find((x) => x !== it && !x.unnamed && x.name === nm && x.cat === curCat.name);
        if (same) { // 同じ品が既にあれば、そちらに個数と写真をまとめる
          if (same.inChecked) same.qty += qty; else same.qty = qty; // ひな形の未確認品なら、今回数えた個数に合わせる
          same.inChecked = true;
          it.photos.forEach((p) => same.photos.push(p));
          if (note.value.trim() && !same.note) same.note = note.value.trim();
          stay.items.splice(stay.items.indexOf(it), 1);
        } else {
          it.name = nm; it.cat = curCat.name; it.consumable = consumable; it.qty = qty; it.note = note.value.trim();
          delete it.unnamed;
        }
        close();
        next();
      };
      const remove = async () => {
        if (!(await U.confirm('この写真の品を削除しますか？', { okLabel: '削除', danger: true }))) return;
        stay.items.splice(stay.items.indexOf(it), 1);
        await DB.put('stays', stay);
        await DB.dropPhotosIfUnused(it.photos.map((p) => p.id));
        close();
        next();
      };

      close = U.modal(h('div', null,
        h('h2', null, '品名を付ける（残り ' + pending().length + ' 件）'),
        h('div', { class: 'pf-row' }, pic,
          h('div', { class: 'pf-fields' }, name, note,
            h('div', { class: 'pf-row2' },
              h('div', { class: 'stepper' },
                h('button', { class: 'step', onclick: () => setQty(qty - 1) }, '−'), qtyBtn,
                h('button', { class: 'step', onclick: () => setQty(qty + 1) }, '＋')),
              aiBtn))),
        h('div', { class: 'modal-btns pf-btns' },
          h('button', { class: 'btn danger', onclick: remove }, '削除'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', onclick: async () => { close(); await DB.put('stays', stay); onDone(); } }, 'あとで'),
          h('button', { class: 'btn primary', onclick: decide }, '決定して次へ')),
        cats, chips), { wide: true });
    }
    show();
  };

  window.NamePick = NamePick;
})();
