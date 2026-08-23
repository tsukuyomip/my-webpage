/*
 * toio BLE デバッグ
 *
 * 「位置IDの通知が来ない」の原因を、余計な層を挟まずに確かめるためのページ。
 * わざと ../shared/toio.js を使わず、Web Bluetooth を直に叩いている。
 * ラッパー側のバグの可能性を除くためと、購読の仕掛け方を実験したいため。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const SERVICE = '10b20100-5b3b-4571-9508-cf3efcd7bbae';
  const CHARS = [
    { key: 'id', uuid: '10b20101-5b3b-4571-9508-cf3efcd7bbae', name: '読み取りセンサー' },
    { key: 'motor', uuid: '10b20102-5b3b-4571-9508-cf3efcd7bbae', name: 'モーター' },
    { key: 'light', uuid: '10b20103-5b3b-4571-9508-cf3efcd7bbae', name: 'ランプ' },
    { key: 'sound', uuid: '10b20104-5b3b-4571-9508-cf3efcd7bbae', name: 'サウンド' },
    { key: 'sensor', uuid: '10b20106-5b3b-4571-9508-cf3efcd7bbae', name: 'センサー' },
    { key: 'button', uuid: '10b20107-5b3b-4571-9508-cf3efcd7bbae', name: 'ボタン' },
    { key: 'battery', uuid: '10b20108-5b3b-4571-9508-cf3efcd7bbae', name: 'バッテリー' },
    { key: 'config', uuid: '10b201ff-5b3b-4571-9508-cf3efcd7bbae', name: '設定' },
  ];
  // 通知を購読する対象。ランプとサウンドは書き込み専用
  const NOTIFY = ['id', 'motor', 'sensor', 'button', 'battery', 'config'];

  const state = {};   // key -> {char, got, notifyFlag, subscribe, nListener, nOnchar, last, lastAt}
  let device = null;
  let motorWaiter = null;   // 目標指定の応答を待つときだけ入る

  for (const c of CHARS) {
    state[c.key] = {
      char: null, got: '—', notifyFlag: '—', subscribe: '—',
      nListener: 0, nOnchar: 0, nValid: 0, last: '—', lastAt: 0,
    };
  }

  const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  const logLines = [];
  function log(dir, key, text) {
    const t = new Date();
    const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      + `:${String(t.getSeconds()).padStart(2, '0')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
    const line = `${stamp} ${dir} ${key} ${text}`;
    logLines.push(line);
    if (logLines.length > 500) logLines.shift();

    const div = document.createElement('div');
    div.className = 'log-line ' + dir;
    div.textContent = line;
    const box = $('log');
    box.appendChild(div);
    while (box.childNodes.length > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------- 表
  function renderTable() {
    const tbody = $('charTable').querySelector('tbody');
    tbody.textContent = '';
    for (const c of CHARS) {
      const s = state[c.key];
      const tr = document.createElement('tr');
      const cells = [
        `${c.name}\n${c.key}`,
        s.got,
        s.notifyFlag,
        s.subscribe,
        String(s.nListener) + (c.key === 'id' ? `\n有効 ${s.nValid}` : ''),
        String(s.nOnchar),
        s.lastAt ? `${s.last}\n${Math.round((Date.now() - s.lastAt) / 1000)}秒前` : '—',
      ];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i === 4 && s.nListener > 0) td.className = 'good';
        if (i === 5 && s.nOnchar > 0) td.className = 'good';
        if ((i === 1 || i === 3) && /失敗|なし/.test(v)) td.className = 'bad';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  }

  setInterval(renderTable, 1000);
  renderTable();

  // ---------------------------------------------------------------- 解釈
  /** 受け取ったバイト列に短い説明を付ける。判断に使うところだけ */
  function describe(key, b) {
    if (!b.length) return '（空）';
    if (key === 'id') {
      if (b[0] === 1 && b.length >= 11) {
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return `位置ID x=${v.getUint16(1, true)} y=${v.getUint16(3, true)} θ=${v.getUint16(5, true)}`;
      }
      if (b[0] === 2) return '標準ID';
      if (b[0] === 3) return '位置ID missed';
      if (b[0] === 4) return '標準ID missed';
      return '不明';
    }
    if (key === 'motor') {
      if (b[0] === 0x83 || b[0] === 0x84) {
        // 仕様に載っている 0〜2 だけ名前を付け、それ以外は数字のまま出す
        const reason = { 0: '正常終了', 1: 'タイムアウト', 2: 'toio ID missed' }[b[2]] || '仕様外';
        return `応答 制御識別値=${b[1]} 理由=${b[2]}（${reason}）`;
      }
      if (b[0] === 0xe0) return `速度情報 左=${b[1]} 右=${b[2]}`;
      return '';
    }
    if (key === 'button') return b[1] === 0x80 ? 'ボタン 押された' : 'ボタン 離された';
    if (key === 'battery') return `残量 ${b[0]}%`;
    if (key === 'sensor') {
      if (b[0] === 1) return `水平=${b[1]} 衝突=${b[2]} ダブルタップ=${b[3]} 姿勢=${b[4]} シェイク=${b[5]}`;
      if (b[0] === 2) return '磁気センサー';
      if (b[0] === 3) return '姿勢角';
      return '';
    }
    if (key === 'config') {
      if (b[0] === 0x81) return `BLEプロトコルバージョン ${new TextDecoder().decode(b.slice(2))}`;
      return `設定の応答 種類=0x${b[0].toString(16)} 結果=${b[2]}`;
    }
    return '';
  }

  function onNotify(key, bytes, via) {
    const s = state[key];
    if (via === 'listener') s.nListener++; else s.nOnchar++;
    // 中身が仕様どおりのものだけを別に数える。読み出しの反射など、
    // 件数だけ増えて意味のない通知に騙されないため
    if (key === 'id' && bytes.length && (bytes[0] === 0x01 || bytes[0] === 0x02)) s.nValid++;
    s.last = hex(bytes);
    s.lastAt = Date.now();

    if (key === 'id' && !$('logId').checked) return;
    log('rx', `${key}(${via})`,
      `${hex(bytes)}${key === 'id' ? ` (${bytes.length}バイト)` : ''}  ${describe(key, bytes)}`);

    if (key === 'motor' && (bytes[0] === 0x83 || bytes[0] === 0x84)) {
      $('motorResult').textContent = '目標指定の応答: ' + describe(key, bytes);
      if (motorWaiter) { const w = motorWaiter; motorWaiter = null; w(bytes[2]); }
    }
    if (key === 'config' && bytes[0] === 0x81) {
      $('protoLine').textContent = 'BLEプロトコルバージョン: '
        + new TextDecoder().decode(bytes.slice(2));
    }
  }

  // ---------------------------------------------------------------- 接続
  if (!navigator.bluetooth) $('unsupported').classList.remove('hidden');

  $('btnConnect').addEventListener('click', async () => {
    try {
      $('btnConnect').disabled = true;
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE] }],
        optionalServices: [SERVICE],
      });
      log('info', '-', `デバイス: ${device.name || '(名前なし)'} id=${device.id}`);
      device.addEventListener('gattserverdisconnected', () => {
        log('info', '-', '切断されました');
        toast('切断されました');
      });

      const server = await device.gatt.connect();
      log('info', '-', 'GATT 接続');
      const service = await server.getPrimaryService(SERVICE);
      log('info', '-', 'サービス取得');

      for (const c of CHARS) {
        const s = state[c.key];
        try {
          s.char = await service.getCharacteristic(c.uuid);
          s.got = 'ok';
          const p = s.char.properties || {};
          s.notifyFlag = p.notify ? 'true' : String(p.notify);
          log('info', c.key, `取得 ok / properties: `
            + ['broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate']
              .filter((k) => p[k]).join(',') || '(なし)');
        } catch (e) {
          s.got = '失敗: ' + (e.message || e);
          log('info', c.key, '取得できず: ' + (e.message || e));
        }
      }

      // 購読は 2 通り仕掛ける。どちらに来るかでブラウザの実装差が見える
      for (const key of NOTIFY) {
        const s = state[key];
        if (!s.char) { s.subscribe = 'キャラクタリスティックなし'; continue; }
        s.char.addEventListener('characteristicvaluechanged', (ev) => {
          onNotify(key, new Uint8Array(ev.target.value.buffer), 'listener');
        });
        s.char.oncharacteristicvaluechanged = (ev) => {
          onNotify(key, new Uint8Array(ev.target.value.buffer), 'onchar');
        };
        try {
          await s.char.startNotifications();
          s.subscribe = 'ok';
          log('info', key, 'startNotifications 成功');
        } catch (e) {
          s.subscribe = '失敗: ' + (e.message || e);
          log('info', key, 'startNotifications 失敗: ' + (e.message || e));
        }
      }

      // バージョンを聞く（設定の通知が来るかの確認も兼ねる）
      await write('config', [0x01, 0x00]);

      renderTable();
      toast('接続しました');
    } catch (e) {
      if (e && e.name === 'NotFoundError') { $('btnConnect').disabled = false; return; }
      log('info', '-', '接続失敗: ' + (e.message || e));
      toast('接続失敗: ' + (e.message || e));
    } finally {
      $('btnConnect').disabled = false;
    }
  });

  // BLE は GATT 操作を重ねると落ちる。1 本のキューに直列化し、
  // 失敗したら少し待って数回やり直す（Android Chrome で
  // 「GATT operation failed for unknown reason」が頻発したため）
  let gattChain = Promise.resolve();

  function gatt(fn) {
    const run = gattChain.then(fn, fn);
    gattChain = run.catch(() => {});
    return run;
  }

  async function write(key, bytes) {
    const s = state[key];
    if (!s.char) { toast(key + ' が使えません'); return; }
    const buf = new Uint8Array(bytes);
    log('tx', key, hex(buf));
    return gatt(async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (s.char.properties && s.char.properties.writeWithoutResponse) {
            await s.char.writeValueWithoutResponse(buf);
          } else {
            await s.char.writeValue(buf);
          }
          if (attempt > 1) log('info', key, `${attempt} 回目で書き込めました`);
          return;
        } catch (e) {
          if (attempt === 3) {
            log('info', key, '書き込み失敗: ' + (e.message || e));
            toast('書き込み失敗: ' + (e.message || e));
            return;
          }
          await new Promise((r) => setTimeout(r, 60 * attempt));
        }
      }
    });
  }

  /** 読み出しも同じキューに載せる */
  function readChar(key) {
    const s = state[key];
    if (!s.char) return Promise.reject(new Error(key + ' が使えません'));
    return gatt(() => s.char.readValue());
  }

  // ---------------------------------------------------------------- 実験
  $('btnTarget').addEventListener('click', () => {
    const x = Number($('tX').value) | 0;
    const y = Number($('tY').value) | 0;
    const angle = Number($('tAngle').value) | 0;
    const buf = new Uint8Array(13);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, 0x03);
    dv.setUint8(1, 0);      // 制御識別値
    dv.setUint8(2, 5);      // タイムアウト 5 秒
    dv.setUint8(3, 0);      // 移動タイプ
    dv.setUint8(4, 80);     // 最大速度
    dv.setUint8(5, 0);      // 速度変化タイプ
    dv.setUint8(6, 0);
    dv.setUint16(7, Math.max(0, Math.min(0xffff, x)), true);
    dv.setUint16(9, Math.max(0, Math.min(0xffff, y)), true);
    dv.setUint16(11, Math.max(0, Math.min(0x1fff, angle)), true);
    $('motorResult').textContent = '目標指定の応答: 待っています…';
    write('motor', Array.from(buf));
  });

  $('btnStop').addEventListener('click', () => write('motor', [0x01, 0x01, 1, 0, 0x02, 1, 0]));

  $('btnIdCfg').addEventListener('click', () => {
    const interval = Math.max(0, Math.min(255, Math.round(Number($('cfgInterval').value) / 10)));
    const cond = Math.max(0, Math.min(255, Number($('cfgCond').value) | 0));
    write('config', [0x18, 0x00, interval, cond]);
  });

  // ---- 走らせながらの通知テスト ----------------------------------------
  // 止まったままだと「変化があったときのみ」の設定では何も来ないので、
  // 設定を書くたびに必ず座標が変わるよう前後に動かして数える。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ID_TEST = [
    { interval: 0, cond: 0xff },
    { interval: 0, cond: 0x01 },
    { interval: 0, cond: 0x00 },
    { interval: 100, cond: 0x00 },
    { interval: 100, cond: 0x01 },
  ];

  $('btnIdTest').addEventListener('click', async () => {
    if (!state.id.char) { toast('先に接続してください'); return; }
    const btn = $('btnIdTest');
    const out = $('idTest');
    const label = btn.textContent;
    btn.disabled = true;
    // まず、いまマットの上にいるかを目標指定の応答で確かめる。
    // 載っていない状態で「0 件」を集めても意味がないため
    btn.textContent = 'マットの上か確認中…';
    const x = Number($('tX').value) | 0, y = Number($('tY').value) | 0;
    const reason = await new Promise((resolve) => {
      motorWaiter = resolve;
      setTimeout(() => { if (motorWaiter === resolve) { motorWaiter = null; resolve(null); } }, 9000);
      const buf = new Uint8Array(13);
      const dv = new DataView(buf.buffer);
      dv.setUint8(0, 0x03); dv.setUint8(2, 8); dv.setUint8(4, 80);
      dv.setUint16(7, Math.max(0, Math.min(0xffff, x)), true);
      dv.setUint16(9, Math.max(0, Math.min(0xffff, y)), true);
      write('motor', Array.from(buf));
    });

    const lines = [];
    if (reason === 0) {
      lines.push(`マット確認: 目標 (${x}, ${y}) に到達（理由0）。読めている状態でテストします`);
    } else if (reason === null) {
      lines.push('マット確認: 応答が返りませんでした。そのまま続けます');
    } else {
      lines.push(`マット確認: 理由${reason} が返りました。`
        + 'マットの上に置いていないか、読めていない状態です。結果は参考程度に');
    }
    out.textContent = lines.join('\n');

    for (let i = 0; i < ID_TEST.length; i++) {
      const t = ID_TEST[i];
      btn.textContent = `テスト中… ${i + 1}/${ID_TEST.length}`;
      await write('config', [0x18, 0x00, Math.round(t.interval / 10), t.cond]);
      await sleep(250);

      const s = state.id;
      const before = s.nListener + s.nOnchar;
      const beforeValid = s.nValid;

      // 通知を待つのと並行して、走っているあいだ読み出しも試す。
      // 止まっているときの読み出しは 0x00 しか返らなかったが、
      // 読み取り中なら値が入るかもしれない（入るなら定期読み出しで代用できる）
      let polls = 0, hits = 0, lastRead = '';
      let polling = $('pollWhileDriving').checked;
      const poller = (async () => {
        while (polling) {
          try {
            const v = await readChar('id');
            const b = new Uint8Array(v.buffer);
            polls++;
            if (b.length && (b[0] === 0x01 || b[0] === 0x02)) { hits++; lastRead = hex(b); }
          } catch (e) { polls++; }
          await sleep(120);
        }
      })();

      await write('motor', [0x01, 0x01, 1, 20, 0x02, 1, 20]);   // 前進
      await sleep(700);
      await write('motor', [0x01, 0x01, 2, 20, 0x02, 2, 20]);   // 後退
      await sleep(700);
      await write('motor', [0x01, 0x01, 1, 0, 0x02, 1, 0]);     // 停止
      await sleep(300);
      polling = false;
      await poller;

      const got = (s.nListener + s.nOnchar) - before;
      const valid = s.nValid - beforeValid;
      lines.push(`間隔${t.interval}ms / 条件0x${t.cond.toString(16).padStart(2, '0')}: `
        + `通知 ${got} 件（うち位置ID ${valid} 件）`
        + (polls ? ` / 走行中の読み出し ${hits}/${polls} 件` : '')
        + (got ? ` / 最後の通知 ${s.last}` : '')
        + (hits ? ` / 読めた値 ${lastRead}` : ''));
      out.textContent = lines.join('\n');
    }

    btn.textContent = label;
    btn.disabled = false;
    const gotValid = lines.some((l) => /うち位置ID [1-9]/.test(l));
    const gotRead = lines.some((l) => /読み出し [1-9]/.test(l));
    const gotEmpty = lines.some((l) => /通知 [1-9]/.test(l)) && !gotValid;
    lines.push(gotValid
      ? '→ 位置IDが届く設定が見つかりました。その設定を使えば座標が取れます'
      : gotRead
        ? '→ 通知は駄目ですが、走行中の読み出しでは値が取れました。'
          + '定期的に読み出す形にすれば位置IDを追えます'
        : (gotEmpty
          ? '→ 通知は来ますが中身が空（0x00）で、位置IDになっていません。'
            + '読み出しを有効にしている場合、その反射を数えているだけの可能性があります。'
          : '→ 通知が一件も来ませんでした。')
          + '別のブラウザ（Android Chrome / PC の Chrome）で同じページを試すと、'
          + 'ブラウザ側の問題かどうかが切り分けられます');
    out.textContent = lines.join('\n');
  });

  // 目標指定で走っている最中の位置IDを見る。応答理由 0 で「キューブは読めていた」
  // ことが確定するので、そのあいだの通知が何なのかを突き合わせられる
  $('btnTargetWatch').addEventListener('click', async () => {
    if (!state.id.char) { toast('先に接続してください'); return; }
    const btn = $('btnTargetWatch');
    const out = $('targetWatch');
    const label = btn.textContent;
    btn.disabled = true;
    out.textContent = '通知を有効にしています…';

    await write('config', [0x18, 0x00, 0, 0xff]);
    await sleep(300);

    const s = state.id;
    const before = s.nListener + s.nOnchar;
    const beforeValid = s.nValid;
    const seen = [];
    const spy = (ev) => {
      const b = new Uint8Array(ev.target.value.buffer);
      if (seen.length < 8) seen.push(`${hex(b)} (${b.length}バイト)`);
    };
    s.char.addEventListener('characteristicvaluechanged', spy);

    const x = Number($('tX').value) | 0, y = Number($('tY').value) | 0;
    btn.textContent = '走行中…';
    const t0 = Date.now();
    const reason = await new Promise((resolve) => {
      motorWaiter = resolve;
      setTimeout(() => { if (motorWaiter === resolve) { motorWaiter = null; resolve(null); } }, 12000);
      const buf = new Uint8Array(13);
      const dv = new DataView(buf.buffer);
      dv.setUint8(0, 0x03); dv.setUint8(2, 10); dv.setUint8(4, 80);
      dv.setUint16(7, Math.max(0, Math.min(0xffff, x)), true);
      dv.setUint16(9, Math.max(0, Math.min(0xffff, y)), true);
      write('motor', Array.from(buf));
    });

    s.char.removeEventListener('characteristicvaluechanged', spy);
    btn.textContent = label;
    btn.disabled = false;

    const got = (s.nListener + s.nOnchar) - before;
    const valid = s.nValid - beforeValid;
    const lines = [
      `目標 (${x}, ${y}) / 走行 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`,
      `応答理由: ${reason === null ? '返らなかった' : reason
        + (reason === 0 ? '（正常終了＝キューブはマットを読めていた）' : '')}`,
      `走行中の位置ID通知: ${got} 件（うち位置ID ${valid} 件）`,
      seen.length ? '中身: ' + seen.join(' / ') : '中身: 届かず',
    ];
    lines.push(reason === 0 && valid === 0
      ? '→ キューブは読めていたのに、位置IDの中身は返っていません。'
        + 'この個体・この経路では位置IDをそのまま取れないと考えるのが妥当です'
      : valid > 0
        ? '→ 位置IDが取れました'
        : '→ 応答理由が 0 ではないので、マットの上で試し直してください');
    out.textContent = lines.join('\n');
  });

  $('btnReadAll').addEventListener('click', async () => {
    for (const c of CHARS) {
      const s = state[c.key];
      if (!s.char) continue;
      try {
        const v = await readChar(c.key);
        const b = new Uint8Array(v.buffer);
        log('rx', c.key + '(read)', `${hex(b)}  ${describe(c.key, b)}`);
      } catch (e) {
        log('info', c.key, '読み出し不可: ' + (e.message || e));
      }
    }
    toast('読み出しを試しました。ログを見てください');
  });

  $('btnClearLog').addEventListener('click', () => {
    logLines.length = 0;
    $('log').textContent = '';
  });

  $('btnCopyLog').addEventListener('click', async () => {
    const text = logLines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('ログをコピーしました');
    } catch (e) {
      // クリップボードが使えない環境向けに、選択できる形で出す
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'copy-area';
      $('log').parentNode.appendChild(ta);
      ta.select();
      toast('コピーできないので、下の欄から手で選んでください');
    }
  });
})();
