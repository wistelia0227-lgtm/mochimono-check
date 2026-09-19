// タップした品の輪郭を自動で見つける（独立モジュール。外すにはこのファイルと index.html の script 行を消す → 指で囲む方法だけになる）
// 仕組み: 物の切り出し専用の軽いモデル SlimSAM（約13〜20MB）を端末の中で動かす。写真は端末の外へ出ない。
//   初回だけモデルと実行部品を外から取ってくる（以後はブラウザが保存）。
// 実測(2026-09-19, PC): 写真1枚ごとの下準備 8〜15秒（1回だけ・裏で実行）、1タップ 0.5〜0.8秒。
//   GPU では軽量化版(q8)の出力が壊れる（枠が写真全体になる）ので fp16 を使う。CPU(wasm) は q8 で正しく動く。
(function () {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  const MODEL = 'Xenova/slimsam-77-uniform';
  const Segment = { info: '' };
  let T = null, model = null, processor = null, loading = null;

  async function load() {
    if (model) return;
    if (!loading) loading = (async () => {
      T = await import(LIB);
      const tries = navigator.gpu ? [['webgpu', 'fp16'], ['wasm', 'q8']] : [['wasm', 'q8']];
      let lastErr = null;
      for (const [device, dtype] of tries) {
        try {
          model = await T.SamModel.from_pretrained(MODEL, { device: device, dtype: dtype });
          Segment.info = device + '/' + dtype;
          break;
        } catch (e) { lastErr = e; model = null; }
      }
      if (!model) throw lastErr || new Error('モデルを読み込めません');
      processor = await T.AutoProcessor.from_pretrained(MODEL);
    })().catch((e) => { loading = null; throw e; });
    await loading;
  }

  // 写真1枚の下準備（重いのはここ。1回だけ）→ tap(x, y) を持つ session
  Segment.prepare = async function (src) {
    const t0 = performance.now();
    await load();
    const raw = await T.RawImage.read(src);
    const inputs = await processor(raw);
    const emb = await model.get_image_embeddings(inputs);
    const rs = inputs.reshaped_input_sizes[0];
    const session = { prepSec: Math.round((performance.now() - t0) / 100) / 10 };

    // x, y は写真に対する 0〜1。戻り値は枠の候補（狭い順）と、最初に見せる候補の番号
    session.tap = async function (x, y) {
      const out = await model(Object.assign({}, emb, {
        input_points: new T.Tensor('float32', [x * rs[1], y * rs[0]], [1, 1, 1, 2]),
        input_labels: new T.Tensor('int64', [1n], [1, 1, 1])
      }));
      const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
      const m = masks[0], n = m.dims[1], H = m.dims[2], W = m.dims[3], scores = Array.from(out.iou_scores.data);
      let cands = [];
      for (let k = 0; k < n; k++) {
        let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0;
        const off = k * H * W;
        for (let yy = 0; yy < H; yy += 2) for (let xx = 0; xx < W; xx += 2) if (m.data[off + yy * W + xx]) {
          area++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
        }
        if (x1 < 0) continue;
        const pad = 0.015; // 少し余白を付けて切り抜く
        const bx = Math.max(0, x0 / W - pad), by = Math.max(0, y0 / H - pad);
        cands.push({
          x: bx, y: by, w: Math.min(1, x1 / W + pad) - bx, h: Math.min(1, y1 / H + pad) - by,
          score: scores[k], area: area * 4 / (W * H)
        });
      }
      // 小さすぎる（点）・大きすぎる（写真ほぼ全体）候補は捨てる。ほぼ同じ枠はまとめる
      cands = cands.filter((c) => c.w * c.h > 0.004 && c.w * c.h < 0.85).sort((a, b) => a.w * a.h - b.w * b.h);
      cands = cands.filter((c, i) => i === 0 || Math.abs(c.w * c.h - cands[i - 1].w * cands[i - 1].h) > 0.01);
      let best = 0;
      cands.forEach((c, i) => { if (c.score > cands[best].score) best = i; });
      return { cands: cands, best: best };
    };
    return session;
  };

  window.Segment = Segment;
})();
