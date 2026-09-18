// 持ち物検索: 落とし物が誰の物かを、品名・特徴メモ・写真から探す
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model, App = window.App;
  const state = { q: '', scope: 'active' };

  App.registerTab({ order: 30, label: '持ち物検索', icon: '🔍', hash: '#/search', match: ['search'] });

  App.registerScreen('search', async function (params, root) {
    const stays = (await DB.getAll('stays')).map(Model.normalizeStay);
    const residents = {};
    (await DB.getAll('residents')).forEach((r) => { residents[r.id] = r; });

    root.appendChild(h('header', { class: 'topbar' }, h('h1', null, '持ち物検索')));
    const out = h('div', { class: 'search-grid' });
    const info = h('div', { class: 'sub' });

    const draw = () => {
      out.innerHTML = '';
      const words = state.q.trim().split(/\s+/).filter(Boolean);
      const rows = [];
      stays.forEach((st) => {
        if (state.scope === 'active' && st.status === 'done') return;
        const r = residents[st.residentId];
        st.items.forEach((it) => {
          const text = it.name + ' ' + it.cat + ' ' + it.note + ' ' + it.outNote;
          if (words.every((w) => text.indexOf(w) >= 0)) rows.push({ st: st, it: it, r: r });
        });
      });
      rows.sort((a, b) => (b.it.photos.length ? 1 : 0) - (a.it.photos.length ? 1 : 0));
      info.textContent = rows.length + '件' + (rows.length > 200 ? '（先頭200件を表示）' : '');
      rows.slice(0, 200).forEach((row) => {
        const it = row.it;
        out.appendChild(h('div', { class: 'card search-card' },
          it.photos.length
            ? h('img', { class: 'thumb lg', src: it.photos[0].thumb, onclick: () => U.viewPhoto(it.photos[0]) })
            : h('div', { class: 'thumb lg none' }, '写真なし'),
          h('a', { class: 'search-info', href: '#/stay/' + row.st.id },
            h('div', { class: 'item-name' }, it.name + ' ×' + it.qty),
            it.note ? h('div', { class: 'sub' }, it.note) : null,
            h('div', { class: 'owner' }, (row.r ? row.r.name : '（削除された利用者）') + ' 様'),
            h('div', { class: 'sub' }, U.fmtRange(row.st.dateIn, row.st.dateOut) + '　' + Model.STATUS[row.st.status].label))));
      });
      if (!rows.length) out.appendChild(h('div', { class: 'empty' }, '該当する持ち物がありません。'));
    };

    root.appendChild(h('div', { class: 'toolrow' },
      h('input', {
        class: 'input grow', type: 'search', value: state.q,
        placeholder: '品名や特徴（例：靴下 青）。空欄なら全件',
        oninput: (e) => { state.q = e.target.value; draw(); }
      }),
      h('select', { class: 'input', value: state.scope, onchange: (e) => { state.scope = e.target.value; draw(); } },
        h('option', { value: 'active' }, '滞在中の方だけ'),
        h('option', { value: 'all' }, '過去の記録も含む'))));
    root.appendChild(info);
    root.appendChild(out);
    draw();
  });
})();
