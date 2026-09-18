// 品目マスタ。初期値はここ、編集後は meta['master'] に保存。window.Master で公開。
// 「消耗品」は名前でなくフラグで判定する（名前を変えても動くように）。
(function () {
  'use strict';
  // [カテゴリ, [品名 or [品名, 消耗品]]...]
  const DEFAULTS = [
    ['衣類', ['上着', 'ズボン', '肌着(上)', '肌着(下)・パンツ', '靴下', 'パジャマ(上)', 'パジャマ(下)', 'カーディガン・羽織り', '上履き・靴', 'タオル', 'バスタオル']],
    ['洗面・口腔', ['歯ブラシ', ['歯磨き粉', true], 'コップ', '義歯(上)', '義歯(下)', '義歯ケース', ['義歯洗浄剤', true], 'くし・ブラシ', 'ひげそり']],
    ['薬・医療', [['内服薬', true], ['目薬', true], ['塗り薬', true], ['貼り薬', true], ['インスリン等の注射薬', true], 'お薬手帳', '血糖測定器']],
    ['身の回り', ['眼鏡', '眼鏡ケース', '補聴器', ['補聴器の電池', true], '杖', '腕時計', '携帯電話', '充電器', '財布・現金', 'バッグ・かばん']],
    ['排泄用品', [['紙パンツ', true], ['尿取りパッド', true], ['テープ式おむつ', true], ['おしりふき', true]]],
    ['書類', ['介護保険証', '健康保険証', '負担割合証', '連絡帳']],
    ['福祉用具', ['車椅子', '歩行器', 'シルバーカー', 'クッション']],
    ['その他', []]
  ];

  function build() {
    const m = { cats: [], items: [] };
    DEFAULTS.forEach((row, ci) => {
      const catId = 'c' + ci;
      m.cats.push({ id: catId, name: row[0] });
      row[1].forEach((it, ii) => {
        const arr = Array.isArray(it) ? it : [it, false];
        m.items.push({ id: catId + '_' + ii, catId: catId, name: arr[0], consumable: !!arr[1] });
      });
    });
    return m;
  }

  const Master = {};
  Master.load = async function () {
    const m = await window.DB.getMeta('master', null);
    return m || build();
  };
  Master.save = (m) => window.DB.setMeta('master', m);
  Master.defaults = build;
  // カテゴリ名の並び順（滞在リストのグループ順に使う）
  Master.catOrder = (m) => m.cats.map((c) => c.name);

  window.Master = Master;
})();
