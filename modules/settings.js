// 設定: 品目マスタ / 確認者名 / バックアップ。window.Backup も公開。
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, App = window.App, Master = window.Master;

  App.registerTab({ order: 40, label: '設定', icon: '⚙', hash: '#/settings', match: ['settings'] });

  App.registerScreen('settings', async function (params, root) {
    root.appendChild(h('header', { class: 'topbar' }, h('h1', null, '設定')));
    for (const sec of App.settings) {
      const box = h('details', { class: 'card setsec', open: sec.open });
      box.appendChild(h('summary', null, sec.title));
      const inner = h('div', { class: 'setsec-body' });
      box.appendChild(inner);
      await sec.render(inner);
      root.appendChild(box);
    }
  });

  // ---- バックアップ ----
  const Backup = {};
  Backup.exportData = async function () {
    return {
      app: 'mochimono-check', format: 1, exportedAt: new Date().toISOString(),
      residents: await DB.getAll('residents'), stays: await DB.getAll('stays'),
      photos: await DB.getAll('photos'),
      meta: (await DB.getAll('meta')).filter((m) => m.key.indexOf('secret.') !== 0) // APIキー等はファイルに出さない
    };
  };
  Backup.importData = async function (data) {
    if (!data || data.app !== 'mochimono-check') throw new Error('このアプリのバックアップファイルではありません');
    for (const store of ['residents', 'stays', 'photos', 'meta']) {
      for (const rec of (data[store] || [])) await DB.put(store, rec);
    }
  };
  window.Backup = Backup;

  App.registerSettings({
    order: 10, title: 'バックアップ（保存と復元）', open: true,
    render: async function (box) {
      const last = await DB.getMeta('lastBackupAt', null);
      box.appendChild(h('p', { class: 'sub' },
        'データはこの端末のこのブラウザの中だけに保存されます。ブラウザのデータ消去や端末の故障で失われるため、定期的にファイルへ保存してください。'));
      box.appendChild(h('p', { class: last ? 'sub' : 'sub bad-text' }, '最後の保存：' + (last ? U.fmtDateTime(last) : 'まだ一度も保存していません')));
      const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          const ok = await U.confirm('ファイルの内容（利用者 ' + (data.residents || []).length + '名・記録 ' + (data.stays || []).length + '件）を取り込みます。同じ記録は、ファイルの内容で上書きされます。', { okLabel: '取り込む' });
          if (!ok) return;
          await Backup.importData(data);
          U.toast('取り込みました');
          App.refresh();
        } catch (e) { U.toast('取り込めませんでした: ' + e.message, true); }
      });
      box.appendChild(h('div', { class: 'toolrow flush' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            const data = await Backup.exportData();
            U.download('mochimono-backup-' + U.today().replace(/-/g, '') + '.json', JSON.stringify(data));
            await DB.setMeta('lastBackupAt', Date.now());
            App.refresh();
          }
        }, 'ファイルに保存'),
        h('button', { class: 'btn', onclick: () => file.click() }, 'ファイルから復元'), file));
    }
  });

  // ---- 品目マスタ ----
  App.registerSettings({
    order: 20, title: '品目の一覧（タップで足せる品名）',
    render: async function (box) {
      const m = await Master.load();
      const keepOpen = () => { const s = App.settings.find((x) => x.order === 20); s.open = true; };
      const commit = async () => { await Master.save(m); keepOpen(); App.refresh(); };

      m.cats.forEach((c, ci) => {
        const items = m.items.filter((it) => it.catId === c.id);
        const addIn = h('input', { class: 'input grow', type: 'text', placeholder: c.name + ' に品名を追加' });
        const add = () => {
          const name = addIn.value.trim();
          if (!name) return;
          m.items.push({ id: U.uid('m'), catId: c.id, name: name, consumable: false });
          commit();
        };
        addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        box.appendChild(h('div', { class: 'mcat' },
          h('div', { class: 'mcat-head' },
            h('input', {
              class: 'input mcat-name', type: 'text', value: c.name,
              onchange: (e) => { const v = e.target.value.trim(); if (v) { c.name = v; commit(); } }
            }),
            h('button', { class: 'btn small', disabled: ci === 0, onclick: () => { m.cats.splice(ci - 1, 0, m.cats.splice(ci, 1)[0]); commit(); } }, '↑'),
            h('button', { class: 'btn small', disabled: ci === m.cats.length - 1, onclick: () => { m.cats.splice(ci + 1, 0, m.cats.splice(ci, 1)[0]); commit(); } }, '↓'),
            h('button', {
              class: 'btn small danger', onclick: async () => {
                const ok = await U.confirm('カテゴリ「' + c.name + '」' + (items.length ? 'と、その中の品名 ' + items.length + ' 件' : '') + 'を一覧から削除しますか？（記録済みの持参品には影響しません）', { okLabel: '削除', danger: true });
                if (!ok) return;
                m.items = m.items.filter((it) => it.catId !== c.id);
                m.cats.splice(ci, 1);
                commit();
              }
            }, '削除')),
          items.map((it) => h('div', { class: 'mitem' },
            h('input', {
              class: 'input grow', type: 'text', value: it.name,
              onchange: (e) => { const v = e.target.value.trim(); if (v) { it.name = v; commit(); } }
            }),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.consumable, onchange: (e) => { it.consumable = e.target.checked; commit(); } }), ' 消耗品'),
            h('button', { class: 'btn small', onclick: () => { m.items.splice(m.items.indexOf(it), 1); commit(); } }, '×'))),
          h('div', { class: 'mitem' }, addIn, h('button', { class: 'btn small', onclick: add }, '追加'))));
      });

      const catIn = h('input', { class: 'input grow', type: 'text', placeholder: '新しいカテゴリ名' });
      box.appendChild(h('div', { class: 'toolrow flush' }, catIn,
        h('button', {
          class: 'btn', onclick: () => {
            const v = catIn.value.trim();
            if (!v) return;
            m.cats.push({ id: U.uid('c'), name: v });
            commit();
          }
        }, 'カテゴリを追加'),
        h('button', {
          class: 'btn danger', onclick: async () => {
            if (!(await U.confirm('品目の一覧を初期状態に戻しますか？（記録済みの持参品には影響しません）', { okLabel: '初期状態に戻す', danger: true }))) return;
            await DB.del('meta', 'master');
            keepOpen();
            App.refresh();
          }
        }, '初期状態に戻す')));
    }
  });

  // ---- 確認者名 ----
  App.registerSettings({
    order: 30, title: '確認者（職員名の候補）',
    render: async function (box) {
      const staff = await DB.getMeta('staff', []);
      const keepOpen = () => { App.settings.find((x) => x.order === 30).open = true; };
      const input = h('input', { class: 'input grow', type: 'text', placeholder: '職員名を追加' });
      const add = async () => {
        const v = input.value.trim();
        if (!v || staff.indexOf(v) >= 0) return;
        staff.push(v);
        await DB.setMeta('staff', staff);
        keepOpen();
        App.refresh();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      box.appendChild(h('p', { class: 'sub' }, 'チェック完了時に入力した名前は自動でここに加わります。'));
      box.appendChild(h('div', { class: 'chips' }, staff.map((s) => h('span', { class: 'chip item' }, s,
        h('button', {
          class: 'chip-x', onclick: async () => {
            staff.splice(staff.indexOf(s), 1);
            await DB.setMeta('staff', staff);
            keepOpen();
            App.refresh();
          }
        }, '×')))));
      box.appendChild(h('div', { class: 'toolrow flush' }, input, h('button', { class: 'btn', onclick: add }, '追加')));
    }
  });
})();
