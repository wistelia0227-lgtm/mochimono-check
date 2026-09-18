// アプリ内カメラ: シャッターを押すたびに1枚保存し、そのまま続けて撮れる（独立モジュール）
// 外すにはこのファイルと index.html の script 行を消す。無い時は端末標準のカメラ（1枚ずつ）に戻る。
// カメラが使えない環境（許可なし・http・非対応）でも、標準のカメラに切り替えて動作を続ける。
(function () {
  'use strict';
  const U = window.U, h = U.h;
  const Camera = {};

  function frameToData(video, max, quality) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.min(1, max / Math.max(vw, vh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vw * k)); c.height = Math.max(1, Math.round(vh * k));
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  async function fallbackSingle(onShot) {
    const ref = await U.pickPhoto();
    if (!ref) return 0;
    await onShot(ref);
    return 1;
  }

  // opts: { title, hint, onShot(ref) } → 撮った枚数
  Camera.open = async function (opts) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fallbackSingle(opts.onShot);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    } catch (e) {
      U.toast('アプリ内のカメラを使えないため、標準のカメラで撮ります（' + (e.name || e.message) + '）');
      return fallbackSingle(opts.onShot);
    }
    return new Promise((resolve) => {
      let count = 0, busy = false;
      const video = h('video', { class: 'cam-video', autoplay: true, playsinline: true, muted: true });
      video.muted = true;
      video.srcObject = stream;
      const last = h('div', { class: 'cam-last' });
      const counter = h('div', { class: 'cam-count' }, '0 枚');
      const flash = h('div', { class: 'cam-flash' });
      const shutter = h('button', { class: 'cam-shutter', 'aria-label': '撮る' });
      const finish = () => {
        stream.getTracks().forEach((t) => t.stop());
        bg.remove();
        resolve(count);
      };
      const shoot = async () => {
        if (busy || !video.videoWidth) return;
        busy = true; shutter.disabled = true;
        flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 120);
        try {
          const ref = await U.storePhoto(frameToData(video, 1280, 0.8), frameToData(video, 160, 0.7));
          await opts.onShot(ref);
          count++;
          counter.textContent = count + ' 枚';
          last.innerHTML = '';
          last.appendChild(h('img', { src: ref.thumb }));
        } catch (e) { U.toast('保存できませんでした: ' + e.message, true); }
        busy = false; shutter.disabled = false;
      };
      shutter.addEventListener('click', shoot);
      const bg = h('div', { class: 'cam-bg' },
        h('div', { class: 'cam-head' },
          h('div', { class: 'cam-title' }, opts.title || '撮影', h('div', { class: 'cam-hint' }, opts.hint || '')),
          h('button', { class: 'btn primary', onclick: finish }, '完了')),
        h('div', { class: 'cam-view' }, video, flash),
        h('div', { class: 'cam-bar' }, h('div', { class: 'cam-side' }, last), shutter, h('div', { class: 'cam-side' }, counter)));
      document.body.appendChild(bg);
      video.play().catch(() => { /* autoplay 済みなら無視 */ });
    });
  };

  window.Camera = Camera;
})();
