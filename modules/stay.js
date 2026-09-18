// 滞在画面: 入所チェック → 滞在中 → 退所チェック → 完了
(function () {
  'use strict';
  const U = window.U, h = U.h, DB = window.DB, Model = window.Model, App = window.App;
  const uiState = {}; // 滞在ごとの表示状態（開いているカテゴリなど）。保存しない

  App.registerScreen('stay', async function (params, root) {
    const stay = await DB.get('stays', params[0]);
    if (!stay) {
      root.appendChild(h('div', { class: 'card' }, 'この記録は見つかりません。', h('a', { href: '#/home' }, '一覧へ戻る')));
      return;
    }
    Model.normalizeStay(stay);
    const resident = Model.normalizeResident((await DB.get('residents', stay.residentId)) || { id: null, name: '（削除された利用者）' });
    const master = await window.Master.load();
    const staff = await DB.getMeta('staff', []);
    const ui = uiState[stay.id] = uiState[stay.id] || { cat: master.cats[0] && master.cats[0].id, addOpen: stay.status === 'checkin' };
    const mode = stay.status;
    const editable = mode === 'checkin' || mode === 'staying';

    const save = async () => { stay.updatedAt = Date.now(); await DB.put('stays', stay); App.refresh(); };
    const saveQuiet = async () => { stay.updatedAt = Date.now(); await DB.put('stays', stay); };

    // ---- 見出し ----
    const status = Model.STATUS[mode];
    root.appendChild(h('header', { class: 'topbar' },
      h('a', { class: 'back', href: '#/home' }, '‹ 一覧'),
      h('div', { class: 'topbar-title' },
        h('h1', null, resident.name + ' 様'),
        h('div', { class: 'sub' }, U.fmtRange(stay.dateIn, stay.dateOut))),
      h('span', { class: 'badge ' + status.cls }, status.label)));
    root.appendChild(h('div', { class: 'toolrow no-print' },
      h('button', { class: 'btn small', onclick: () => editStayDialog() }, '日程・メモ'),
      h('a', { class: 'btn small', href: '#/print/' + stay.id }, '🖨 確認票を印刷'),
      resident.id ? h('a', { class: 'btn small', href: '#/resident/' + resident.id }, '利用者情報') : null));

    // ---- 前回からの申し送り ----
    const openNotes = resident.notes.filter((n) => !n.resolvedAt);
    if (openNotes.length && mode !== 'done') {
      root.appendChild(h('div', { class: 'card notebox' },
        h('div', { class: 'notebox-title' }, '⚠ 申し送り（前回の忘れ物など）'),
        openNotes.map((n) => h('div', { class: 'note-row' },
          h('div', { class: 'note-text' }, n.text, h('div', { class: 'sub' }, U.fmtDateTime(n.createdAt))),
          h('button', {
            class: 'btn small', onclick: async () => {
              n.resolvedAt = Date.now();
              await DB.put('residents', resident);
              App.refresh();
            }
          }, '対応済み')))));
    }
    if (stay.memo) root.appendChild(h('div', { class: 'card memo' }, 'メモ：' + stay.memo));

    // ---- 完了時のまとめ ----
    if (mode === 'done') {
      const lines = Model.problemLines(stay);
      root.appendChild(h('div', { class: 'card ' + (lines.length ? 'bad' : 'good') },
        h('div', { class: 'result-title' }, lines.length ? '不一致 ' + lines.length + '件' : '✓ 全ての持参品が一致しました'),
        lines.map((l) => h('div', null, '・' + l)),
        h('div', { class: 'sub' },
          '入所時確認：' + (stay.checkInBy || '—') + ' ' + U.fmtDateTime(stay.checkInAt) +
          '　退所時確認：' + (stay.checkOutBy || '—') + ' ' + U.fmtDateTime(stay.checkOutAt))));
    }

    // ---- 荷物全体の写真 ----
    root.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, '荷物全体の写真'),
      h('div', { class: 'photo-strip' },
        stay.photos.map((p) => h('img', { class: 'thumb lg', src: p.thumb, onclick: () => photoDialog(stay.photos, p, mode !== 'done') })),
        mode !== 'done' ? h('button', {
          class: 'photo-add lg', onclick: async () => {
            const ref = await U.pickPhoto();
            if (ref) { stay.photos.push(ref); save(); }
          }
        }, '📷', h('span', null, '撮る')) : null,
        mode !== 'done' ? h('button', {
          class: 'photo-add lg', onclick: async () => {
            const ref = await U.pickPhoto({ gallery: true });
            if (ref) { stay.photos.push(ref); save(); }
          }
        }, '🖼', h('span', null, '画像から')) : null,
        (!stay.photos.length && mode === 'done') ? h('span', { class: 'sub' }, 'なし') : null),
      (window.PickFrom && editable && stay.photos.length) ? h('button', {
        class: 'btn primary pickbtn',
        onclick: () => window.PickFrom.open(stay, stay.photos[stay.photos.length - 1], () => App.refresh())
      }, '👆 この写真の上で品を囲んで登録する') : null,
      (window.PickFrom && editable && !stay.photos.length) ? h('div', { class: 'sub' }, '荷物を広げて1枚撮ると、写真の上で品を指で囲んで登録できます。') : null));

    // ---- 品を足すパネル ----
    if (editable) root.appendChild(addPanel());

    // ---- 品の一覧 ----
    const groups = Model.groupItems(stay.items, window.Master.catOrder(master));
    if (!stay.items.length) {
      root.appendChild(h('div', { class: 'empty' }, 'まだ品がありません。上の品名をタップして足します。'));
    }
    groups.forEach((g) => {
      root.appendChild(h('h2', { class: 'sec' }, g.cat + '（' + g.items.reduce((n, it) => n + it.qty, 0) + '点）'));
      g.items.forEach((it) => root.appendChild(itemRow(it)));
    });

    // ---- 下のバー ----
    root.appendChild(actionBar());

    // ======== 部品 ========

    function addPanel() {
      const counts = {};
      stay.items.forEach((it) => { counts[it.cat + '\n' + it.name] = it; });
      const cat = master.cats.find((c) => c.id === ui.cat) || master.cats[0];
      const free = h('input', { class: 'input', type: 'text', placeholder: '一覧に無い品名を入力' });
      const addFree = () => {
        const name = free.value.trim();
        if (!name) return;
        Model.addItem(stay, { name: name, cat: cat ? cat.name : 'その他' });
        save();
      };
      free.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFree(); });
      const panel = h('details', { class: 'card addpanel', open: ui.addOpen },
        h('summary', null, mode === 'checkin' ? '＋ 品を足す' : '＋ 途中で持ち込まれた品を足す'),
        h('div', { class: 'chips cats' }, master.cats.map((c) =>
          h('button', { class: 'chip cat' + (cat && c.id === cat.id ? ' on' : ''), onclick: () => { ui.cat = c.id; App.refresh(); } }, c.name))),
        h('div', { class: 'chips' }, master.items.filter((m) => cat && m.catId === cat.id).map((m) => {
          const cur = counts[cat.name + '\n' + m.name];
          return h('button', {
            class: 'chip item' + (cur ? (cur.inChecked ? ' has' : ' pending') : ''),
            onclick: () => { Model.addItem(stay, { name: m.name, cat: cat.name, consumable: m.consumable }); save(); }
          }, m.name, cur ? h('span', { class: 'chip-n' }, cur.inChecked ? '×' + cur.qty : '前回×' + cur.qty) : null);
        })),
        h('div', { class: 'addfree' }, free,
          h('button', { class: 'btn', onclick: addFree }, '足す'),
          h('button', {
            class: 'btn', title: '写真を撮って品として足す', onclick: async () => {
              const ref = await U.pickPhoto();
              if (!ref) return;
              const it = Model.addItem(stay, { name: '（写真の品 ' + (stay.items.length + 1) + '）', cat: cat ? cat.name : 'その他', photos: [ref] });
              await saveQuiet();
              itemDialog(it);
            }
          }, '📷 写真から')));
      panel.addEventListener('toggle', () => { ui.addOpen = panel.open; });
      return panel;
    }

    function stepper(value, onChange, min) {
      return h('div', { class: 'stepper' },
        h('button', { class: 'step', disabled: value <= min, onclick: () => onChange(value - 1) }, '−'),
        h('span', { class: 'step-n' }, String(value)),
        h('button', { class: 'step', onclick: () => onChange(value + 1) }, '＋'));
    }

    function itemRow(it) {
      const state = Model.outState(it);
      const showOut = mode === 'checkout' || mode === 'done';
      let cls = 'item-row';
      if (showOut) cls += ' out-' + state;
      else if (!it.inChecked) cls += ' in-unchecked';

      const photo = it.photos.length
        ? h('img', { class: 'thumb', src: it.photos[0].thumb, onclick: () => photoDialog(it.photos, it.photos[0], mode !== 'done') })
        : (mode !== 'done' ? h('button', {
          class: 'photo-add', onclick: async () => {
            const ref = await U.pickPhoto();
            if (ref) { it.photos.push(ref); save(); }
          }
        }, '📷') : h('div', { class: 'thumb none' }));

      const tags = [];
      if (it.consumable) tags.push(h('span', { class: 'tag' }, '消耗品'));
      if (it.mid) tags.push(h('span', { class: 'tag' }, '途中追加'));
      if (it.photos.length > 1) tags.push(h('span', { class: 'tag' }, '写真' + it.photos.length));
      const info = h('div', { class: 'item-info', onclick: () => itemDialog(it) },
        h('div', { class: 'item-name' }, it.name, showOut ? h('span', { class: 'item-qty' }, ' ×' + it.qty) : null),
        it.note ? h('div', { class: 'sub' }, it.note) : null,
        (showOut && it.outNote) ? h('div', { class: 'sub outnote' }, '退所時：' + it.outNote) : null,
        tags.length ? h('div', { class: 'tags' }, tags) : null);

      let ctl;
      if (mode === 'checkin' || mode === 'staying') {
        ctl = h('div', { class: 'item-ctl' },
          stepper(it.qty, (v) => { it.qty = v; it.inChecked = true; save(); }, 1),
          !it.inChecked ? h('button', { class: 'btn small primary', onclick: () => { it.inChecked = true; save(); } }, '持参あり') : null);
      } else if (mode === 'checkout') {
        const cur = it.outQty == null ? it.qty : it.outQty;
        ctl = h('div', { class: 'item-ctl' },
          stepper(cur, (v) => { it.outQty = v; it.outChecked = true; save(); }, 0),
          h('button', {
            class: 'btn okbtn' + (it.outChecked ? ' on' : ''),
            onclick: () => {
              if (it.outChecked) { it.outChecked = false; it.outQty = null; }
              else { it.outChecked = true; it.outQty = cur; }
              save();
            }
          }, it.outChecked ? '✓ 確認済' : '確認'));
      } else {
        const label = { ok: '一致', consumed: '消費', short: '不足', over: '多い', unchecked: '未確認' }[state];
        ctl = h('div', { class: 'item-ctl' },
          h('span', { class: 'outresult' }, (it.outQty == null ? '—' : it.qty + ' → ' + it.outQty) + '　' + label));
      }
      if (mode === 'checkout' && state !== 'unchecked' && state !== 'ok') {
        const label = { consumed: '消費（消耗品）', short: (it.qty - it.outQty) + '点不足', over: (it.outQty - it.qty) + '点多い' }[state];
        info.appendChild(h('div', { class: 'state-label' }, label));
      }
      return h('div', { class: cls }, photo, info, ctl);
    }

    function staffInput(value, onChange) {
      const listId = 'stafflist';
      return h('span', { class: 'staff' },
        h('input', {
          class: 'input', type: 'text', placeholder: '確認者', value: value || '', list: listId,
          onchange: (e) => onChange(e.target.value.trim())
        }),
        h('datalist', { id: listId }, staff.map((s) => h('option', { value: s }))));
    }
    async function rememberStaff(name) {
      if (name && staff.indexOf(name) < 0) { staff.push(name); await DB.setMeta('staff', staff); }
    }
    const askNoStaff = () => U.confirm('確認者が未入力です。このまま進めますか？', { okLabel: '進める', cancelLabel: '戻って入力' });

    function actionBar() {
      const s = Model.summary(stay);
      const bar = h('div', { class: 'actionbar no-print' });
      if (mode === 'checkin') {
        bar.appendChild(h('div', { class: 'ab-info' }, s.kinds + '品目・' + s.total + '点' + (s.inUnchecked ? '　未確認 ' + s.inUnchecked + '件' : '')));
        bar.appendChild(staffInput(stay.checkInBy, (v) => { stay.checkInBy = v; saveQuiet(); }));
        bar.appendChild(h('button', { class: 'btn primary', onclick: finishCheckIn }, '入所チェック完了'));
      } else if (mode === 'staying') {
        bar.appendChild(h('div', { class: 'ab-info' }, s.kinds + '品目・' + s.total + '点'));
        bar.appendChild(h('button', { class: 'btn', onclick: () => { stay.status = 'checkin'; save(); } }, '入所チェックを直す'));
        bar.appendChild(h('button', { class: 'btn primary', onclick: () => { stay.status = 'checkout'; ui.addOpen = false; save(); } }, '退所チェックを始める'));
      } else if (mode === 'checkout') {
        bar.appendChild(h('div', { class: 'ab-info' }, '確認 ' + s.outDone + ' / ' + s.kinds +
          ((s.short.length + s.over.length) ? '　不一致 ' + (s.short.length + s.over.length) : '')));
        bar.appendChild(staffInput(stay.checkOutBy, (v) => { stay.checkOutBy = v; saveQuiet(); }));
        bar.appendChild(h('button', { class: 'btn', onclick: () => { stay.status = 'staying'; save(); } }, '滞在中に戻す'));
        bar.appendChild(h('button', { class: 'btn primary', onclick: finishCheckOut }, '退所チェック完了'));
      } else {
        bar.appendChild(h('div', { class: 'ab-info' }, '完了 ' + U.fmtDateTime(stay.checkOutAt)));
        bar.appendChild(h('button', { class: 'btn', onclick: () => { stay.status = 'checkout'; save(); } }, '退所チェックをやり直す'));
      }
      return bar;
    }

    async function finishCheckIn() {
      if (!stay.items.length && !stay.photos.length) { U.toast('品か写真を1つ以上入れてください', true); return; }
      if (!stay.checkInBy && !(await askNoStaff())) return;
      const un = stay.items.filter((it) => !it.inChecked);
      if (un.length) {
        const ok = await U.confirm(
          h('div', null,
            h('div', null, '前回のひな形のうち、まだ確認していない品が ' + un.length + ' 件あります。'),
            h('ul', null, un.map((it) => h('li', null, it.name + ' ×' + it.qty))),
            h('div', null, '今回は持参していない物として、リストから外して完了しますか？')),
          { okLabel: '外して完了', cancelLabel: '戻って確認', danger: true });
        if (!ok) return;
        stay.items = stay.items.filter((it) => it.inChecked);
      }
      stay.status = 'staying';
      stay.checkInAt = Date.now();
      await rememberStaff(stay.checkInBy);
      U.toast('入所チェックを完了しました');
      save();
    }

    async function finishCheckOut() {
      if (!stay.checkOutBy && !(await askNoStaff())) return;
      const lines = Model.problemLines(stay);
      let noteText = '';
      if (lines.length) {
        const ta = h('textarea', { class: 'input', rows: '5' }, lines.join('\n'));
        const ok = await U.confirm(
          h('div', null,
            h('div', { class: 'warn-title' }, '合っていない品が ' + lines.length + ' 件あります'),
            h('ul', { class: 'problem-list' }, lines.map((l) => h('li', null, l))),
            h('label', { class: 'field' }, '次回への申し送り（次の入所チェックの画面に出ます。不要なら空に）', ta)),
          { okLabel: 'この内容で完了', cancelLabel: '戻って確認', danger: true });
        if (!ok) return;
        noteText = ta.value.trim();
      } else {
        const ok = await U.confirm('全ての品が一致しています。退所チェックを完了しますか？', { okLabel: '完了' });
        if (!ok) return;
      }
      stay.status = 'done';
      stay.checkOutAt = Date.now();
      await rememberStaff(stay.checkOutBy);
      if (noteText && resident.id) {
        resident.notes.push({ id: U.uid('n'), text: noteText, stayId: stay.id, createdAt: Date.now(), resolvedAt: null });
        await DB.put('residents', resident);
      }
      U.toast('退所チェックを完了しました');
      save();
    }

    // 写真の拡大表示（削除つき）
    async function photoDialog(list, ref, canDelete) {
      const rec = await DB.get('photos', ref.id);
      let close;
      const body = h('div', null,
        h('img', { class: 'photo-full', src: rec ? rec.data : ref.thumb }),
        h('div', { class: 'modal-btns' },
          canDelete ? h('button', {
            class: 'btn danger', onclick: async () => {
              if (!(await U.confirm('この写真を削除しますか？', { okLabel: '削除', danger: true }))) return;
              list.splice(list.indexOf(ref), 1);
              await saveQuiet();
              await DB.dropPhotosIfUnused([ref.id]);
              close();
              App.refresh();
            }
          }, '写真を削除') : null,
          (window.PickFrom && editable && list === stay.photos) ? h('button', {
            class: 'btn', onclick: () => { close(); window.PickFrom.open(stay, ref, () => App.refresh()); }
          }, '👆 この写真から品を選ぶ') : null,
          h('button', { class: 'btn primary', onclick: () => close() }, '閉じる')));
      close = U.modal(body, { wide: true });
    }

    // 品の編集
    function itemDialog(it) {
      let close;
      const readOnly = mode === 'done';
      const catNames = window.Master.catOrder(master);
      if (catNames.indexOf(it.cat) < 0) catNames.push(it.cat);
      const name = h('input', { class: 'input', type: 'text', value: it.name, disabled: readOnly });
      const cat = h('select', { class: 'input', value: it.cat, disabled: readOnly }, catNames.map((c) => h('option', { value: c }, c)));
      const qty = h('input', { class: 'input', type: 'number', min: '1', inputmode: 'numeric', value: it.qty, disabled: mode === 'checkout' || readOnly });
      const cons = h('input', { type: 'checkbox', checked: it.consumable, disabled: readOnly });
      const note = h('input', { class: 'input', type: 'text', value: it.note, placeholder: '色・柄・記名の有無・傷など', disabled: readOnly });
      const outNote = h('input', { class: 'input', type: 'text', value: it.outNote, placeholder: '例：洗濯中のため次回返却', disabled: readOnly });
      const strip = h('div', { class: 'photo-strip' });
      const drawPhotos = () => {
        strip.innerHTML = '';
        it.photos.forEach((p) => strip.appendChild(h('img', { class: 'thumb lg', src: p.thumb, onclick: () => U.viewPhoto(p) })));
        if (!readOnly) strip.appendChild(h('button', {
          class: 'photo-add lg', onclick: async () => {
            const ref = await U.pickPhoto();
            if (ref) { it.photos.push(ref); await saveQuiet(); drawPhotos(); }
          }
        }, '📷', h('span', null, '撮る')));
        if (!readOnly) strip.appendChild(h('button', {
          class: 'photo-add lg', onclick: async () => {
            const ref = await U.pickPhoto({ gallery: true });
            if (ref) { it.photos.push(ref); await saveQuiet(); drawPhotos(); }
          }
        }, '🖼', h('span', null, '画像から')));
      };
      drawPhotos();

      const apply = () => {
        const n = name.value.trim();
        if (!n) { U.toast('品名を入れてください', true); return; }
        const q = parseInt(qty.value, 10);
        it.name = n;
        it.cat = cat.value;
        if (q >= 1) it.qty = q;
        it.consumable = cons.checked;
        it.note = note.value.trim();
        it.outNote = outNote.value.trim();
        if (mode === 'checkin') it.inChecked = true;
        close();
        save();
      };
      const remove = async () => {
        if (!(await U.confirm('「' + it.name + '」をリストから削除しますか？', { okLabel: '削除', danger: true }))) return;
        stay.items.splice(stay.items.indexOf(it), 1);
        await saveQuiet();
        await DB.dropPhotosIfUnused(it.photos.map((p) => p.id));
        close();
        App.refresh();
      };

      const body = h('div', null,
        h('h2', null, readOnly ? '品の詳細' : '品を編集'),
        h('label', { class: 'field' }, '品名', name),
        h('div', { class: 'row2' },
          h('label', { class: 'field' }, 'カテゴリ', cat),
          h('label', { class: 'field' }, '入所時の個数', qty)),
        h('label', { class: 'field' }, '特徴メモ', note),
        (mode === 'checkout' || mode === 'done') ? h('label', { class: 'field' }, '退所時メモ', outNote) : null,
        h('label', { class: 'check' }, cons, ' 消耗品（滞在中に減るのが普通の物。減っても不足扱いにしない）'),
        h('div', { class: 'field' }, '写真', strip),
        h('div', { class: 'modal-btns' },
          !readOnly ? h('button', { class: 'btn danger', onclick: remove }, '削除') : null,
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', onclick: () => { close(); App.refresh(); } }, readOnly ? '閉じる' : 'やめる'),
          !readOnly ? h('button', { class: 'btn primary', onclick: apply }, '保存') : null));
      close = U.modal(body);
    }

    // 日程・メモ・記録の削除
    function editStayDialog() {
      let close;
      const dIn = h('input', { class: 'input', type: 'date', value: stay.dateIn });
      const dOut = h('input', { class: 'input', type: 'date', value: stay.dateOut });
      const memo = h('textarea', { class: 'input', rows: '3' }, stay.memo || '');
      const body = h('div', null,
        h('h2', null, '日程・メモ'),
        h('div', { class: 'row2' },
          h('label', { class: 'field' }, '入所日', dIn),
          h('label', { class: 'field' }, '退所予定日', dOut)),
        h('label', { class: 'field' }, 'メモ（この滞在について）', memo),
        h('div', { class: 'modal-btns' },
          h('button', {
            class: 'btn danger', onclick: async () => {
              const ok = await U.confirm('この記録（' + stay.items.length + '品目・写真を含む）を削除します。元に戻せません。', { okLabel: '削除する', danger: true });
              if (!ok) return;
              const ids = Model.stayPhotoIds(stay);
              await DB.del('stays', stay.id);
              await DB.dropPhotosIfUnused(ids);
              close();
              App.go('#/home');
            }
          }, 'この記録を削除'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', onclick: () => close() }, 'やめる'),
          h('button', {
            class: 'btn primary', onclick: () => {
              stay.dateIn = dIn.value || stay.dateIn;
              stay.dateOut = dOut.value;
              stay.memo = memo.value.trim();
              close();
              save();
            }
          }, '保存')));
      close = U.modal(body);
    }
  });
})();
