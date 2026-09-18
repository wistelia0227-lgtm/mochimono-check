// ===== 開発用ツール（削除可能モジュール） =====
// 外し方: このファイルを消し、index.html の <script src="modules/devtools.js"> の行を消す。他は何も壊れない。
//   index.html?demo      … 別の保存領域(mochimono_demo)にサンプルを入れて開く。本番データには触れない
//   index.html?selftest  … 別の保存領域でロジックの自己テストを実行し、結果を画面下に出す
//   設定タブ「開発用」   … サンプル投入 / 全データ削除
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model, App = window.App;
  const qs = location.search;

  function dropDb(name) {
    return new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }

  async function fakePhoto(label, color) {
    const draw = (w, hgt) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, w, hgt);
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(w * 0.1, hgt * 0.35, w * 0.8, hgt * 0.3);
      g.fillStyle = '#1f2937'; g.font = 'bold ' + Math.round(hgt * 0.14) + 'px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, w / 2, hgt / 2);
      return c.toDataURL('image/jpeg', 0.7);
    };
    return U.storePhoto(draw(640, 480), draw(160, 120));
  }

  async function seed() {
    const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const mk = (id, name, kana, room) => Object.assign(Model.newResident(name), { id: id, kana: kana, room: room });
    const yamada = mk('r_demo1', '山田 ハナ', 'やまだ はな', '2階 きく');
    const sato = mk('r_demo2', '佐藤 一郎', 'さとう いちろう', '1階 うめ');
    const suzuki = mk('r_demo3', '鈴木 トメ', 'すずき とめ', '2階 ふじ');

    // 山田: 滞在中
    const s1 = Object.assign(Model.newStay(yamada.id, { dateIn: day(-2), dateOut: day(2) }), { id: 's_demo1' });
    Model.addItem(s1, { name: '上着', cat: '衣類', qty: 3, note: '花柄・えんじ・紺。すべて記名あり', photos: [await fakePhoto('上着', '#fca5a5')] });
    Model.addItem(s1, { name: 'ズボン', cat: '衣類', qty: 3, photos: [await fakePhoto('ズボン', '#93c5fd')] });
    Model.addItem(s1, { name: '靴下', cat: '衣類', qty: 4, note: '1足だけ記名なし（白）' });
    Model.addItem(s1, { name: '義歯(上)', cat: '洗面・口腔', note: '夜間は預かり', photos: [await fakePhoto('義歯', '#fde68a')] });
    Model.addItem(s1, { name: '内服薬', cat: '薬・医療', consumable: true, qty: 12, note: '朝昼夕×4日分' });
    Model.addItem(s1, { name: '眼鏡', cat: '身の回り', note: '茶色のフレーム', photos: [await fakePhoto('眼鏡', '#c4b5fd')] });
    s1.photos.push(await fakePhoto('荷物全体', '#a7f3d0'));
    Object.assign(s1, { status: 'staying', checkInBy: '田中', checkInAt: Date.now() - 2 * 864e5 });

    // 佐藤: 本日退所、退所チェックの途中（1点不足）
    const s2 = Object.assign(Model.newStay(sato.id, { dateIn: day(-3), dateOut: day(0) }), { id: 's_demo2' });
    Model.addItem(s2, { name: '上着', cat: '衣類', qty: 2, photos: [await fakePhoto('上着', '#fdba74')] });
    Model.addItem(s2, { name: '肌着(上)', cat: '衣類', qty: 3 });
    Model.addItem(s2, { name: 'タオル', cat: '衣類', qty: 2, note: '青のストライプ' });
    Model.addItem(s2, { name: '紙パンツ', cat: '排泄用品', consumable: true, qty: 8 });
    Model.addItem(s2, { name: '杖', cat: '身の回り', note: '黒・T字', photos: [await fakePhoto('杖', '#d1d5db')] });
    Model.addItem(s2, { name: '補聴器', cat: '身の回り', note: '右耳のみ' });
    Object.assign(s2, { status: 'checkout', checkInBy: '田中', checkInAt: Date.now() - 3 * 864e5 });
    Object.assign(s2.items[0], { outQty: 2, outChecked: true });
    Object.assign(s2.items[2], { outQty: 1, outChecked: true });
    Object.assign(s2.items[3], { outQty: 2, outChecked: true });

    // 鈴木: 前回が完了済み（申し送りあり）→ 今回はひな形から入所チェック中
    const s3 = Object.assign(Model.newStay(suzuki.id, { dateIn: day(-20), dateOut: day(-17) }), { id: 's_demo3' });
    Model.addItem(s3, { name: 'パジャマ(上)', cat: '衣類', qty: 2, photos: [await fakePhoto('パジャマ', '#f9a8d4')] });
    Model.addItem(s3, { name: '靴下', cat: '衣類', qty: 3 });
    Model.addItem(s3, { name: '歯ブラシ', cat: '洗面・口腔' });
    s3.items.forEach((it) => { it.outQty = it.qty; it.outChecked = true; });
    s3.items[1].outQty = 2;
    Object.assign(s3, { status: 'done', checkInBy: '高橋', checkInAt: Date.now() - 20 * 864e5, checkOutBy: '高橋', checkOutAt: Date.now() - 17 * 864e5 });
    suzuki.notes.push({ id: 'n_demo1', text: '靴下：入所時3 → 退所時2（1点不足）。後日洗濯場で発見、預かり中。次回返却する。', stayId: s3.id, createdAt: Date.now() - 17 * 864e5, resolvedAt: null });
    const s4 = Object.assign(Model.newStay(suzuki.id, { dateIn: day(0), dateOut: day(3), prev: s3 }), { id: 's_demo4' });

    for (const r of [yamada, sato, suzuki]) await DB.put('residents', r);
    for (const s of [s1, s2, s3, s4]) await DB.put('stays', s);
    await DB.setMeta('staff', ['田中', '高橋']);
  }

  // ---- 自己テスト ----
  async function selftest() {
    const log = [];
    let fail = 0;
    const eq = (label, got, want) => {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) fail++;
      log.push((ok ? 'OK  ' : 'NG  ') + label + (ok ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
    };
    try {
      const r = Model.newResident('テスト 太郎');
      await DB.put('residents', r);
      const s1 = Model.newStay(r.id, { dateIn: '2026-09-01', dateOut: '2026-09-04' });
      Model.addItem(s1, { name: '上着', cat: '衣類' });
      Model.addItem(s1, { name: '上着', cat: '衣類' });
      Model.addItem(s1, { name: '内服薬', cat: '薬・医療', consumable: true, qty: 9 });
      Model.addItem(s1, { name: '眼鏡', cat: '身の回り' });
      eq('同じ品は個数が増える', s1.items[0].qty, 2);
      eq('品目数', Model.summary(s1).kinds, 3);
      eq('合計点数', Model.summary(s1).total, 12);
      eq('退所前は全て未確認', Model.summary(s1).unchecked.length, 3);

      Object.assign(s1.items[0], { outQty: 1, outChecked: true });
      Object.assign(s1.items[1], { outQty: 0, outChecked: true });
      eq('衣類の減りは不足', Model.outState(s1.items[0]), 'short');
      eq('消耗品の減りは消費', Model.outState(s1.items[1]), 'consumed');
      eq('未確認', Model.outState(s1.items[2]), 'unchecked');
      eq('問題の行数（不足1＋未確認1）', Model.problemLines(s1).length, 2);
      Object.assign(s1.items[2], { outQty: 2, outChecked: true });
      eq('増えていたら over', Model.outState(s1.items[2]), 'over');

      s1.status = 'done';
      await DB.put('stays', s1);
      const back = Model.normalizeStay(await DB.get('stays', s1.id));
      eq('保存して読み戻せる', back.items.map((i) => [i.name, i.qty, i.outQty]), [['上着', 2, 1], ['内服薬', 9, 0], ['眼鏡', 1, 2]]);
      eq('利用者から滞在を引ける', (await DB.staysByResident(r.id)).length, 1);

      const s2 = Model.newStay(r.id, { prev: back });
      eq('ひな形は同じ品数', s2.items.length, 3);
      eq('ひな形は入所未確認から', s2.items.every((i) => !i.inChecked && !i.outChecked && i.outQty === null), true);
      eq('ひな形は消耗品フラグを引き継ぐ', s2.items[1].consumable, true);
      Model.addItem(s2, { name: '上着', cat: '衣類' });
      eq('ひな形の品は最初のタップで確認のみ', [s2.items[0].qty, s2.items[0].inChecked], [2, true]);
      Model.addItem(s2, { name: '上着', cat: '衣類' });
      eq('2回目のタップで＋1', s2.items[0].qty, 3);

      eq('古いデータの補完', Model.normalizeStay({ id: 'x', items: [{ name: 'a' }] }).items[0], { name: 'a', photos: [], qty: 1, outQty: null, note: '', outNote: '', cat: 'その他' });
      eq('グループ順はマスタ順', Model.groupItems(s1.items, ['身の回り', '衣類']).map((g) => g.cat), ['身の回り', '衣類', '薬・医療']);

      const ref = await fakePhoto('t', '#ccc');
      s2.photos.push(ref);
      await DB.put('stays', s2);
      await DB.dropPhotosIfUnused([ref.id]);
      eq('使用中の写真は消えない', !!(await DB.get('photos', ref.id)), true);
      s2.photos = [];
      await DB.put('stays', s2);
      await DB.dropPhotosIfUnused([ref.id]);
      eq('未使用の写真は消える', !!(await DB.get('photos', ref.id)), false);

      const dump = await window.Backup.exportData();
      eq('バックアップの件数', [dump.residents.length, dump.stays.length], [1, 2]);
      await DB.clear('stays');
      await window.Backup.importData(JSON.parse(JSON.stringify(dump)));
      eq('復元で戻る', (await DB.getAll('stays')).length, 2);
      const m = await window.Master.load();
      eq('マスタに消耗品フラグ', m.items.find((i) => i.name === '内服薬').consumable, true);
    } catch (e) {
      fail++;
      log.push('例外: ' + (e && e.stack || e));
    }
    log.unshift('SELFTEST ' + (fail ? 'FAIL(' + fail + ')' : 'PASS') + '  ' + log.length + '項目');
    document.body.appendChild(h('pre', { id: 'selftest' }, log.join('\n')));
  }

  App.beforeStart = async function () {
    if (/[?&]selftest/.test(qs)) {
      DB.name = 'mochimono_selftest';
      await dropDb(DB.name);
      await selftest();
    } else if (/[?&]demo/.test(qs)) {
      DB.name = 'mochimono_demo';
      await dropDb(DB.name);
      await seed();
      document.title = '【デモ】' + document.title;
    }
  };

  App.registerSettings({
    order: 90, title: '開発用（本番では外す）',
    render: async function (box) {
      box.appendChild(h('p', { class: 'sub' }, '保存領域：' + DB.name));
      box.appendChild(h('div', { class: 'toolrow flush' },
        h('button', {
          class: 'btn', onclick: async () => {
            if (!(await U.confirm('サンプルの利用者3名と記録4件を、今のデータに追加しますか？', { okLabel: '追加' }))) return;
            await seed();
            U.toast('サンプルを入れました');
            App.go('#/home');
          }
        }, 'サンプルデータを入れる'),
        h('button', {
          class: 'btn danger', onclick: async () => {
            if (!(await U.confirm('利用者・記録・写真・設定を全て削除します。元に戻せません。', { okLabel: '次へ', danger: true }))) return;
            if (!(await U.confirm('本当に全て削除しますか？（先にバックアップを保存してください）', { okLabel: '全て削除する', danger: true }))) return;
            for (const s of ['residents', 'stays', 'photos', 'meta']) await DB.clear(s);
            U.toast('全て削除しました');
            App.go('#/home');
          }
        }, '全データ削除')));
    }
  });
})();
