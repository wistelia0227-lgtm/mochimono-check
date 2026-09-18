// 利用者の一覧と詳細（履歴・申し送り）
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model, App = window.App;
  let filter = '';

  App.registerTab({ order: 20, label: '利用者', icon: '👤', hash: '#/residents', match: ['residents', 'resident'] });

  App.registerScreen('residents', async function (params, root) {
    const all = (await DB.getAll('residents')).map(Model.normalizeResident)
      .sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'));
    const stays = await DB.getAll('stays');
    const count = {};
    stays.forEach((s) => { count[s.residentId] = (count[s.residentId] || 0) + 1; });

    root.appendChild(h('header', { class: 'topbar' }, h('h1', null, '利用者')));
    const list = h('div');
    const draw = () => {
      list.innerHTML = '';
      const q = filter.trim();
      const hit = all.filter((r) => !q || (r.name + r.kana + r.room).indexOf(q) >= 0);
      const shown = hit.filter((r) => !r.archived), hidden = hit.filter((r) => r.archived);
      if (!shown.length) list.appendChild(h('div', { class: 'empty' }, q ? '該当する利用者がいません。' : '利用者はまだ登録されていません。'));
      const card = (r) => h('a', { class: 'card stay-card', href: '#/resident/' + r.id },
        h('div', { class: 'stay-card-main' },
          h('div', { class: 'name' }, r.name + ' 様'),
          h('div', { class: 'sub' }, [r.kana, r.room, '利用 ' + (count[r.id] || 0) + '回'].filter(Boolean).join('　'))),
        r.notes.some((n) => !n.resolvedAt) ? h('span', { class: 'tag warn' }, '申し送りあり') : null);
      shown.forEach((r) => list.appendChild(card(r)));
      if (hidden.length) list.appendChild(h('details', { class: 'done-list' },
        h('summary', null, '利用終了（' + hidden.length + '）'), hidden.map(card)));
    };
    root.appendChild(h('div', { class: 'toolrow' },
      h('input', { class: 'input grow', type: 'search', placeholder: '氏名・ふりがな・部屋で絞り込み', value: filter, oninput: (e) => { filter = e.target.value; draw(); } }),
      h('button', {
        class: 'btn primary', onclick: async () => {
          const r = Model.newResident('');
          editDialog(r, true);
        }
      }, '＋ 登録')));
    root.appendChild(list);
    draw();
  });

  function editDialog(r, isNew) {
    let close;
    const name = h('input', { class: 'input', type: 'text', value: r.name, placeholder: '山田 ハナ' });
    const kana = h('input', { class: 'input', type: 'text', value: r.kana, placeholder: 'やまだ はな' });
    const room = h('input', { class: 'input', type: 'text', value: r.room, placeholder: '例：2階 きく' });
    const note = h('textarea', { class: 'input', rows: '3', placeholder: '持ち物に関する注意（例：義歯は夜間預かり）' }, r.note);
    const body = h('div', null,
      h('h2', null, isNew ? '利用者を登録' : '利用者情報を編集'),
      h('label', { class: 'field' }, '氏名', name),
      h('label', { class: 'field' }, 'ふりがな（並び順に使います）', kana),
      h('label', { class: 'field' }, '部屋・ユニット', room),
      h('label', { class: 'field' }, '備考', note),
      h('div', { class: 'modal-btns' },
        h('button', { class: 'btn', onclick: () => close() }, 'やめる'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            if (!name.value.trim()) { U.toast('氏名を入れてください', true); return; }
            r.name = name.value.trim(); r.kana = kana.value.trim(); r.room = room.value.trim(); r.note = note.value.trim();
            await DB.put('residents', r);
            close();
            if (isNew) App.go('#/resident/' + r.id); else App.refresh();
          }
        }, '保存')));
    close = U.modal(body);
  }

  App.registerScreen('resident', async function (params, root) {
    const r = await DB.get('residents', params[0]);
    if (!r) { root.appendChild(h('div', { class: 'card' }, '利用者が見つかりません。', h('a', { href: '#/residents' }, '戻る'))); return; }
    Model.normalizeResident(r);
    const stays = (await DB.staysByResident(r.id)).map(Model.normalizeStay)
      .sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || ''));

    root.appendChild(h('header', { class: 'topbar' },
      h('a', { class: 'back', href: '#/residents' }, '‹ 利用者'),
      h('div', { class: 'topbar-title' }, h('h1', null, r.name + ' 様'),
        h('div', { class: 'sub' }, [r.kana, r.room].filter(Boolean).join('　'))),
      r.archived ? h('span', { class: 'badge st-done' }, '利用終了') : null));
    root.appendChild(h('div', { class: 'toolrow' },
      h('button', { class: 'btn primary', onclick: () => App.startStayDialog(r.id), disabled: r.archived }, '＋ 入所チェックを始める'),
      h('button', { class: 'btn', onclick: () => editDialog(r, false) }, '編集')));
    if (r.note) root.appendChild(h('div', { class: 'card memo' }, '備考：' + r.note));

    // 申し送り
    const noteIn = h('input', { class: 'input grow', type: 'text', placeholder: '申し送りを追加（例：次回、預かり中の靴下1足を返却）' });
    const addNote = async () => {
      const t = noteIn.value.trim();
      if (!t) return;
      r.notes.push({ id: U.uid('n'), text: t, stayId: null, createdAt: Date.now(), resolvedAt: null });
      await DB.put('residents', r);
      App.refresh();
    };
    const notes = r.notes.slice().sort((a, b) => b.createdAt - a.createdAt);
    root.appendChild(h('h2', { class: 'sec' }, '申し送り'));
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'toolrow flush' }, noteIn, h('button', { class: 'btn', onclick: addNote }, '追加')),
      notes.length ? notes.map((n) => h('div', { class: 'note-row' + (n.resolvedAt ? ' resolved' : '') },
        h('div', { class: 'note-text' }, n.text,
          h('div', { class: 'sub' }, U.fmtDateTime(n.createdAt) + (n.resolvedAt ? '　→ 対応済み ' + U.fmtDateTime(n.resolvedAt) : ''))),
        h('button', {
          class: 'btn small', onclick: async () => {
            n.resolvedAt = n.resolvedAt ? null : Date.now();
            await DB.put('residents', r);
            App.refresh();
          }
        }, n.resolvedAt ? '未対応に戻す' : '対応済み'))) : h('div', { class: 'sub' }, '申し送りはありません。')));

    // 履歴
    root.appendChild(h('h2', { class: 'sec' }, '利用の履歴（' + stays.length + '回）'));
    if (!stays.length) root.appendChild(h('div', { class: 'empty' }, 'まだ記録がありません。'));
    stays.forEach((st) => {
      const s = Model.summary(st), status = Model.STATUS[st.status];
      root.appendChild(h('a', { class: 'card stay-card', href: '#/stay/' + st.id },
        h('div', { class: 'stay-card-main' },
          h('div', { class: 'name' }, U.fmtRange(st.dateIn, st.dateOut)),
          h('div', { class: 'sub' }, s.kinds + '品目・' + s.total + '点' +
            (st.status === 'done' ? (s.problems ? '／不一致 ' + s.problems + '件' : '／全て一致') : ''))),
        h('span', { class: 'badge ' + status.cls }, status.label)));
    });

    // 利用終了・削除
    root.appendChild(h('div', { class: 'toolrow foot' },
      h('button', {
        class: 'btn small', onclick: async () => {
          r.archived = !r.archived;
          await DB.put('residents', r);
          App.refresh();
        }
      }, r.archived ? '利用中に戻す' : '利用終了にする（一覧から隠す）'),
      h('button', {
        class: 'btn small danger', onclick: async () => {
          if (stays.length) {
            await U.confirm('この方には ' + stays.length + ' 回分の記録があるため削除できません。一覧から隠すには「利用終了にする」を使ってください。', { okLabel: 'わかった', cancelLabel: '閉じる' });
            return;
          }
          if (!(await U.confirm('「' + r.name + '」様を削除しますか？', { okLabel: '削除', danger: true }))) return;
          await DB.del('residents', r.id);
          App.go('#/residents');
        }
      }, '削除')));
  });
})();
