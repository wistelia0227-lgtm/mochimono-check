// タップした品の輪郭を自動で見つける（独立モジュール。外すにはこのファイルと index.html の script 行を消す → 指で囲む方法だけになる）
// 仕組み: 物の切り出し専用の軽いモデル SlimSAM（約13〜40MB）を端末の中で動かす。写真は端末の外へ出ない。
//   初回だけモデルと実行部品を外から取ってくる（以後はブラウザが保存）。
// 実測(2026-09-19, PC): 写真1枚ごとの下準備 8〜15秒（1回だけ・裏で実行）、1タップ 0.5〜0.8秒。
// 罠: GPU と数値精度の組み合わせによっては、エラーも出さずに壊れた輪郭（写真全体など）を返す。
//   PC の GPU では q8 が壊れ fp16/fp32 は正常。スマホの GPU では fp16 が怪しい（実機報告: 準備は通るがタップで囲めない）。
//   → 設定を決め打ちせず、下準備のたびに「試し打ち」で出力がまともか確かめ、だめなら次の設定に自動で切り替える。
//     動いた設定は端末に覚えておく。
(function () {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  const MODEL = 'Xenova/slimsam-77-uniform';
  const KEY = 'mochimono.segcfg.v1';
  // 試験用: アドレスに ?segcfg=webgpu:q8,wasm:q8 のように付けると、試す設定の順番を差し替えられる（覚えも使わない）
  const forced = new URLSearchParams(location.search).get('segcfg');
  const CONFIGS = forced ? forced.split(',').map((s) => s.split(':')) : [['webgpu', 'fp16'], ['webgpu', 'fp32'], ['wasm', 'q8']];
  const Segment = { info: '', log: [] };
  let T = null, model = null, processor = null, loadedCfg = -1;

  // モデルの実行は同時に1つだけにする（人のタップと自動探索が同時に走るとエラーになる）
  let chain = Promise.resolve();
  const locked = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  const note = (s) => { Segment.log.push(s); if (Segment.log.length > 40) Segment.log.shift(); };

  function savedIndex() {
    if (forced) return -1;
    try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.ok >= 0 && v.ok < CONFIGS.length) return v.ok; } catch (e) { /* 無視 */ }
    return -1;
  }
  const remember = (i) => { if (forced) return; try { localStorage.setItem(KEY, JSON.stringify({ ok: i })); } catch (e) { /* 無視 */ } };

  async function loadConfig(i) {
    if (!T) T = await import(LIB);
    if (loadedCfg === i && model) return;
    if (model && model.dispose) { try { await model.dispose(); } catch (e) { /* 無視 */ } }
    model = null; loadedCfg = -1;
    model = await T.SamModel.from_pretrained(MODEL, { device: CONFIGS[i][0], dtype: CONFIGS[i][1] });
    if (!processor) processor = await T.AutoProcessor.from_pretrained(MODEL);
    loadedCfg = i;
    Segment.info = CONFIGS[i].join('/');
  }

  // 1点をタップした時の生の候補（捨てる前）
  async function rawMasks(ctx, x, y) {
    const out = await locked(() => model(Object.assign({}, ctx.emb, {
      input_points: new T.Tensor('float32', [x * ctx.rs[1], y * ctx.rs[0]], [1, 1, 1, 2]),
      input_labels: new T.Tensor('int64', [1n], [1, 1, 1])
    })));
    const masks = await processor.post_process_masks(out.pred_masks, ctx.inputs.original_sizes, ctx.inputs.reshaped_input_sizes);
    const m = masks[0], n = m.dims[1], H = m.dims[2], W = m.dims[3], scores = Array.from(out.iou_scores.data);
    const res = [];
    for (let k = 0; k < n; k++) {
      let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0;
      const off = k * H * W;
      for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < W; xx += 2) if (m.data[off + yy * W + xx]) {
        area++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
      }
      res.push({ x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H, empty: x1 < 0, score: scores[k], area: area * 4 / (W * H) });
    }
    return res;
  }
  const describe = (ms) => ms.map((m) => Math.round(m.area * 100) + '%/' + (isFinite(m.score) ? m.score.toFixed(2) : 'NaN')).join(' ');

  // 試し打ち: 5か所をタップしたつもりで、出力がまともか確かめる。壊れた出力は「ほぼ全面」「空」「点数が数でない」が大半を占める
  async function sane(ctx) {
    let bad = 0, total = 0;
    const seen = [];
    for (const p of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) {
      const ms = await rawMasks(ctx, p[0], p[1]);
      ms.forEach((m) => { total++; if (m.empty || m.area > 0.85 || m.area < 0.0005 || !isFinite(m.score)) bad++; });
      seen.push(describe(ms));
    }
    note(Segment.info + ' 試し打ち: だめ ' + bad + '/' + total + ' [' + seen.join(' | ') + ']');
    return bad / total <= 0.5;
  }

  // 写真1枚の下準備（重いのはここ。1回だけ）→ tap(x, y) を持つ session
  Segment.prepare = async function (src) {
    const t0 = performance.now();
    if (!T) T = await import(LIB);
    const raw = await T.RawImage.read(src);
    const known = savedIndex();
    const order = [];
    if (known >= 0) order.push(known);
    CONFIGS.forEach((c, i) => { if (i !== known && (c[0] !== 'webgpu' || navigator.gpu)) order.push(i); });

    let ctx = null, lastErr = null;
    for (const i of order) {
      try {
        await loadConfig(i);
        const inputs = await processor(raw);
        const emb = await model.get_image_embeddings(inputs);
        const c = { inputs: inputs, emb: emb, rs: inputs.reshaped_input_sizes[0] };
        if (i === known || (await sane(c))) { ctx = c; if (i !== known) remember(i); break; }
        note(Segment.info + ' は出力が壊れているので次の設定へ');
      } catch (e) { lastErr = e; note(CONFIGS[i].join('/') + ' で失敗: ' + (e && e.message || e)); }
    }
    if (!ctx) throw lastErr || new Error('この端末で正しく動く設定が見つかりませんでした');
    const session = { prepSec: Math.round((performance.now() - t0) / 100) / 10, diag: '' };

    // x, y は写真に対する 0〜1。戻り値は枠の候補（狭い順）と、最初に見せる候補の番号
    session.tap = async function (x, y) {
      const ms = await rawMasks(ctx, x, y);
      session.diag = Segment.info + ' 面積/点数: ' + describe(ms);
      note('tap ' + x.toFixed(2) + ',' + y.toFixed(2) + ' ' + session.diag);
      const pad = 0.015; // 少し余白を付けて切り抜く
      let cands = ms.filter((m) => !m.empty && isFinite(m.score)).map((m) => {
        const bx = Math.max(0, m.x0 - pad), by = Math.max(0, m.y0 - pad);
        return { x: bx, y: by, w: Math.min(1, m.x1 + pad) - bx, h: Math.min(1, m.y1 + pad) - by, score: m.score, area: m.area };
      });
      // 小さすぎる（点）・大きすぎる（写真ほぼ全体）候補は捨てる。ほぼ同じ枠はまとめる
      cands = cands.filter((c) => c.w * c.h > 0.004 && c.w * c.h < 0.85).sort((a, b) => a.w * a.h - b.w * b.h);
      const uniq = [];
      cands.forEach((c) => { const p = uniq[uniq.length - 1]; if (!p || Math.abs(c.w * c.h - p.w * p.h) > 0.01) uniq.push(c); });
      let best = 0;
      uniq.forEach((c, i) => { if (c.score > uniq[best].score) best = i; });
      // 覚えていた設定が後から壊れた出力を返し始めた場合に備え、候補ゼロが続いたら覚えを消す
      if (!uniq.length) { session.misses = (session.misses || 0) + 1; if (session.misses >= 2) { try { localStorage.removeItem(KEY); } catch (e) { /* 無視 */ } } }
      return { cands: uniq, best: best };
    };

    // 写真の中の品を自動で探して、枠の候補を返す（取捨選択は人がする）
    // 実測(2026-09-19, PC): 12×12=144点を GPU で1点ずつ 15.6秒。GPU で点をまとめて渡すと壊れた輪郭が返る（CPU はまとめても正常）。
    // opts.grid 格子の細かさ / opts.onProgress(0〜1) / opts.shouldPause() が true の間は人のタップを優先して待つ
    session.propose = async function (opts) {
      opts = opts || {};
      const G = opts.grid || 12, t1 = performance.now();
      const pts = [];
      for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) pts.push([(gx + 0.5) / G, (gy + 0.5) / G]);
      const chunk = CONFIGS[loadedCfg][0] === 'webgpu' ? 1 : 16;
      const raws = [];
      for (let s = 0; s < pts.length; s += chunk) {
        while (opts.shouldPause && opts.shouldPause()) await new Promise((r) => setTimeout(r, 120));
        const part = pts.slice(s, s + chunk), flat = [];
        part.forEach((p) => flat.push(p[0] * ctx.rs[1], p[1] * ctx.rs[0]));
        const o = await locked(() => model(Object.assign({}, ctx.emb, {
          input_points: new T.Tensor('float32', flat, [1, part.length, 1, 2]),
          input_labels: new T.Tensor('int64', part.map(() => 1n), [1, part.length, 1])
        })));
        // 低解像度(256×256)のまま枠を取る。写真の大きさまで引き伸ばすと144点では重すぎる
        const pm = o.pred_masks, sc = o.iou_scores.data, N = pm.dims[1], K = pm.dims[2], mh = pm.dims[3], mw = pm.dims[4];
        const vw = Math.max(1, Math.round(mw * ctx.rs[1] / 1024)), vh = Math.max(1, Math.round(mh * ctx.rs[0] / 1024)); // 余白を除いた範囲
        for (let n = 0; n < N; n++) for (let k = 0; k < K; k++) {
          const off = (n * K + k) * mh * mw;
          let x0 = vw, y0 = vh, x1 = -1, y1 = -1, area = 0;
          for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) if (pm.data[off + y * mw + x] > 0) {
            area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          if (x1 >= 0) raws.push({ x: x0 / vw, y: y0 / vh, w: (x1 - x0 + 1) / vw, h: (y1 - y0 + 1) / vh, area: area / (vw * vh), score: sc[n * K + k] });
        }
        if (opts.onProgress) opts.onProgress(Math.min(1, (s + chunk) / pts.length));
      }
      const boxes = selectObjects(raws);
      note(Segment.info + ' 自動で探す: ' + pts.length + '点 → 生 ' + raws.length + ' → 候補 ' + boxes.length + '（' + ((performance.now() - t1) / 1000).toFixed(1) + '秒）');
      return boxes;
    };
    return session;
  };

  // 生の輪郭から「物らしい枠」を選ぶ。完璧は狙わない（最後は人が取捨選択する）
  function selectObjects(raws) {
    const fill = (m) => m.area / (m.w * m.h), size = (m) => m.w * m.h;
    const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const iou = (a, b) => { const i = inter(a, b); return i / (size(a) + size(b) - i); };
    const inside = (a, b) => inter(a, b) / size(a);                       // a のうち b に入っている割合
    const edges = (m) => (m.x < 0.01) + (m.y < 0.01) + (m.x + m.w > 0.99) + (m.y + m.h > 0.99);
    // 点数が低い・小さすぎる・大きすぎる・写真の端に2辺以上かかる（＝机や床）は捨てる
    const c = raws.filter((m) => isFinite(m.score) && m.score >= 0.75 && m.area > 0.0015 && size(m) < 0.3 && edges(m) < 2).sort((a, b) => b.score - a.score);
    const uniq = [];
    c.forEach((m) => { if (!uniq.some((k) => iou(m, k) > 0.6)) uniq.push(m); });          // 同じ物の重複
    let solid = uniq.filter((m) => fill(m) >= 0.45);                                      // 枠いっぱいに中身がある＝物らしい
    const loose = uniq.filter((m) => fill(m) < 0.45);                                     // スカスカ＝細い物か、背景の切れ端か、物のまとまり
    // 大きい枠の中身の大半を、複数の別々の物が占めている → その大きい枠は「まとまり」なので捨てる。中の1つとほぼ同じなら小さい方を残す
    solid = solid.filter((b) => {
      const kids = solid.filter((k) => k !== b && size(k) < size(b) && inside(k, b) > 0.8);
      const cover = kids.reduce((s, k) => s + size(k), 0) / size(b);
      return !((kids.length >= 2 && cover > 0.5) || (kids.length === 1 && cover > 0.6));
    });
    // 残った大きい枠の中に収まる小さい枠は、その物の部品として捨てる
    solid = solid.filter((m) => !solid.some((k) => k !== m && size(k) > size(m) && inside(m, k) > 0.8));
    // スカスカの枠は、物をまたいでいたら捨てる。何も含まず何にも含まれなければ細い物（眼鏡・鎖など）として残す
    let thin = loose.filter((m) => !solid.some((k) => inside(k, m) > 0.5) && !solid.some((k) => inside(m, k) > 0.8));
    thin = thin.filter((m) => !thin.some((k) => k !== m && size(k) < size(m) && inside(k, m) > 0.8));
    const pad = 0.012;
    return solid.concat(thin).map((m) => {
      const x = Math.max(0, m.x - pad), y = Math.max(0, m.y - pad);
      return { x: x, y: y, w: Math.min(1, m.x + m.w + pad) - x, h: Math.min(1, m.y + m.h + pad) - y, score: m.score };
    }).sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  }
  Segment._selectObjects = selectObjects; // 試験用

  window.Segment = Segment;
})();
