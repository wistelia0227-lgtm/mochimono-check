// データの形と判定ロジック（画面なし）。window.Model で公開。
//
// stay(滞在) = { id, residentId, dateIn, dateOut, status, items[], photos[],
//               checkInBy, checkInAt, checkOutBy, checkOutAt, memo }
//   status: 'checkin'(入所チェック中) → 'staying'(滞在中) → 'checkout'(退所チェック中) → 'done'(完了)
// item(品)  = { id, name, cat, consumable, qty, inChecked, outQty, outChecked,
//               note, outNote, photos[{id,thumb}], mid, addedAt }
//   入所も退所も「同じ品の2回の数え」として1つの形で持つ。
(function () {
  'use strict';
  const U = window.U;
  const Model = {};

  Model.STATUS = {
    checkin: { label: '入所チェック中', cls: 'st-checkin' },
    staying: { label: '滞在中', cls: 'st-staying' },
    checkout: { label: '退所チェック中', cls: 'st-checkout' },
    done: { label: '完了', cls: 'st-done' }
  };

  Model.newResident = function (name) {
    return { id: U.uid('r'), name: name, kana: '', room: '', note: '', notes: [], archived: false, createdAt: Date.now() };
  };

  // 古いデータを読んでも欠けたフィールドが揃うようにする（追加のみ・非破壊）
  Model.normalizeResident = function (r) {
    if (!r.notes) r.notes = [];
    if (r.kana == null) r.kana = '';
    if (r.room == null) r.room = '';
    if (r.note == null) r.note = '';
    return r;
  };
  Model.normalizeStay = function (st) {
    if (!st.items) st.items = [];
    if (!st.photos) st.photos = [];
    if (!Model.STATUS[st.status]) st.status = 'checkin';
    st.items.forEach((it) => {
      if (!it.photos) it.photos = [];
      if (typeof it.qty !== 'number' || isNaN(it.qty)) it.qty = 1;
      if (it.outQty === undefined) it.outQty = null;
      if (it.note == null) it.note = '';
      if (it.outNote == null) it.outNote = '';
      if (!it.cat) it.cat = 'その他';
    });
    return st;
  };

  // prev(前回の滞在)があれば品をひな形として写す。写した品は入所時「未確認」から始まる
  Model.newStay = function (residentId, opts) {
    opts = opts || {};
    const st = {
      id: U.uid('s'), residentId: residentId,
      dateIn: opts.dateIn || U.today(), dateOut: opts.dateOut || '',
      status: 'checkin', items: [], photos: [],
      checkInBy: '', checkInAt: null, checkOutBy: '', checkOutAt: null,
      memo: '', createdAt: Date.now()
    };
    if (opts.prev) {
      st.items = opts.prev.items.map((it) => ({
        id: U.uid('i'), name: it.name, cat: it.cat, consumable: !!it.consumable,
        qty: it.qty, inChecked: false, outQty: null, outChecked: false,
        note: it.note || '', outNote: '', photos: (it.photos || []).slice(),
        mid: false, addedAt: Date.now()
      }));
      st.templateFrom = opts.prev.id;
    }
    return st;
  };

  // 品を足す。同じ名前・同じカテゴリの品が既にあれば個数+1
  Model.addItem = function (st, def) {
    const cat = def.cat || 'その他';
    const hit = st.items.find((it) => it.name === def.name && it.cat === cat);
    if (hit) {
      // ひな形の未確認品は、最初のタップでは「持参あり」にするだけ（個数は前回のまま。個数の指定があればそれに合わせる）
      if (hit.inChecked) hit.qty += (def.qty || 1);
      else if (def.qty) hit.qty = def.qty;
      if (def.note && !hit.note) hit.note = def.note;
      hit.inChecked = true;
      return hit;
    }
    const it = {
      id: U.uid('i'), name: def.name, cat: cat, consumable: !!def.consumable,
      qty: def.qty || 1, inChecked: true, outQty: null, outChecked: false,
      note: def.note || '', outNote: '', photos: def.photos || [],
      mid: st.status !== 'checkin', addedAt: Date.now()
    };
    st.items.push(it);
    return it;
  };

  // 連続撮影で「写真だけ先に」足した品。名前は後で付ける（unnamed は任意の追加フィールド）
  Model.addUnnamed = function (st, photoRef) {
    const n = st.items.filter((it) => it.unnamed).length + 1;
    const it = {
      id: U.uid('i'), name: '（名前未設定 ' + n + '）', cat: 'その他', consumable: false,
      qty: 1, inChecked: true, outQty: null, outChecked: false,
      note: '', outNote: '', photos: [photoRef],
      mid: st.status !== 'checkin', addedAt: Date.now(), unnamed: true
    };
    st.items.push(it);
    return it;
  };

  // 退所時の状態: unchecked(未確認) / ok / consumed(消耗品が減った=正常) / short(足りない) / over(多い)
  Model.outState = function (it) {
    if (!it.outChecked || it.outQty == null) return 'unchecked';
    if (it.outQty === it.qty) return 'ok';
    if (it.outQty < it.qty) return it.consumable ? 'consumed' : 'short';
    return 'over';
  };

  Model.summary = function (st) {
    const s = { kinds: st.items.length, total: 0, inUnchecked: 0, outDone: 0, unchecked: [], short: [], over: [] };
    st.items.forEach((it) => {
      s.total += it.qty;
      if (!it.inChecked) s.inUnchecked++;
      const state = Model.outState(it);
      if (state === 'unchecked') s.unchecked.push(it);
      else s.outDone++;
      if (state === 'short') s.short.push(it);
      if (state === 'over') s.over.push(it);
    });
    s.problems = s.unchecked.length + s.short.length + s.over.length;
    return s;
  };

  // 退所時に合わなかった品を文章にする（申し送りの下書き・完了画面・印刷で共用）
  Model.problemLines = function (st) {
    const s = Model.summary(st);
    const lines = [];
    s.short.forEach((it) => lines.push(it.name + '：入所時' + it.qty + ' → 退所時' + it.outQty + '（' + (it.qty - it.outQty) + '点不足）' + (it.outNote ? ' ' + it.outNote : '')));
    s.over.forEach((it) => lines.push(it.name + '：入所時' + it.qty + ' → 退所時' + it.outQty + '（' + (it.outQty - it.qty) + '点多い）' + (it.outNote ? ' ' + it.outNote : '')));
    s.unchecked.forEach((it) => lines.push(it.name + '：退所時未確認'));
    return lines;
  };

  // カテゴリ順にグループ化。マスタに無いカテゴリ名は末尾へ
  Model.groupItems = function (items, catOrder) {
    const groups = [];
    const byCat = {};
    items.forEach((it) => { (byCat[it.cat] = byCat[it.cat] || []).push(it); });
    catOrder.forEach((c) => { if (byCat[c]) { groups.push({ cat: c, items: byCat[c] }); delete byCat[c]; } });
    Object.keys(byCat).forEach((c) => groups.push({ cat: c, items: byCat[c] }));
    return groups;
  };

  Model.stayPhotoIds = function (st) {
    const ids = (st.photos || []).map((p) => p.id);
    (st.items || []).forEach((it) => (it.photos || []).forEach((p) => ids.push(p.id)));
    return ids;
  };

  window.Model = Model;
})();
