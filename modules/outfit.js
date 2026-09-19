// 服装の記録（任意）: 来所時と退所時に「着ている物」を写真とメモで残す（独立モジュール）
// 荷物の一覧には入らない、着てきた上着・靴・帽子などの取り違え防止用。入れなくても完了は妨げない。
// データ: stay.outfitIn / stay.outfitOut = { photos:[{id,thumb}], note }（任意の追加フィールド）
// 外すにはこのファイルと index.html の script 行を消す（記録済みのデータは残る）。
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, App = window.App;
  const Outfit = {};
  const WORDS = ['上着', 'ズボン', 'スカート', '靴', '帽子', '眼鏡', 'マスク', '杖', '腕時計', '補聴器', 'マフラー', '手袋', 'バッグ'];
  const LABEL = { outfitIn: '来所時の服装', outfitOut: '退所時の服装' };

  async function viewer(stay, list, ref, canDelete) {
    const rec = await DB.get('photos', ref.id);
    let close;
    close = U.modal(h('div', null,
      h('img', { class: 'photo-full', src: rec ? rec.data : ref.thumb }),
      h('div', { class: 'modal-btns' },
        canDelete ? h('button', {
          class: 'btn danger', onclick: async () => {
            if (!(await U.confirm('この写真を削除しますか？', { okLabel: '削除', danger: true }))) return;
            list.splice(list.indexOf(ref), 1);
            await DB.put('stays', stay);
            await DB.dropPhotosIfUnused([ref.id]);
            close();
            App.refresh();
          }
        }, '写真を削除') : null,
        h('button', { class: 'btn primary', onclick: () => close() }, '閉じる'))), { wide: true });
  }

  function strip(stay, key, editable) {
    const o = stay[key];
    const box = h('div', { class: 'photo-strip' },
      o.photos.map((p) => h('img', { class: 'thumb lg', src: p.thumb, onclick: () => viewer(stay, o.photos, p, editable) })));
    if (editable) {
      box.appendChild(h('button', {
        class: 'photo-add lg', onclick: async () => {
          const onShot = async (ref) => { o.photos.push(ref); o.at = Date.now(); await DB.put('stays', stay); };
          if (window.Camera) await window.Camera.open({ title: LABEL[key], hint: '全身が入るように。前と後ろなど、続けて撮れます', onShot: onShot });
          else { const ref = await U.pickPhoto(); if (ref) await onShot(ref); }
          App.refresh();
        }
      }, '📷', h('span', null, '撮る')));
      box.appendChild(h('button', {
        class: 'photo-add lg', onclick: async () => {
          const ref = await U.pickPhoto({ gallery: true });
          if (ref) { o.photos.push(ref); o.at = Date.now(); await DB.put('stays', stay); App.refresh(); }
        }
      }, '🖼', h('span', null, '画像から')));
    }
    return box;
  }

  function editor(stay, key) {
    const o = stay[key];
    const memo = h('input', {
      class: 'input', type: 'text', value: o.note, placeholder: '着ている物のメモ（例：紺の上着、黒い靴、茶色の帽子）',
      onchange: async (e) => { o.note = e.target.value.trim(); o.at = Date.now(); await DB.put('stays', stay); }
    });
    const words = h('div', { class: 'chips outfit-words' }, WORDS.map((w) => h('button', {
      class: 'chip cat', onclick: async () => {
        memo.value = (memo.value ? memo.value.replace(/[、\s]+$/, '') + '、' : '') + w;
        o.note = memo.value; o.at = Date.now();
        await DB.put('stays', stay);
        memo.focus();
      }
    }, w)));
    return h('div', null, strip(stay, key, true), memo, words);
  }

  function readonly(stay, key) {
    const o = stay[key];
    if (!o.photos.length && !o.note) return null;
    return h('div', { class: 'outfit-ro' },
      h('div', { class: 'card-title' }, LABEL[key]),
      strip(stay, key, false),
      o.note ? h('div', null, o.note) : null);
  }

  const has = (stay, key) => stay[key].photos.length > 0 || !!stay[key].note;

  // 滞在画面に差し込むカード。中身が無い時は閉じた見出しだけ（任意であることが見た目で分かるように）
  Outfit.card = function (stay, mode) {
    if (mode === 'checkin' || mode === 'staying') {
      return h('details', { class: 'card outfit', open: has(stay, 'outfitIn') },
        h('summary', null, '👕 来所時の服装（任意）' + (has(stay, 'outfitIn') ? ' ✓' : '')),
        h('p', { class: 'sub' }, '着てきた上着・靴・帽子など、荷物の一覧に入らない物の控えです。入れなくても完了できます。'),
        editor(stay, 'outfitIn'));
    }
    if (mode === 'checkout') {
      return h('details', { class: 'card outfit', open: has(stay, 'outfitIn') || has(stay, 'outfitOut') },
        h('summary', null, '👕 退所時の服装（任意）' + (has(stay, 'outfitOut') ? ' ✓' : '')),
        readonly(stay, 'outfitIn') || h('p', { class: 'sub' }, '来所時の服装の記録はありません。'),
        h('div', { class: 'card-title outfit-gap' }, '退所時の服装（来所時と見比べて、着て帰る物を確かめます）'),
        editor(stay, 'outfitOut'));
    }
    const a = readonly(stay, 'outfitIn'), b = readonly(stay, 'outfitOut');
    if (!a && !b) return null;
    return h('div', { class: 'card outfit' }, h('div', { class: 'card-title' }, '👕 服装の記録'), a, b);
  };

  // 確認票（印刷）用
  Outfit.printBlock = function (stay) {
    const rows = ['outfitIn', 'outfitOut'].filter((k) => has(stay, k));
    if (!rows.length) return null;
    return h('table', { class: 'sheet-outfit' }, h('tbody', null, rows.map((k) => h('tr', null,
      h('th', null, LABEL[k]),
      h('td', null, h('div', { class: 'sheet-photos' }, stay[k].photos.map((p) => h('img', { src: p.thumb }))), stay[k].note || '')))));
  };

  window.Outfit = Outfit;
})();
