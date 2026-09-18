// 画面の切り替えと一覧(ホーム)。window.App で公開。
// 各モジュールは App.registerScreen / registerTab / registerSettings で自分を登録する。
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model;
  const App = { screens: {}, tabs: [], settings: [] };
  let token = 0, lastRoute = '';

  App.registerScreen = (name, fn) => { App.screens[name] = fn; };
  App.registerTab = (tab) => { App.tabs.push(tab); App.tabs.sort((a, b) => a.order - b.order); };
  App.registerSettings = (sec) => { App.settings.push(sec); App.settings.sort((a, b) => a.order - b.order); };

  App.go = function (hash) {
    if (location.hash === hash) App.refresh(); else location.hash = hash;
  };
  App.refresh = () => render(true);

  function parse() {
    const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/').filter(Boolean);
    return { name: parts[0] || 'home', params: parts.slice(1).map(decodeURIComponent) };
  }

  async function render(keepScroll) {
    const my = ++token;
    const route = parse();
    const screen = App.screens[route.name] || App.screens.home;
    const y = (keepScroll && lastRoute === location.hash) ? window.scrollY : 0;
    const box = h('div', { class: 'screen screen-' + route.name });
    try {
      await screen(route.params, box);
    } catch (e) {
      box.appendChild(h('div', { class: 'card bad' }, '画面を表示できませんでした: ' + (e && e.message || e)));
      U.showError(e && e.message || String(e));
    }
    if (my !== token) return; // 後から来た描画が勝つ
    const root = document.getElementById('root');
    root.innerHTML = '';
    root.appendChild(box);
    lastRoute = location.hash;
    window.scrollTo(0, y);
    renderTabs(route.name);
  }

  function renderTabs(current) {
    const bar = document.getElementById('tabbar');
    bar.innerHTML = '';
    App.tabs.forEach((t) => {
      const on = t.match.indexOf(current) >= 0;
      bar.appendChild(h('a', { href: t.hash, class: 'tab' + (on ? ' on' : '') },
        h('span', { class: 'tab-icon' }, t.icon), h('span', null, t.label)));
    });
  }

  // ---- 入所チェックを始める ----
  App.startStayDialog = async function (presetResidentId) {
    const residents = (await DB.getAll('residents')).map(Model.normalizeResident)
      .filter((r) => !r.archived).sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'));
    let close;
    const sel = h('select', { class: 'input', value: presetResidentId || (residents.length ? residents[0].id : '__new') },
      residents.map((r) => h('option', { value: r.id }, r.name + (r.room ? '（' + r.room + '）' : ''))),
      h('option', { value: '__new' }, '＋ 新しい利用者を登録'));
    const nameIn = h('input', { class: 'input', type: 'text', placeholder: '氏名（例：山田 ハナ）' });
    const nameRow = h('label', { class: 'field' }, '新しい利用者の氏名', nameIn);
    const dIn = h('input', { class: 'input', type: 'date', value: U.today() });
    const dOut = h('input', { class: 'input', type: 'date' });
    const copy = h('input', { type: 'checkbox', checked: true });
    const sync = () => { nameRow.hidden = sel.value !== '__new'; };
    sel.addEventListener('change', sync);

    const submit = async () => {
      let rid = sel.value;
      if (rid === '__new') {
        const name = nameIn.value.trim();
        if (!name) { U.toast('氏名を入れてください', true); return; }
        const r = Model.newResident(name);
        await DB.put('residents', r);
        rid = r.id;
      }
      const stays = (await DB.staysByResident(rid)).map(Model.normalizeStay);
      const open = stays.find((s) => s.status !== 'done');
      if (open) {
        close();
        U.toast('この方は進行中の記録があります。そちらを開きます');
        App.go('#/stay/' + open.id);
        return;
      }
      const prev = stays.filter((s) => s.items.length).sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || ''))[0];
      const st = Model.newStay(rid, { dateIn: dIn.value || U.today(), dateOut: dOut.value, prev: copy.checked ? prev : null });
      await DB.put('stays', st);
      close();
      App.go('#/stay/' + st.id);
    };

    const body = h('div', null,
      h('h2', null, '入所チェックを始める'),
      h('label', { class: 'field' }, '利用者', sel),
      nameRow,
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, '入所日', dIn),
        h('label', { class: 'field' }, '退所予定日', dOut)),
      h('label', { class: 'check' }, copy, ' 前回の持参品をひな形にする（あれば）'),
      h('div', { class: 'modal-btns' },
        h('button', { class: 'btn', onclick: () => close() }, 'やめる'),
        h('button', { class: 'btn primary', onclick: submit }, '始める')));
    close = U.modal(body);
    sync();
  };

  // ---- ホーム: 進行中の一覧 ----
  function stayCard(st, resident) {
    const s = Model.summary(st);
    const status = Model.STATUS[st.status];
    const today = U.today();
    const tags = [];
    if (st.status !== 'done' && st.dateOut) {
      if (st.dateOut === today) tags.push(h('span', { class: 'tag warn' }, '本日退所'));
      else if (st.dateOut < today) tags.push(h('span', { class: 'tag bad' }, '退所予定日を過ぎています'));
    }
    const openNotes = resident ? resident.notes.filter((n) => !n.resolvedAt).length : 0;
    if (openNotes && st.status !== 'done') tags.push(h('span', { class: 'tag warn' }, '申し送り ' + openNotes + '件'));
    let progress = s.kinds + '品目・' + s.total + '点';
    if (st.status === 'checkin' && s.inUnchecked) progress += '／未確認 ' + s.inUnchecked;
    if (st.status === 'checkout') progress += '／退所確認 ' + s.outDone + '/' + s.kinds;
    if (st.status === 'done') progress += s.problems ? '／不一致 ' + s.problems + '件' : '／全て一致';
    return h('a', { class: 'card stay-card', href: '#/stay/' + st.id },
      h('div', { class: 'stay-card-main' },
        h('div', { class: 'name' }, (resident ? resident.name : '（削除された利用者）') + ' 様'),
        h('div', { class: 'sub' }, U.fmtRange(st.dateIn, st.dateOut) + '　' + progress),
        tags.length ? h('div', { class: 'tags' }, tags) : null),
      h('span', { class: 'badge ' + status.cls }, status.label));
  }

  App.registerScreen('home', async function (params, root) {
    const stays = (await DB.getAll('stays')).map(Model.normalizeStay);
    const residents = {};
    (await DB.getAll('residents')).forEach((r) => { residents[r.id] = Model.normalizeResident(r); });
    const active = stays.filter((s) => s.status !== 'done')
      .sort((a, b) => (a.dateOut || '9999').localeCompare(b.dateOut || '9999'));
    const done = stays.filter((s) => s.status === 'done')
      .sort((a, b) => (b.checkOutAt || 0) - (a.checkOutAt || 0)).slice(0, 20);

    root.appendChild(h('header', { class: 'topbar' }, h('h1', null, '持参品チェック')));
    root.appendChild(h('button', { class: 'btn primary big', onclick: () => App.startStayDialog() }, '＋ 入所チェックを始める'));

    root.appendChild(h('h2', { class: 'sec' }, '進行中（' + active.length + '）'));
    if (!active.length) root.appendChild(h('div', { class: 'empty' }, '進行中の記録はありません。上のボタンから始めます。'));
    active.forEach((st) => root.appendChild(stayCard(st, residents[st.residentId])));

    if (done.length) {
      root.appendChild(h('details', { class: 'done-list' },
        h('summary', null, '完了した記録（新しい順 ' + done.length + '件）'),
        done.map((st) => stayCard(st, residents[st.residentId]))));
    }
  });

  App.registerTab({ order: 10, label: '一覧', icon: '🧳', hash: '#/home', match: ['home', 'stay', 'print'] });

  App.start = function () {
    window.addEventListener('hashchange', () => render(false));
    const boot = () => (App.beforeStart ? App.beforeStart() : Promise.resolve()).then(() => render(false));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  };

  window.App = App;
})();
