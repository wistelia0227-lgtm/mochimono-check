// 確認票の印刷（家族へ渡す控え・施設の保管用）
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model, App = window.App;
  let withPhotos = true;

  App.registerScreen('print', async function (params, root) {
    const stay = await DB.get('stays', params[0]);
    if (!stay) { root.appendChild(h('div', { class: 'card' }, '記録が見つかりません。')); return; }
    Model.normalizeStay(stay);
    const r = (await DB.get('residents', stay.residentId)) || { name: '' };
    const master = await window.Master.load();
    const facility = await DB.getMeta('facilityName', '');
    const showOut = stay.status === 'checkout' || stay.status === 'done';

    root.appendChild(h('div', { class: 'toolrow no-print' },
      h('a', { class: 'btn', href: '#/stay/' + stay.id }, '‹ 戻る'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: withPhotos, onchange: (e) => { withPhotos = e.target.checked; App.refresh(); } }), ' 写真を入れる'),
      h('input', {
        class: 'input grow', type: 'text', placeholder: '施設名（票の右上に入ります）', value: facility,
        onchange: async (e) => { await DB.setMeta('facilityName', e.target.value.trim()); App.refresh(); }
      }),
      h('button', { class: 'btn primary', onclick: () => window.print() }, '🖨 印刷する')));

    const sheet = h('div', { class: 'sheet' });
    sheet.appendChild(h('div', { class: 'sheet-head' },
      h('h1', null, '持参品確認票'),
      h('div', { class: 'sheet-fac' }, facility)));
    sheet.appendChild(h('table', { class: 'sheet-meta' }, h('tbody', null,
      h('tr', null, h('th', null, 'ご利用者'), h('td', null, r.name + ' 様'),
        h('th', null, 'ご利用期間'), h('td', null, U.fmtRange(stay.dateIn, stay.dateOut))))));

    if (withPhotos && stay.photos.length) {
      sheet.appendChild(h('div', { class: 'sheet-photos' }, stay.photos.map((p) => h('img', { src: p.thumb }))));
    }

    const head = h('tr', null,
      withPhotos ? h('th', { class: 'c-photo' }, '写真') : null,
      h('th', null, '品名'), h('th', null, '特徴・メモ'),
      h('th', { class: 'c-num' }, '入所時'), h('th', { class: 'c-num' }, '退所時'), h('th', { class: 'c-num' }, '確認'));
    const body = h('tbody');
    Model.groupItems(stay.items, window.Master.catOrder(master)).forEach((g) => {
      body.appendChild(h('tr', { class: 'grp' }, h('td', { colspan: withPhotos ? '6' : '5' }, g.cat)));
      g.items.forEach((it) => {
        const state = Model.outState(it);
        const mark = { ok: '✓', consumed: '消費', short: '不足', over: '多', unchecked: '' }[state];
        body.appendChild(h('tr', null,
          withPhotos ? h('td', { class: 'c-photo' }, it.photos.length ? h('img', { src: it.photos[0].thumb }) : null) : null,
          h('td', null, it.name + (it.mid ? '（途中追加）' : '')),
          h('td', null, [it.note, it.outNote].filter(Boolean).join(' ／ ')),
          h('td', { class: 'c-num' }, String(it.qty)),
          h('td', { class: 'c-num' }, showOut && it.outQty != null ? String(it.outQty) : ''),
          h('td', { class: 'c-num' }, showOut ? mark : '')));
      });
    });
    sheet.appendChild(h('table', { class: 'sheet-items' }, h('thead', null, head), body));

    const lines = showOut ? Model.problemLines(stay) : [];
    if (lines.length) sheet.appendChild(h('div', { class: 'sheet-note' }, h('b', null, '確認事項'), lines.map((l) => h('div', null, '・' + l))));
    if (stay.memo) sheet.appendChild(h('div', { class: 'sheet-note' }, h('b', null, 'メモ'), h('div', null, stay.memo)));
    if (window.Outfit) { const ob = window.Outfit.printBlock(stay); if (ob) sheet.appendChild(ob); }

    sheet.appendChild(h('table', { class: 'sheet-sign' }, h('tbody', null,
      h('tr', null, h('th', null, '入所時 確認者'), h('td', null, (stay.checkInBy || '') + '　' + U.fmtDateTime(stay.checkInAt)),
        h('th', null, 'ご家族様 確認'), h('td', null, '')),
      h('tr', null, h('th', null, '退所時 確認者'), h('td', null, (stay.checkOutBy || '') + '　' + U.fmtDateTime(stay.checkOutAt)),
        h('th', null, 'ご家族様 確認'), h('td', null, '')))));
    root.appendChild(sheet);
  });
})();
