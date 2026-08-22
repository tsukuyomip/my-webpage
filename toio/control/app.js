/* toio コントロールパネル UI */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const T = window.Toio;

  // ---------------------------------------------------------------- 状態
  const cubes = [];
  let selected = null;
  const trails = new WeakMap();

  // 読み取りセンサーの実績。マットの模様を読めているかを目で確かめられるように、
  // 最後に読めた値と回数を、マットから外れたあとも残しておく。
  const readStats = new WeakMap();  // cube -> {pos, posMissed, std, stdMissed, lastText, lastAt}

  function statsOf(cube) {
    let s = readStats.get(cube);
    if (!s) {
      s = { pos: 0, posMissed: 0, std: 0, stdMissed: 0, lastText: null, lastAt: 0, since: Date.now() };
      readStats.set(cube, s);
    }
    return s;
  }

  const MATS = {
    ring: { name: 'リング', minX: 45, minY: 45, maxX: 455, maxY: 455 },
    colortile: { name: 'カラータイル', minX: 545, minY: 45, maxX: 955, maxY: 455 },
    simple: { name: 'シンプルプレイマット', minX: 98, minY: 142, maxX: 402, maxY: 358 },
    dev1: { name: '開発用#1', minX: 34, minY: 35, maxX: 339, maxY: 250 },
    dev2: { name: '開発用#2', minX: 34, minY: 251, maxX: 339, maxY: 466 },
    dev3: { name: '開発用#3', minX: 34, minY: 467, maxX: 339, maxY: 682 },
    dev4: { name: '開発用#4', minX: 34, minY: 683, maxX: 339, maxY: 898 },
  };

  const autoMat = { name: '自動', minX: 0, minY: 0, maxX: 500, maxY: 500 };

  function currentMat() {
    const v = $('matSelect').value;
    return v === 'auto' ? autoMat : MATS[v];
  }

  // ---- 推測航法（マットなしで軌跡を見るモード） ----------------------
  // モーターへの指示を積算して位置を推定する。単位は mm、角度は度で
  // 位置IDと同じ向き（x が右、y が下、0°が +x 方向で時計回りに増える）。
  const estimates = new WeakMap();  // cube -> {x, y, angle}
  const estTrails = new WeakMap();  // cube -> [[x, y], ...]

  function isDeadReckoning() {
    return $('trailSource').value === 'dead';
  }

  function estimateOf(cube) {
    let e = estimates.get(cube);
    if (!e) { e = { x: 0, y: 0, angle: 0 }; estimates.set(cube, e); }
    return e;
  }

  let drLast = performance.now();

  // 実機のヨー角を向きに使うときの状態。IMU の符号の向きは仕様から読み取れないので
  // 「指示した旋回方向」と「ヨーの変化」を突き合わせて自動で判定する。
  const yawTrack = new WeakMap(); // cube -> {prev, accum, base}
  let yawSign = 0;                // 0 = 未判定
  let yawScore = 0;
  let headingSource = 'モーター推定'; // 地図に出す「いま何で向きを出しているか」

  /** 姿勢角からヨー（度）を取り出す。クォータニオン形式にも対応する */
  function yawOf(cube) {
    const a = cube.attitude;
    if (!a) return null;
    if (cube.attitudeAt && Date.now() - cube.attitudeAt > 1500) return null; // 古い
    return a.format === 2 ? quatToEuler(a).yaw : a.yaw;
  }

  function resetYawTracking() {
    for (const c of cubes) yawTrack.delete(c);
  }

  function stepDeadReckoning() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - drLast) / 1000); // タブが止まっていた分は捨てる
    drLast = now;
    const k = Number($('drScale').value) || 1;
    const tread = Number($('drTread').value) || 27;
    // 'auto' は姿勢角が来ていればそれを使い、来ていなければモーター推定に落ちる
    const useYaw = $('drHeading').value !== 'motor';
    const manual = $('drYawSign').value;
    let yawUsed = false;

    for (const cube of cubes) {
      if (!cube.connected) continue;
      const s = cube.speedEstimate || { left: 0, right: 0 };
      const vl = s.left * k, vr = s.right * k;     // mm/s
      const v = (vl + vr) / 2;
      // 画面は y が下向きなので、左が速いほど時計回り（角度が増える）
      const omega = (vl - vr) / tread;             // rad/s
      const e = estimateOf(cube);

      const yaw = useYaw ? yawOf(cube) : null;
      if (yaw !== null) {
        yawUsed = true;
        let t = yawTrack.get(cube);
        if (!t) { t = { prev: yaw, accum: 0, base: e.angle }; yawTrack.set(cube, t); }
        let d = yaw - t.prev;
        if (d > 180) d -= 360; else if (d < -180) d += 360; // 180/-180 のまたぎ
        t.prev = yaw;
        t.accum += d;

        // 旋回を指示しているあいだに符号を突き合わせる
        if (Math.abs(vl - vr) > 10 && Math.abs(d) > 0.3) {
          yawScore += Math.sign(Math.sign(vl - vr) * d);
          if (Math.abs(yawScore) >= 6) yawSign = Math.sign(yawScore);
        }
        const sign = manual === 'auto' ? (yawSign || 1) : Number(manual);
        e.angle = t.base + sign * t.accum;
      } else {
        if (!s.left && !s.right) continue;
        e.angle = e.angle + omega * dt * 180 / Math.PI;
      }
      e.angle = ((e.angle % 360) + 360) % 360;
      const rad = e.angle * Math.PI / 180;
      e.x += v * dt * Math.cos(rad);
      e.y += v * dt * Math.sin(rad);

      const tr = estTrails.get(cube) || [];
      const last = tr[tr.length - 1];
      if (!last || Math.hypot(e.x - last[0], e.y - last[1]) > 1) {
        tr.push([e.x, e.y]);
        if (tr.length > 1200) tr.shift();
        estTrails.set(cube, tr);
      }
      if (cube === selected && isDeadReckoning()) syncReadouts();
    }

    if (!useYaw) {
      headingSource = 'モーター推定';
      $('drYawStatus').textContent = '';
    } else if (!yawUsed) {
      headingSource = 'モーター推定';
      $('drYawStatus').textContent = '姿勢角の通知待ち → モーター推定';
    } else {
      headingSource = 'ヨー';
      const sign = manual === 'auto' ? (yawSign || 1) : Number(manual);
      $('drYawStatus').textContent = `ヨー使用中（符号 ${sign > 0 ? '+' : '−'}`
        + `${manual === 'auto' ? (yawSign ? '・自動判定済' : '・判定中') : ''}）`;
    }
  }

  setInterval(stepDeadReckoning, 40);

  /** 姿勢角の通知を有効にする。ヨーを向きに使うときに必要 */
  function enableAttitude(cube) {
    if (!cube.connected) return;
    const p = cube.setAttitudeDetection(Number($('attFormat').value) || 1,
      Number($('attInterval').value) || 100, Number($('attCondition').value) || 0);
    if (p && p.catch) p.catch(() => {});
  }

  /** 姿勢角を使う設定なら、接続中のキューブに通知を有効化させる */
  function ensureAttitude(notify) {
    if ($('drHeading').value === 'motor') return;
    for (const c of cubes) enableAttitude(c);
    if (notify && cubes.length) {
      toast('姿勢角の通知を有効にしました（ファームウェアが 2.3.0 以上必要です）');
    }
  }

  $('drHeading').addEventListener('change', () => {
    resetYawTracking();
    yawScore = 0;
    yawSign = 0;
    ensureAttitude(true);
  });

  $('drYawSign').addEventListener('change', resetYawTracking);

  function updateTrailSourceUI() {
    const dead = isDeadReckoning();
    $('drOptions').classList.toggle('hidden', !dead);
    $('drHint').classList.toggle('hidden', !dead);
    $('matSelectWrap').classList.toggle('hidden', dead);
    $('roEstCell').classList.toggle('hidden', !dead);
    $('roEstAngleCell').classList.toggle('hidden', !dead);
    drLast = performance.now();
    syncReadouts();
  }

  $('trailSource').addEventListener('change', () => {
    updateTrailSourceUI();
    if (isDeadReckoning()) ensureAttitude(true); // 向きにヨーを使えるようにしておく
  });

  /** 座標だけ原点に戻す（向きはそのまま）。軌跡も消す */
  function resetPosition() {
    for (const c of cubes) {
      const e = estimateOf(c);
      e.x = 0; e.y = 0;
      estTrails.set(c, []);
      trails.set(c, []);
    }
    syncReadouts();
  }

  /** 向きだけ 0° に戻す。ヨーを使っている場合は今の値を基準に取り直す */
  function resetHeading() {
    for (const c of cubes) estimateOf(c).angle = 0;
    resetYawTracking();
    syncReadouts();
  }

  /** 座標・向きの両方を戻す */
  function resetOdometry() {
    resetPosition();
    resetHeading();
  }

  $('btnDrReset').addEventListener('click', resetOdometry);
  $('btnMiniReset').addEventListener('click', (e) => {
    e.stopPropagation(); // ミニマップのドラッグと取り違えない
    resetOdometry();
  });

  // 推測航法の地図は、角度 0（＝リセット直後の向き）が画面の上に来るように
  // 表示だけ 90 度回す。0°（リセット直後の向き）を上として読めるようにするため。
  function drRotate(x, y) { return [y, -x]; }

  /** 推測航法モードでの表示範囲。実測の軌跡に合わせて広げる（回した後の座標で） */
  function deadView() {
    let minX = -150, minY = -150, maxX = 150, maxY = 150;
    for (const c of cubes) {
      const pts = (estTrails.get(c) || []).slice();
      const e = estimates.get(c);
      if (e) pts.push([e.x, e.y]);
      for (const p of pts) {
        const [x, y] = drRotate(p[0], p[1]);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const pad = 40;
    return { name: '推測航法', minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  /** コマンドの送信先 */
  function targets() {
    if ($('sendTarget').value === 'all') return cubes.filter((c) => c.connected);
    return selected && selected.connected ? [selected] : [];
  }

  /** 送信先すべてに同じ操作を流す */
  function send(fn) {
    const list = targets();
    if (!list.length) {
      toast('キューブが接続されていません');
      return;
    }
    for (const c of list) {
      try {
        const p = fn(c);
        // 書き込み失敗はログとトーストで見せるので、ここでは握りつぶす
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { console.error(e); }
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);'
        + 'background:#1c232c;border:1px solid #30363d;color:#e6edf3;padding:.5rem 1rem;'
        + 'border-radius:8px;font-size:.85rem;z-index:200;box-shadow:0 4px 16px rgba(0,0,0,.5);'
        + 'transition:opacity .3s;pointer-events:none;max-width:90vw;text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }

  // ------------------------------------------------------------ 接続まわり
  $('btnConnect').addEventListener('click', async () => {
    try {
      const cube = await T.requestCube();
      if (cubes.some((c) => c.id === cube.id && c.connected)) {
        toast('そのキューブは接続済みです');
        return;
      }
      $('btnConnect').disabled = true;
      $('btnConnect').textContent = '接続中…';
      hookCube(cube);
      await cube.connect();
      cubes.push(cube);
      selected = cube;
      if (isDeadReckoning() || miniState.level) enableAttitude(cube);
      renderTabs();
      syncReadouts();
      toast(cube.name + ' に接続しました');
    } catch (e) {
      if (e && e.name === 'NotFoundError') return; // ユーザーがキャンセル
      toast('接続失敗: ' + (e.message || e));
      console.error(e);
    } finally {
      $('btnConnect').disabled = false;
      $('btnConnect').textContent = 'キューブを接続';
    }
  });

  function hookCube(cube) {
    statsOf(cube);   // 接続した瞬間から「読めた 0 / 読めず 0」と出す
    estimates.set(cube, { x: 0, y: 0, angle: 0 });
    estTrails.set(cube, []);
    cube.on('log', (entry) => appendLog(cube, entry));
    cube.on('disconnect', () => {
      renderTabs();
      if (cube === selected) syncReadouts();
      toast(cube.name + ' が切断されました');
    });
    cube.on('position', (p) => {
      const s = statsOf(cube);
      s.pos++;
      s.lastText = `位置ID ${p.x}, ${p.y} (${p.angle}°)`;
      s.lastAt = Date.now();
      const tr = trails.get(cube) || [];
      tr.push([p.x, p.y]);
      if (tr.length > 600) tr.shift();
      trails.set(cube, tr);
      if (cube === selected) syncReadouts();
    });
    cube.on('standard', (v) => {
      const s = statsOf(cube);
      s.std++;
      s.lastText = `標準ID ${v.value} (${v.angle}°)`;
      s.lastAt = Date.now();
    });
    cube.on('positionMissed', () => { statsOf(cube).posMissed++; });
    cube.on('standardMissed', () => { statsOf(cube).stdMissed++; });
    for (const ev of ['standard', 'positionMissed', 'standardMissed', 'motion', 'magnet',
      'attitude', 'button', 'motorSpeed', 'protocolVersion']) {
      cube.on(ev, () => { if (cube === selected) syncReadouts(); });
    }
    // 電池残量はタブのラベルにも出しているので、タブごと描き直す
    cube.on('battery', () => { renderTabs(); if (cube === selected) syncReadouts(); });
    cube.on('collision', () => { if (cube === selected) flash('evCollision'); });
    cube.on('doubleTap', () => { if (cube === selected) flash('evDoubleTap'); });
    cube.on('motorResponse', (r) => {
      if (r.reason !== 0) toast(`目標指定の応答: ${r.reasonText}`);
    });
  }

  function flash(id) {
    const el = $(id);
    el.classList.add('fire');
    setTimeout(() => el.classList.remove('fire'), 400);
  }

  function renderTabs() {
    const wrap = $('cubeTabs');
    wrap.textContent = '';
    for (const cube of cubes) {
      const tab = document.createElement('div');
      tab.className = 'cube-tab' + (cube === selected ? ' active' : '') + (cube.connected ? '' : ' offline');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const label = document.createElement('span');
      label.textContent = cube.name + (cube.battery !== null ? ` ${cube.battery}%` : '');
      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '✕';
      close.title = '切断';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cube.connected) cube.disconnect();
        const i = cubes.indexOf(cube);
        if (i >= 0) cubes.splice(i, 1);
        if (selected === cube) selected = cubes[0] || null;
        renderTabs();
        syncReadouts();
      });
      tab.append(dot, label, close);
      tab.addEventListener('click', () => { selected = cube; renderTabs(); syncReadouts(); });
      wrap.appendChild(tab);
    }
  }

  // ---------------------------------------------------------------- 表示
  function syncReadouts() {
    const c = selected;
    const set = (id, v) => { $(id).textContent = v === undefined || v === null ? '—' : v; };

    set('roPos', c && c.position ? `${c.position.x}, ${c.position.y}` : (c && !c.onMat ? 'マット外' : null));
    set('roAngle', c && c.position ? c.position.angle + '°' : null);
    set('roSensor', c && c.position ? `${c.position.sensorX}, ${c.position.sensorY}` : null);
    set('roStd', c && c.standardId ? `${c.standardId.value} (${c.standardId.angle}°)` : null);

    // マット外の今この瞬間ではなく、「これまでに読めたことがあるか」を出す。
    // 一瞬でも読めていれば、マット自体は読める＝設定や範囲の問題だと切り分けられる。
    const st = c && readStats.get(c);
    if (st && st.lastAt) {
      const sec = Math.floor((Date.now() - st.lastAt) / 1000);
      set('roLastRead', `${st.lastText} / ${sec < 1 ? 'たった今' : sec + '秒前'}`);
    } else {
      set('roLastRead', c ? 'まだ一度も読めていません' : null);
    }
    set('roReadStats', st
      ? `読めた ${st.pos + st.std} / 読めず ${st.posMissed + st.stdMissed}`
      : null);

    const m = c && c.motion;
    set('roFlat', m ? (m.flat ? '水平' : '傾いている') : null);
    set('roPosture', m ? m.postureName : null);
    set('roShake', m ? m.shake : null);
    set('roButton', c ? (c.button ? '押されている' : '離されている') : null);
    set('roBattery', c && c.battery !== null ? c.battery + '%' : null);
    set('roProto', c ? c.protocolVersion : null);

    const g = c && c.magnet;
    set('roMagId', g ? g.id : null);
    set('roMagForce', g && g.force !== null ? g.force : null);
    set('roMagDir', g && g.x !== null ? `${g.x}, ${g.y}, ${g.z}` : null);

    const a = c && c.attitude;
    if (a && a.format === 2) {
      const e = quatToEuler(a);
      set('roRoll', e.roll.toFixed(1) + '°');
      set('roPitch', e.pitch.toFixed(1) + '°');
      set('roYaw', e.yaw.toFixed(1) + '°');
      set('roQuat', `${a.w}, ${a.x}, ${a.y}, ${a.z}`);
    } else if (a) {
      set('roRoll', a.roll + '°');
      set('roPitch', a.pitch + '°');
      set('roYaw', a.yaw + '°');
      set('roQuat', null);
    } else {
      set('roRoll', null); set('roPitch', null); set('roYaw', null); set('roQuat', null);
    }

    set('roMotorSpeed', c && c.motorSpeed ? `左 ${c.motorSpeed.left} / 右 ${c.motorSpeed.right}` : null);

    const est = c && estimates.get(c);
    set('roEst', est ? `${Math.round(est.x)}, ${Math.round(est.y)}` : null);
    set('roEstAngle', est ? `${Math.round((est.angle + 360) % 360)}°` : null);
  }

  function quatToEuler(q) {
    const { w, x, y, z } = q;
    const sinr = 2 * (w * x + y * z);
    const cosr = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr, cosr) * 180 / Math.PI;
    let sinp = 2 * (w * y - z * x);
    sinp = Math.max(-1, Math.min(1, sinp));
    const pitch = Math.asin(sinp) * 180 / Math.PI;
    const siny = 2 * (w * z + x * y);
    const cosy = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny, cosy) * 180 / Math.PI;
    return { roll, pitch, yaw };
  }

  /** 選択中のキューブの姿勢角を roll/pitch/yaw（度）で返す。形式の違いはここで吸収する */
  function eulerOfSelected() {
    const a = selected && selected.attitude;
    if (!a) return null;
    if (a.format === 2) return quatToEuler(a);
    return { roll: a.roll, pitch: a.pitch, yaw: a.yaw };
  }

  // ---------------------------------------------------------------- ログ
  const logEl = $('log');
  function appendLog(cube, entry) {
    if ($('logPause').checked) return;
    if (entry.dir === 'tx' && !$('logTx').checked) return;
    if (entry.dir === 'rx' && !$('logRx').checked) return;

    const line = document.createElement('div');
    line.className = 'log-line ' + entry.dir;
    const t = entry.time;
    const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      + `:${String(t.getSeconds()).padStart(2, '0')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
    const cells = [
      ['t', stamp],
      ['d', entry.dir.toUpperCase()],
      ['c', entry.char || ''],
      ['b', entry.bytes ? T.toHex(entry.bytes) : ''],
      ['n', entry.note || ''],
    ];
    for (const [cls, text] of cells) {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      line.appendChild(s);
    }
    if (cubes.length > 1) line.title = cube.name;
    const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20;
    logEl.appendChild(line);
    while (logEl.childElementCount > 400) logEl.removeChild(logEl.firstChild);
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  $('btnLogClear').addEventListener('click', () => { logEl.textContent = ''; });

  // ---------------------------------------------------------------- タブ
  document.querySelectorAll('.tabs').forEach((tabs) => {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      const panel = tabs.parentElement;
      panel.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      panel.querySelectorAll('.tabpane').forEach((p) => {
        p.classList.toggle('active', p.dataset.pane === btn.dataset.tab);
      });
      // ジョイスティックを掴んだままタブを離れると走り続けてしまう
      joyRelease();
    });
  });

  function activeMotorTab() {
    const el = document.querySelector('[data-tabs="motor"] .tab.active');
    return el ? el.dataset.tab : 'basic';
  }

  // ------------------------------------------------------------ モーター
  const mL = $('mL'), mR = $('mR');

  function pushMotor() {
    const l = Number(mL.value), r = Number(mR.value);
    $('outL').textContent = l;
    $('outR').textContent = r;
    send((c) => c.motor(l, r));
  }

  mL.addEventListener('input', () => {
    if ($('linkLR').checked) mR.value = mL.value;
    pushMotor();
  });
  mR.addEventListener('input', () => {
    if ($('linkLR').checked) mL.value = mR.value;
    pushMotor();
  });

  function setSliders(l, r) {
    mL.value = l; mR.value = r;
    $('outL').textContent = l; $('outR').textContent = r;
  }

  document.querySelectorAll('.dpad .dir').forEach((btn) => {
    const l = Number(btn.dataset.l), r = Number(btn.dataset.r);
    let pressed = false;
    const start = (e) => {
      e.preventDefault();
      pressed = true;
      setSliders(l, r);
      send((c) => c.motor(l, r));
    };
    // 押していないときの pointerleave（ただのホバー外し）で停止を投げない
    const end = () => {
      if (!pressed) return;
      pressed = false;
      setSliders(0, 0);
      send((c) => c.stop());
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointerleave', end);
    btn.addEventListener('pointercancel', end);
  });

  $('btnStop').addEventListener('click', () => { setSliders(0, 0); send((c) => c.stop()); });

  $('btnMotorTimed').addEventListener('click', () => {
    const d = Number($('mDuration').value);
    send((c) => c.motorTimed(Number(mL.value), Number(mR.value), d));
  });

  // キーボード運転
  const keysDown = new Set();
  function keyDrive() {
    if (!$('keyDrive').checked) return;
    const fast = keysDown.has('shift');
    const base = fast ? 100 : 55;
    const turn = fast ? 70 : 40;
    let l = 0, r = 0;
    if (keysDown.has('up')) { l += base; r += base; }
    if (keysDown.has('down')) { l -= base; r -= base; }
    if (keysDown.has('left')) { l -= turn; r += turn; }
    if (keysDown.has('right')) { l += turn; r -= turn; }
    l = Math.max(-115, Math.min(115, l));
    r = Math.max(-115, Math.min(115, r));
    setSliders(l, r);
    send((c) => c.motor(l, r));
  }

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ShiftLeft: 'shift', ShiftRight: 'shift',
  };

  window.addEventListener('keydown', (e) => {
    if (!$('keyDrive').checked) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); keysDown.clear(); setSliders(0, 0); send((c) => c.stop()); return; }
    const k = KEYMAP[e.code];
    if (!k || keysDown.has(k)) return;
    e.preventDefault();
    keysDown.add(k);
    keyDrive();
  });

  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    keysDown.delete(k);
    keyDrive();
  });

  window.addEventListener('blur', () => {
    joyRelease();
    if (keysDown.size) { keysDown.clear(); setSliders(0, 0); send((c) => c.stop()); }
  });

  // ------------------------------------ ジョイスティック（ラジコン方式・2本）
  // 左スティックが前後、右スティックが旋回。2本同時に操作できる。
  const joy = { fwd: 0, turn: 0, l: 0, r: 0, sent: null, timer: 0, active: 0 };

  const bindOut = (id, outId, fmt) => {
    const el = $(id);
    const upd = () => { $(outId).textContent = fmt ? fmt(el.value) : el.value; };
    el.addEventListener('input', () => { upd(); joyCompute(); joyFlush(); });
    upd();
  };

  bindOut('joyMax', 'outJoyMax');
  bindOut('joyTurn', 'outJoyTurn');
  bindOut('joyExpo', 'outJoyExpo', (v) => v + '%');
  bindOut('joyDead', 'outJoyDead', (v) => v + '%');
  for (const id of ['joyInvert', 'joyRcReverse']) {
    $(id).addEventListener('change', () => { joyCompute(); joyFlush(); });
  }

  /** 倒し量(-1〜1)を不感帯と反応カーブに通す */
  function shape(v) {
    const dead = Number($('joyDead').value) / 100;
    const a = Math.abs(v);
    if (a <= dead) return 0;
    // 不感帯の外側を 0〜1 に伸ばし直してから、カーブをかける
    const t = (a - dead) / (1 - dead);
    const e = Number($('joyExpo').value) / 100;
    const shaped = (1 - e) * t + e * t * t * t;
    return Math.sign(v) * shaped;
  }

  /** 2本のスティックの状態から左右のモーター速度を作る */
  function joyCompute() {
    const fwd = shape(joy.fwd) * Number($('joyMax').value) * ($('joyInvert').checked ? -1 : 1);
    let turn = shape(joy.turn) * Number($('joyTurn').value);
    // 後退中は舵を逆に効かせる。ラジコンで下がるときと同じ感覚にするため
    // （その場旋回のときは前後が 0 なので反転しない）
    if (fwd < 0 && $('joyRcReverse').checked) turn = -turn;
    let l = fwd + turn, r = fwd - turn;
    // 片側だけ頭打ちにすると曲がり方が変わるので、比を保ったまま縮める
    const peak = Math.max(Math.abs(l), Math.abs(r));
    if (peak > 115) { l = l * 115 / peak; r = r * 115 / peak; }
    // キューブが受け付ける速度は 0 か 8〜115 で、1〜7 を送っても動かない。
    // 0 でなければ最低 8 は出しておかないと、そのぶんが無反応の帯になる
    const atLeast8 = (v) => (v === 0 ? 0 : (Math.abs(v) < 8 ? Math.sign(v) * 8 : v));
    joy.l = atLeast8(Math.round(l));
    joy.r = atLeast8(Math.round(r));
    $('joyL').textContent = joy.l;
    $('joyR').textContent = joy.r;
    setSliders(joy.l, joy.r); // 「基本」タブのスライダーとも揃えておく
  }

  /** 値が変わったときだけ実際に送る */
  function joyFlush() {
    if (joy.sent && joy.sent[0] === joy.l && joy.sent[1] === joy.r) return;
    joy.sent = [joy.l, joy.r];
    send((c) => c.motor(joy.l, joy.r));
  }

  function joyTick(on) {
    if (on) {
      if (!joy.timer) joy.timer = setInterval(joyFlush, 50); // BLE が詰まらない間隔
    } else if (!joy.active && joy.timer) {
      clearInterval(joy.timer);
      joy.timer = 0;
    }
  }

  /**
   * 1本ぶんのスティックを組み立てる。
   * @param {string} axis 'y'=前後専用 / 'x'=旋回専用 / 'xy'=1本で両方
   */
  function setupStick(elId, knobId, axis) {
    const el = $(elId), knob = $(knobId);
    const lim = (v) => Math.max(-1, Math.min(1, v));
    let holding = false;

    const move = (e) => {
      const rect = el.getBoundingClientRect();
      const halfW = rect.width / 2, halfH = rect.height / 2;
      let dx = (e.clientX - (rect.left + halfW)) / halfW;
      let dy = (e.clientY - (rect.top + halfH)) / halfH;
      if (axis === 'xy') {
        const mag = Math.hypot(dx, dy);
        if (mag > 1) { dx /= mag; dy /= mag; } // 円の外は縁に貼りつける
        knob.style.transform = `translate(${dx * halfW * 0.55}px, ${dy * halfH * 0.55}px)`;
        joy.turn = dx;
        joy.fwd = -dy;
      } else if (axis === 'y') {
        dy = lim(dy);
        knob.style.transform = `translateY(${dy * halfH * 0.55}px)`;
        joy.fwd = -dy; // 上を正にする
      } else {
        dx = lim(dx);
        knob.style.transform = `translateX(${dx * halfW * 0.55}px)`;
        joy.turn = dx;
      }
      joyCompute();
    };

    const zero = () => {
      knob.style.transform = '';
      if (axis !== 'x') joy.fwd = 0;
      if (axis !== 'y') joy.turn = 0;
    };

    const release = () => {
      if (!holding) return;
      holding = false;
      joy.active--;
      el.classList.remove('active');
      if (!$('joyHold').checked) {
        zero();
        joyCompute();
        joyFlush();
      }
      joyTick(false);
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      holding = true;
      joy.active++;
      // 合成イベントなど、捕捉できないポインタでも操作自体は続けられるようにする
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      el.classList.add('active');
      move(e);
      joyFlush();
      joyTick(true);
    });
    el.addEventListener('pointermove', (e) => { if (holding) move(e); });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    return { release, reset: zero };
  }

  // 2本モードと1本モードのスティックは同時に置いておき、表示だけ切り替える
  const allSticks = [
    setupStick('stickFwd', 'stickFwdKnob', 'y'),
    setupStick('stickTurn', 'stickTurnKnob', 'x'),
    setupStick('stickSingle', 'stickSingleKnob', 'xy'),
  ];

  function joyRelease() {
    for (const s of allSticks) s.release();
  }

  function joyResetAll() {
    for (const s of allSticks) s.reset();
    joyCompute();
    joyFlush();
  }

  /** 選ばれているモードに表示を合わせる。初期表示にも使う */
  function applyJoyMode() {
    const dual = document.querySelector('input[name="joyMode"]:checked').value === 'dual';
    $('sticksDual').classList.toggle('hidden', !dual);
    $('sticksSingle').classList.toggle('hidden', dual);
    $('joyHint').textContent = dual
      ? '2本のスティックを同時に操作できます。倒した量に応じて連続的に変化し、離すと中央に戻ります。'
      : '1本で前後と旋回をまとめて操作します。倒した量に応じて連続的に変化し、離すと中央に戻ります。';
  }

  document.querySelectorAll('input[name="joyMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      applyJoyMode();
      joyRelease();
      joyResetAll(); // モードをまたいで動きっぱなしにならないようにする
    });
  });

  $('btnJoyStop').addEventListener('click', joyResetAll);

  // 目標指定
  function targetOptions() {
    return {
      controlId: Number($('oControlId').value),
      timeout: Number($('oTimeout').value),
      moveType: Number($('oMoveType').value),
      maxSpeed: Number($('oMaxSpeed').value),
      speedType: Number($('oSpeedType').value),
    };
  }

  $('btnMoveTo').addEventListener('click', () => {
    const t = {
      x: Number($('tX').value), y: Number($('tY').value),
      angle: Number($('tAngle').value), rotateType: Number($('tRotate').value),
    };
    send((c) => c.motorTarget(t, targetOptions()));
  });

  // 複数目標
  const multiTargets = [];

  function renderTargetList() {
    const ol = $('targetList');
    ol.textContent = '';
    multiTargets.forEach((t, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = `(${t.x}, ${t.y}) θ=${t.angle}° type=${t.rotateType}`;
      const del = document.createElement('button');
      del.className = 'btn ghost';
      del.textContent = '削除';
      del.addEventListener('click', () => { multiTargets.splice(i, 1); renderTargetList(); });
      li.append(span, del);
      ol.appendChild(li);
    });
  }

  $('btnMultiClear').addEventListener('click', () => { multiTargets.length = 0; renderTargetList(); });

  $('btnMultiRun').addEventListener('click', () => {
    if (!multiTargets.length) { toast('目標がありません'); return; }
    const o = Object.assign(targetOptions(), { append: $('mtAppend').checked });
    send((c) => c.motorMultiTarget(multiTargets, o));
  });

  // 加速度指定
  $('aSpeed').addEventListener('input', (e) => { $('outAccSpeed').textContent = e.target.value; });
  $('aAcc').addEventListener('input', (e) => { $('outAccAcc').textContent = e.target.value; });

  $('btnAccelRun').addEventListener('click', () => {
    const p = {
      speed: Number($('aSpeed').value),
      acceleration: Number($('aAcc').value),
      rotationSpeed: Number($('aRot').value),
      rotationDir: Number($('aRotDir').value),
      moveDir: Number($('aMoveDir').value),
      priority: Number($('aPriority').value),
      durationMs: Number($('aDuration').value),
    };
    send((c) => c.motorAcceleration(p));
  });

  // ---------------------------------------------------------------- ランプ
  function hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  const SWATCHES = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0080ff', '#8000ff', '#ff00ff', '#ffffff'];
  SWATCHES.forEach((hex) => {
    const b = document.createElement('button');
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('click', () => {
      $('lColor').value = hex;
      const { r, g, b: bl } = hexToRgb(hex);
      send((c) => c.light(r, g, bl, Number($('lDuration').value)));
    });
    $('lSwatches').appendChild(b);
  });

  $('btnLightOn').addEventListener('click', () => {
    const { r, g, b } = hexToRgb($('lColor').value);
    send((c) => c.light(r, g, b, Number($('lDuration').value)));
  });

  $('btnLightOff').addEventListener('click', () => send((c) => c.lightOff()));

  const scenario = [];

  function renderScenario() {
    const wrap = $('scenarioList');
    wrap.textContent = '';
    scenario.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'step-row';

      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = i + 1;

      const color = document.createElement('input');
      color.type = 'color';
      color.value = s.color;
      color.addEventListener('input', () => { s.color = color.value; });

      const dur = document.createElement('input');
      dur.type = 'number';
      dur.min = 10; dur.max = 2550; dur.step = 10;
      dur.value = s.durationMs;
      dur.addEventListener('input', () => { s.durationMs = Number(dur.value); });

      const unit = document.createElement('span');
      unit.className = 'idx';
      unit.textContent = 'ms';

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.addEventListener('click', () => { scenario.splice(i, 1); renderScenario(); });

      row.append(idx, color, dur, unit, del);
      wrap.appendChild(row);
    });
  }

  $('btnScenarioAdd').addEventListener('click', () => {
    if (scenario.length >= 29) { toast('ステップは最大 29 です'); return; }
    scenario.push({ color: $('lColor').value, durationMs: 300 });
    renderScenario();
  });

  $('btnScenarioRainbow').addEventListener('click', () => {
    scenario.length = 0;
    for (let i = 0; i < 12; i++) {
      const h = i * 30;
      scenario.push({ color: hslToHex(h, 100, 50), durationMs: 150 });
    }
    renderScenario();
  });

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
    return '#' + to(f(0)) + to(f(8)) + to(f(4));
  }

  $('btnScenarioRun').addEventListener('click', () => {
    if (!scenario.length) { toast('ステップがありません'); return; }
    const steps = scenario.map((s) => Object.assign(hexToRgb(s.color), { durationMs: s.durationMs }));
    const repeat = Number($('lRepeat').value);
    send((c) => c.lightScenario(steps, repeat));
  });

  // -------------------------------------------------------------- サウンド
  $('sVolume').addEventListener('input', (e) => { $('outVolume').textContent = e.target.value; });
  $('btnSoundStop').addEventListener('click', () => send((c) => c.soundStop()));

  T.SOUND_EFFECT.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `${i}: ${name}`;
    b.addEventListener('click', () => send((c) => c.soundEffect(i, Number($('sVolume').value))));
    $('seGrid').appendChild(b);
  });

  // 鍵盤。全音域を並べて横スクロールで辿る。押している間だけ鳴らす。
  const BLACK = [1, 3, 6, 8, 10];
  const DEFAULT_NOTE = 60; // C5

  // 押されている鍵を押した順に持つ。末尾が「いま鳴っている音」。
  // キューブは同時に 1 音しか鳴らせないので、複数押されたら最後の音を優先する。
  const held = [];

  function playHeld(entry) {
    // キューブ側は長さを指定して鳴らす方式しかないので、最長(2550ms)を
    // 繰り返し 255 回ぶん予約しておき、離したときに停止コマンドで止める
    send((c) => c.soundMidi(
      [{ note: entry.note, durationMs: 2550, volume: Number($('sVolume').value) }], 255));
  }

  function noteOn(pointerId, note, el) {
    if (held.some((h) => h.pointerId === pointerId)) return;
    const entry = { pointerId, note, el };
    held.push(entry);
    el.classList.add('on');
    playHeld(entry); // 新しい再生指示が前の音を上書きするので、止めてから鳴らす必要はない
  }

  function noteOff(pointerId) {
    const i = held.findIndex((h) => h.pointerId === pointerId);
    if (i < 0) return;
    const wasSounding = i === held.length - 1;
    held[i].el.classList.remove('on');
    held.splice(i, 1);
    if (!wasSounding) return; // 鳴っていない指を離しただけなら何もしない
    if (held.length) playHeld(held[held.length - 1]); // まだ押されている音に戻す
    else send((c) => c.soundStop());
  }

  function allNotesOff() {
    while (held.length) noteOff(held[0].pointerId);
  }

  function renderKeyboard() {
    const wrap = $('keyboard');
    wrap.textContent = '';
    for (let note = 0; note <= 127; note++) {
      const black = BLACK.includes(note % 12);
      const key = document.createElement('div');
      key.className = 'key' + (black ? ' black' : '');
      key.dataset.note = note;
      key.textContent = black ? '' : T.noteName(note);
      key.title = `${T.noteName(note)} (${note})`;
      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        noteOn(e.pointerId, note, key);
      });
      key.addEventListener('pointerup', (e) => noteOff(e.pointerId));
      key.addEventListener('pointerleave', (e) => noteOff(e.pointerId));
      // 横スクロールとして扱われたときはブラウザが pointercancel を投げてくる
      key.addEventListener('pointercancel', (e) => noteOff(e.pointerId));
      wrap.appendChild(key);
    }
    // 初期表示は C5 のあたり
    const target = wrap.querySelector(`[data-note="${DEFAULT_NOTE}"]`);
    if (target) wrap.scrollLeft = Math.max(0, target.offsetLeft - 12);
  }

  // 鍵の外で指を離した場合の取りこぼしを拾う
  window.addEventListener('pointerup', (e) => noteOff(e.pointerId));
  window.addEventListener('pointercancel', (e) => noteOff(e.pointerId));
  window.addEventListener('blur', allNotesOff);

  const melody = [];

  function renderMelody() {
    const wrap = $('melodyList');
    wrap.textContent = '';
    melody.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'step-row';

      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = i + 1;

      const note = document.createElement('input');
      note.type = 'number';
      note.min = 0; note.max = 128;
      note.value = m.note;

      const label = document.createElement('span');
      label.className = 'idx';
      label.textContent = T.noteName(m.note);
      note.addEventListener('input', () => {
        m.note = Number(note.value);
        label.textContent = T.noteName(m.note);
      });

      const dur = document.createElement('input');
      dur.type = 'number';
      dur.min = 10; dur.max = 2550; dur.step = 10;
      dur.value = m.durationMs;
      dur.addEventListener('input', () => { m.durationMs = Number(dur.value); });

      const vol = document.createElement('input');
      vol.type = 'number';
      vol.min = 0; vol.max = 255;
      vol.value = m.volume;
      vol.addEventListener('input', () => { m.volume = Number(vol.value); });

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.addEventListener('click', () => { melody.splice(i, 1); renderMelody(); });

      row.append(idx, note, label, dur, vol, del);
      wrap.appendChild(row);
    });
  }

  $('btnMelodyAdd').addEventListener('click', () => {
    if (melody.length >= 59) { toast('音は最大 59 です'); return; }
    melody.push({ note: 60, durationMs: 200, volume: Number($('sVolume').value) });
    renderMelody();
  });

  $('btnMelodyClear').addEventListener('click', () => { melody.length = 0; renderMelody(); });

  $('btnMelodyPreset').addEventListener('click', () => {
    melody.length = 0;
    [60, 62, 64, 65, 67, 69, 71, 72].forEach((n) => {
      melody.push({ note: n, durationMs: 180, volume: Number($('sVolume').value) });
    });
    renderMelody();
  });

  $('btnMelodyRun').addEventListener('click', () => {
    if (!melody.length) { toast('音がありません'); return; }
    const repeat = Number($('sRepeat').value);
    send((c) => c.soundMidi(melody, repeat));
  });

  // -------------------------------------------------------------- センサー
  $('btnMagApply').addEventListener('click', () => {
    send((c) => c.setMagnetDetection(
      Number($('magType').value), Number($('magInterval').value), Number($('magCondition').value)));
  });

  $('btnAttApply').addEventListener('click', () => {
    send((c) => c.setAttitudeDetection(
      Number($('attFormat').value), Number($('attInterval').value), Number($('attCondition').value)));
  });

  // ---------------------------------------------------------------- 設定
  document.querySelectorAll('[data-cfg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.cfg) {
        case 'flat': send((c) => c.setFlatThreshold(Number($('cfgFlat').value))); break;
        case 'collision': send((c) => c.setCollisionThreshold(Number($('cfgCollision').value))); break;
        case 'doubletap': send((c) => c.setDoubleTapInterval(Number($('cfgDoubleTap').value))); break;
        case 'idnotify': send((c) => c.setIdNotification(
          Number($('cfgIdInterval').value), Number($('cfgIdCondition').value))); break;
        case 'idmissed': send((c) => c.setIdMissedNotification(Number($('cfgIdMissed').value))); break;
        case 'version': send((c) => c.requestProtocolVersion()); break;
      }
    });
  });

  $('cfgMotorSpeed').addEventListener('change', (e) => {
    send((c) => c.setMotorSpeedFeedback(e.target.checked));
  });

  // ------------------------------------------------------------ 生コマンド
  $('btnRawSend').addEventListener('click', () => {
    let bytes;
    try {
      bytes = T.parseHex($('rawBytes').value);
    } catch (e) {
      toast(e.message);
      return;
    }
    if (!bytes.length) { toast('バイト列が空です'); return; }
    send((c) => c.write($('rawChar').value, bytes, { note: '生コマンド' }));
  });

  $('btnRawRead').addEventListener('click', () => {
    send((c) => c.read($('rawChar').value).catch((e) => toast('読み出し失敗: ' + (e.message || e))));
  });

  // ------------------------------------------------------------ マット描画
  const canvas = $('matCanvas');
  const ctx = canvas.getContext('2d');
  const miniCanvas = $('miniCanvas');
  const miniCtx = miniCanvas.getContext('2d');
  const miniAttCanvas = $('miniAttCanvas');
  const miniAttCtx = miniAttCanvas.getContext('2d');

  // ---- ミニマップ（浮かせて表示する軌跡） ----------------------------
  const MINI_SIZES = [140, 180, 240];
  const miniEl = $('minimap');
  const miniState = { visible: false, size: 1, left: null, top: null, level: false, solid: false };

  try {
    Object.assign(miniState, JSON.parse(localStorage.getItem('toio-minimap') || '{}'));
  } catch (e) { /* 壊れていたら初期値のまま */ }

  function saveMiniState() {
    try { localStorage.setItem('toio-minimap', JSON.stringify(miniState)); } catch (e) { /* noop */ }
  }

  function applyMiniState() {
    miniEl.classList.toggle('hidden', !miniState.visible);
    miniEl.style.width = MINI_SIZES[miniState.size % MINI_SIZES.length] + 'px';
    miniAttCanvas.classList.toggle('hidden', !miniState.level);
    $('minimapBody').classList.toggle('with-level', !!miniState.level);
    $('btnMiniLevel').classList.toggle('on', !!miniState.level);
    // solid のときは下を透かさず、薄くもしない
    miniEl.classList.toggle('solid', !!miniState.solid);
    $('btnMiniSolid').classList.toggle('on', !miniState.solid);
    if (miniState.left !== null && miniState.top !== null) {
      clampMini();
      miniEl.style.left = miniState.left + 'px';
      miniEl.style.top = miniState.top + 'px';
      miniEl.style.right = 'auto';
      miniEl.style.bottom = 'auto';
    }
    $('btnMiniToggle').textContent = miniState.visible ? 'ミニマップを隠す' : 'ミニマップ';
  }

  /** 画面の外に出て掴めなくなるのを防ぐ */
  function clampMini() {
    if (miniState.left === null) return;
    const r = miniEl.getBoundingClientRect();
    const w = r.width || MINI_SIZES[miniState.size % MINI_SIZES.length];
    const h = r.height || w;
    miniState.left = Math.max(4, Math.min(window.innerWidth - w - 4, miniState.left));
    miniState.top = Math.max(4, Math.min(window.innerHeight - h - 4, miniState.top));
  }

  $('btnMiniToggle').addEventListener('click', () => {
    miniState.visible = !miniState.visible;
    applyMiniState();
    saveMiniState();
  });

  $('btnMiniHide').addEventListener('click', (e) => {
    e.stopPropagation();
    miniState.visible = false;
    applyMiniState();
    saveMiniState();
  });

  $('btnMiniSize').addEventListener('click', (e) => {
    e.stopPropagation();
    miniState.size = (miniState.size + 1) % MINI_SIZES.length;
    applyMiniState();
    saveMiniState();
  });

  $('btnMiniSolid').addEventListener('click', (e) => {
    e.stopPropagation();
    miniState.solid = !miniState.solid;
    applyMiniState();
    saveMiniState();
  });

  $('btnMiniLevel').addEventListener('click', (e) => {
    e.stopPropagation();
    miniState.level = !miniState.level;
    applyMiniState();
    saveMiniState();
    // 姿勢角が来ていないと水準器は動かないので、通知を有効にしておく
    if (miniState.level) for (const c of cubes) enableAttitude(c);
  });

  // しばらく触っていなければ薄くして、下のパネルが読めるようにする
  let miniIdleTimer = 0;
  function wakeMinimap() {
    miniEl.classList.remove('idle');
    clearTimeout(miniIdleTimer);
    miniIdleTimer = setTimeout(() => miniEl.classList.add('idle'), 3000);
  }
  for (const ev of ['pointerenter', 'pointerdown', 'pointermove']) {
    miniEl.addEventListener(ev, wakeMinimap);
  }
  miniEl.addEventListener('pointerleave', wakeMinimap);
  wakeMinimap();

  // ドラッグで好きな位置へ動かす
  let miniDrag = null;
  miniEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.minimap-btn')) return;
    const r = miniEl.getBoundingClientRect();
    miniDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    miniState.left = r.left;
    miniState.top = r.top;
    miniEl.classList.add('dragging');
    try { miniEl.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  });

  miniEl.addEventListener('pointermove', (e) => {
    if (!miniDrag) return;
    miniState.left = e.clientX - miniDrag.dx;
    miniState.top = e.clientY - miniDrag.dy;
    applyMiniState();
  });

  const endMiniDrag = () => {
    if (!miniDrag) return;
    miniDrag = null;
    miniEl.classList.remove('dragging');
    saveMiniState();
  };

  miniEl.addEventListener('pointerup', endMiniDrag);
  miniEl.addEventListener('pointercancel', endMiniDrag);
  window.addEventListener('resize', () => { clampMini(); applyMiniState(); });

  applyMiniState();

  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  /** マット座標 → キャンバス座標の変換係数（w, h はデバイスピクセル） */
  function matTransform(mat, w, h, padCss) {
    // 余白もデバイスピクセルで取らないと、高 DPI 端末で目盛りの文字が枠外にはみ出す
    const pad = (padCss === undefined ? 26 : padCss) * (window.devicePixelRatio || 1);
    const mw = mat.maxX - mat.minX, mh = mat.maxY - mat.minY;
    const scale = Math.min((w - pad * 2) / mw, (h - pad * 2) / mh);
    return {
      scale,
      ox: (w - mw * scale) / 2 - mat.minX * scale,
      oy: (h - mh * scale) / 2 - mat.minY * scale,
    };
  }

  function updateAutoMat() {
    if ($('matSelect').value !== 'auto') return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cubes) {
      const tr = trails.get(c);
      if (!tr) continue;
      for (const [x, y] of tr) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) return;
    const margin = 30;
    autoMat.minX = minX - margin; autoMat.maxX = Math.max(maxX + margin, minX - margin + 50);
    autoMat.minY = minY - margin; autoMat.maxY = Math.max(maxY + margin, minY - margin + 50);
  }

  /**
   * マット（または推測航法）の様子を描く。ミニマップからも同じ関数を使う。
   * @param {HTMLCanvasElement} cv 描画先
   * @param {CanvasRenderingContext2D} ctx 描画先のコンテキスト
   * @param {boolean} compact 目盛りや名前を省いて小さく描く
   */
  function renderMap(cv, ctx, compact) {
    const dpr = fitCanvas(cv);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const dead = isDeadReckoning();
    if (!dead) updateAutoMat();
    const mat = dead ? deadView() : currentMat();
    const tf = matTransform(mat, w, h, compact ? 8 : 26);
    const X = (x) => x * tf.scale + tf.ox;
    const Y = (y) => y * tf.scale + tf.oy;
    // 推測航法では表示だけ 90 度回す。位置IDのときは素通し
    const toScreen = dead
      ? (x, y) => { const p = drRotate(x, y); return [X(p[0]), Y(p[1])]; }
      : (x, y) => [X(x), Y(y)];

    // マット枠とグリッド
    ctx.lineWidth = dpr;
    ctx.strokeStyle = '#30363d';
    ctx.strokeRect(X(mat.minX), Y(mat.minY), (mat.maxX - mat.minX) * tf.scale, (mat.maxY - mat.minY) * tf.scale);

    ctx.strokeStyle = 'rgba(48,54,61,0.6)';
    const step = 50;
    for (let x = Math.ceil(mat.minX / step) * step; x <= mat.maxX; x += step) {
      ctx.beginPath(); ctx.moveTo(X(x), Y(mat.minY)); ctx.lineTo(X(x), Y(mat.maxY)); ctx.stroke();
    }
    for (let y = Math.ceil(mat.minY / step) * step; y <= mat.maxY; y += step) {
      ctx.beginPath(); ctx.moveTo(X(mat.minX), Y(y)); ctx.lineTo(X(mat.maxX), Y(y)); ctx.stroke();
    }

    // 目盛りはマット枠の内側に描く。外側だと端末によっては canvas からはみ出る
    ctx.fillStyle = '#8b949e';
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    if (!compact && !dead) {
      // 座標の目盛り。推測航法は表示を回しているので出さない
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(`${mat.minX}, ${mat.minY}`, X(mat.minX) + 4 * dpr, Y(mat.minY) + 4 * dpr);
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      ctx.fillText(`${mat.maxX}, ${mat.maxY}`, X(mat.maxX) - 4 * dpr, Y(mat.maxY) - 4 * dpr);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    if (dead) {
      // 原点の目印と、上が 0°（リセット直後の向き）であることの表示
      ctx.strokeStyle = '#8b949e';
      ctx.beginPath();
      ctx.moveTo(X(-12), Y(0)); ctx.lineTo(X(12), Y(0));
      ctx.moveTo(X(0), Y(-12)); ctx.lineTo(X(0), Y(12));
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('0°', (X(mat.minX) + X(mat.maxX)) / 2, Y(mat.minY) + 3 * dpr);
      // 向きを何から出しているかは取り違えやすいので、地図にも書いておく
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.font = `${(compact ? 9 : 11) * dpr}px ui-monospace, monospace`;
      ctx.fillText(`向き: ${headingSource}`, X(mat.minX) + 4 * dpr, Y(mat.maxY) - 4 * dpr);
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      ctx.textBaseline = 'alphabetic';
      if (!compact) ctx.fillText('原点', X(0) + 6 * dpr, Y(0) - 6 * dpr);
    } else {
      // 目標マーカー
      ctx.strokeStyle = '#d29922';
      ctx.fillStyle = '#d29922';
      multiTargets.forEach((t, i) => {
        ctx.beginPath();
        ctx.arc(X(t.x), Y(t.y), (compact ? 3 : 5) * dpr, 0, Math.PI * 2);
        ctx.stroke();
        if (!compact) ctx.fillText(String(i + 1), X(t.x) + 8 * dpr, Y(t.y) - 8 * dpr);
      });
    }

    // 軌跡とキューブ
    const showTrail = $('showTrail').checked;
    for (const cube of cubes) {
      const isSel = cube === selected;
      const color = isSel ? '#58a6ff' : '#3fb950';
      const tr = dead ? estTrails.get(cube) : trails.get(cube);
      if (showTrail && tr && tr.length > 1) {
        ctx.strokeStyle = isSel ? 'rgba(88,166,255,0.45)' : 'rgba(63,185,80,0.35)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        const p0 = toScreen(tr[0][0], tr[0][1]);
        ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < tr.length; i++) {
          const p = toScreen(tr[i][0], tr[i][1]);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }
      const pose = dead ? estimates.get(cube) : (cube.onMat ? cube.position : null);
      if (!pose) continue;
      const [px, py] = toScreen(pose.x, pose.y);
      const rad = (pose.angle - (dead ? 90 : 0)) * Math.PI / 180;
      const s = compact ? 0.6 : 1;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rad);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(14 * dpr * s, 0);
      ctx.lineTo(-9 * dpr * s, 8 * dpr * s);
      ctx.lineTo(-9 * dpr * s, -8 * dpr * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (compact) continue;
      // 名前は狭い画面だとはみ出すので短縮し、右端に寄ったら左側に出す
      ctx.fillStyle = color;
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      const label = cube.name.replace(/^toio Core Cube[-\s]*/i, '') || cube.name;
      const tw = ctx.measureText(label).width;
      if (px + 14 * dpr + tw > w) {
        ctx.textAlign = 'right';
        ctx.fillText(label, px - 14 * dpr, py + 4 * dpr);
        ctx.textAlign = 'left';
      } else {
        ctx.fillText(label, px + 14 * dpr, py + 4 * dpr);
      }
    }
  }

  /**
   * 読めている位置IDが、選んでいるマットの範囲の外にあるときに知らせる。
   * 範囲外だとキューブの矢印が枠の外＝キャンバスの外に描かれ、
   * 「読めていない」ようにしか見えないため。
   */
  function updateMatRangeHint() {
    const el = $('matRangeHint');
    if (isDeadReckoning() || !selected) { el.classList.add('hidden'); return; }

    // 一度も読めていないなら、範囲の話より先に「模様が読めていない」ことを出す。
    // マットの外にいるあいだ通知は来ないので、回数ではなく接続からの時間で判断する
    const st = readStats.get(selected);
    if (st && !st.pos && !st.std && selected.connected && Date.now() - st.since > 10000) {
      el.classList.remove('hidden');
      el.textContent = '接続してから位置ID・標準IDを一度も読めていません。'
        + '位置IDの模様は特殊な印刷が必要で、家庭用・コンビニのプリンタではまず再現できません。'
        + '製品付属のマットか、模様が刷り込まれた開発用プレイマット／専用の印刷サービスをお使いください。';
      return;
    }

    const p = selected.onMat && selected.position;
    if (!p || $('matSelect').value === 'auto') { el.classList.add('hidden'); return; }
    const mat = currentMat();
    const out = p.x < mat.minX || p.x > mat.maxX || p.y < mat.minY || p.y > mat.maxY;
    el.classList.toggle('hidden', !out);
    if (out) {
      el.textContent = `位置ID (${p.x}, ${p.y}) は選択中のマットの範囲（`
        + `${mat.minX}–${mat.maxX} / ${mat.minY}–${mat.maxY}）の外です。`
        + 'マットを「自動（実測範囲）」にすると表示され、タップでの移動も正しい座標になります。';
    }
  }

  function drawMat() {
    updateMatRangeHint();
    renderMap(canvas, ctx, false);
    if (!$('minimap').classList.contains('hidden')) renderMap(miniCanvas, miniCtx, true);
  }

  // canvas 上でも縦スクロールできるようにしてあるので、pointerdown ではなく
  // 「ほとんど動かずに離した」ときだけタップとして扱う
  let tapStart = null;

  canvas.addEventListener('pointerdown', (e) => {
    tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  });

  canvas.addEventListener('pointercancel', () => { tapStart = null; });

  canvas.addEventListener('pointerup', (e) => {
    const start = tapStart;
    tapStart = null;
    if (!start) return;
    if (isDeadReckoning()) return; // 推定座標に向けて動かしても意味がない
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) return;
    if (Date.now() - start.t > 700) return;
    if (!$('tapToMove').checked) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const mat = currentMat();
    const tf = matTransform(mat, rect.width * dpr, rect.height * dpr);
    const x = Math.round((((e.clientX - rect.left) * dpr) - tf.ox) / tf.scale);
    const y = Math.round((((e.clientY - rect.top) * dpr) - tf.oy) / tf.scale);
    $('tX').value = x;
    $('tY').value = y;

    if (activeMotorTab() === 'multi') {
      if (multiTargets.length >= 29) { toast('目標は最大 29 点です'); return; }
      multiTargets.push({ x, y, angle: Number($('tAngle').value), rotateType: Number($('tRotate').value) });
      renderTargetList();
    } else {
      send((c) => c.motorTarget(
        { x, y, angle: Number($('tAngle').value), rotateType: Number($('tRotate').value) },
        targetOptions()));
    }
  });

  $('btnClearTrail').addEventListener('click', () => {
    for (const c of cubes) {
      if (isDeadReckoning()) estTrails.set(c, []);
      else {
        trails.set(c, []);
        // 消すのではなく数え直す。消すと「読めた 0」すら出せなくなる
        const s = statsOf(c);
        s.pos = s.posMissed = s.std = s.stdMissed = 0;
        s.lastText = null; s.lastAt = 0; s.since = Date.now();
      }
    }
    syncReadouts();
  });

  // 「最後に読めた」の経過秒だけは、通知が来なくても進めたい
  setInterval(() => { if (selected) syncReadouts(); }, 1000);

  // ---------------------------------------------------------- 姿勢角の描画
  const attCanvas = $('attCanvas');
  const attCtx = attCanvas.getContext('2d');

  /**
   * 姿勢角の水準器を描く。ミニマップからも同じ関数を使う。
   * @param {boolean} compact 説明文を省いて小さく描く
   */
  function renderAttitude(cv, ctx, compact) {
    const dpr = fitCanvas(cv);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    const e = eulerOfSelected();
    const has = !!e;
    const roll = e ? e.roll : 0, pitch = e ? e.pitch : 0, yaw = e ? e.yaw : 0;

    // compact では下にラベルを置くぶん、円を上寄せ・小さめにする
    // compact（ミニマップ）は縦積み、通常は横並び
    let c1, c2, r;
    if (compact) {
      r = Math.min(w * 0.34, h * 0.19);
      c1 = { x: w / 2, y: h * 0.25 };
      c2 = { x: w / 2, y: h * 0.72 };
    } else {
      r = Math.min(h * 0.38, w * 0.2);
      c1 = { x: w * 0.28, y: h / 2 };
      c2 = { x: w * 0.62, y: h / 2 };
    }
    const cx = c1.x, cy = c1.y, yx = c2.x, yy = c2.y;

    // 人工水平儀（roll / pitch）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-roll * Math.PI / 180);
    const off = Math.max(-r, Math.min(r, (pitch / 45) * r));
    ctx.fillStyle = has ? '#1f6feb' : '#21262d';
    ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2 + off);
    ctx.fillStyle = has ? '#513c1c' : '#161b22';
    ctx.fillRect(-r * 2, off, r * 4, r * 2);
    ctx.strokeStyle = '#e6edf3';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(-r, off); ctx.lineTo(r, off);
    ctx.stroke();
    // ピッチの目盛り（10 度ごと）。傾きの量を読み取れるようにする
    ctx.strokeStyle = 'rgba(230,237,243,0.5)';
    ctx.lineWidth = dpr;
    for (let d = -40; d <= 40; d += 10) {
      if (!d) continue;
      const y = off - (d / 45) * r;
      const len = d % 20 === 0 ? r * 0.35 : r * 0.18;
      ctx.beginPath(); ctx.moveTo(-len, y); ctx.lineTo(len, y); ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // 機体マーク（画面に固定）。これを基準に地平線がどれだけ傾いたかを見る
    ctx.strokeStyle = '#f0f6fc';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy); ctx.lineTo(cx - r * 0.15, cy);
    ctx.moveTo(cx + r * 0.15, cy); ctx.lineTo(cx + r * 0.5, cy);
    ctx.stroke();

    // ヨー（上から見た向き）
    ctx.save();
    ctx.translate(yx, yy);
    ctx.strokeStyle = '#30363d';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(yaw * Math.PI / 180);
    ctx.fillStyle = has ? '#58a6ff' : '#30363d';
    ctx.beginPath();
    ctx.moveTo(r * 0.8, 0);
    ctx.lineTo(-r * 0.5, r * 0.45);
    ctx.lineTo(-r * 0.5, -r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#8b949e';
    ctx.font = `${(compact ? 8 : 11) * dpr}px ui-monospace, monospace`;
    ctx.textAlign = compact ? 'center' : 'left';
    ctx.fillText(compact ? 'R/P' : 'roll / pitch', compact ? cx : cx - r, cy + r + (compact ? 10 : 14) * dpr);
    ctx.fillText(compact ? 'YAW' : 'yaw', compact ? yx : yx - r * 0.3, yy + r + (compact ? 10 : 14) * dpr);
    ctx.textAlign = 'left';
    if (!has && !compact) {
      ctx.fillText('姿勢角は「適用」で有効化してください', w * 0.78, cy);
    }
  }

  // ------------------------------------------------------------ 姿勢の3D
  // リンクコントロール（../link-control/）から移植。あちらは操作対象の向きリングも
  // 描くが、こちらは選択中のキューブ 1 台の姿勢だけを見せる。
  const poseCanvas = $('poseCanvas');
  const poseCtx = poseCanvas.getContext('2d');

  // 3x3 行列。world = R * local で、ローカルは x=前 / y=左 / z=上
  function mul(a, b) {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      }
    }
    return o;
  }
  function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY(t) { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function apply(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }

  const CAM_DEFAULT = { azim: 35, elev: 28, zoom: 100 };
  const cam = { azim: 35, elev: 28, zoom: 1 };

  function syncCam() {
    $('outCamAzim').textContent = Math.round(Number($('numCamAzim').value)) + '°';
    $('outCamElev').textContent = Math.round(Number($('numCamElev').value)) + '°';
    $('outCamZoom').textContent = Math.round(Number($('numCamZoom').value)) + '%';
    cam.azim = Number($('numCamAzim').value);
    cam.elev = Number($('numCamElev').value);
    cam.zoom = Number($('numCamZoom').value) / 100;
  }

  for (const id of ['numCamAzim', 'numCamElev', 'numCamZoom']) {
    $(id).addEventListener('input', syncCam);
  }

  $('btnCamReset').addEventListener('click', () => {
    $('numCamAzim').value = CAM_DEFAULT.azim;
    $('numCamElev').value = CAM_DEFAULT.elev;
    $('numCamZoom').value = CAM_DEFAULT.zoom;
    syncCam();
  });

  // キャンバスを掴んで視点を回す
  let camDrag = null;
  poseCanvas.addEventListener('pointerdown', (e) => {
    camDrag = { x: e.clientX, y: e.clientY, azim: cam.azim, elev: cam.elev };
    try { poseCanvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  });
  poseCanvas.addEventListener('pointermove', (e) => {
    if (!camDrag) return;
    const lim = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    $('numCamAzim').value = lim(camDrag.azim - (e.clientX - camDrag.x) * 0.4, -180, 180);
    $('numCamElev').value = lim(camDrag.elev + (e.clientY - camDrag.y) * 0.3, -10, 85);
    syncCam();
  });
  const endCamDrag = () => { camDrag = null; };
  poseCanvas.addEventListener('pointerup', endCamDrag);
  poseCanvas.addEventListener('pointercancel', endCamDrag);

  /** 直方体の 6 面を {pts(ローカル), n(法線)} で返す */
  function boxFaces(hx, hy, hz) {
    const v = (x, y, z) => [x, y, z];
    return [
      { n: [1, 0, 0], pts: [v(hx, -hy, -hz), v(hx, hy, -hz), v(hx, hy, hz), v(hx, -hy, hz)] },
      { n: [-1, 0, 0], pts: [v(-hx, hy, -hz), v(-hx, -hy, -hz), v(-hx, -hy, hz), v(-hx, hy, hz)] },
      { n: [0, 1, 0], pts: [v(hx, hy, -hz), v(-hx, hy, -hz), v(-hx, hy, hz), v(hx, hy, hz)] },
      { n: [0, -1, 0], pts: [v(-hx, -hy, -hz), v(hx, -hy, -hz), v(hx, -hy, hz), v(-hx, -hy, hz)] },
      { n: [0, 0, 1], pts: [v(hx, -hy, hz), v(hx, hy, hz), v(-hx, hy, hz), v(-hx, -hy, hz)] },
      { n: [0, 0, -1], pts: [v(-hx, -hy, -hz), v(-hx, hy, -hz), v(hx, hy, -hz), v(hx, -hy, -hz)] },
    ];
  }

  const LIGHT = (() => {
    const v = [0.35, 0.5, 1];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  })();

  function shade(hex, k) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const f = (x) => Math.round(Math.max(0, Math.min(255, x * k)));
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
  }

  function renderPose(cv, ctx, compact) {
    const dpr = fitCanvas(cv);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    const e = eulerOfSelected();
    const has = !!e;
    const roll = e ? e.roll : 0, pitch = e ? e.pitch : 0, yaw = e ? e.yaw : 0;

    // 機体の姿勢。ヨーは「時計回りが正」、ピッチは「上向きが正」に合わせるため、
    // どちらも符号を反転して行列に入れる（rotY は正で機首が下がる向きのため）
    const R = mul(rotZ(-yaw * Math.PI / 180), mul(rotY(-pitch * Math.PI / 180), rotX(roll * Math.PI / 180)));

    // カメラ
    const az = cam.azim * Math.PI / 180, el = cam.elev * Math.PI / 180;
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    const nrm = [ce * ca, ce * sa, se];        // 原点からカメラへ向かう単位ベクトル
    const rgt = [-sa, ca, 0];                  // 画面右
    const upv = [-se * ca, -se * sa, ce];      // 画面上
    const scale = Math.min(w, h) * 0.155 * cam.zoom;
    const dist = 9;
    const cx = w / 2, cy = h * 0.54;

    const project = (p) => {
      const d = p[0] * nrm[0] + p[1] * nrm[1] + p[2] * nrm[2];
      const k = dist / Math.max(1.5, dist - d);   // 弱い遠近感
      return [
        cx + (p[0] * rgt[0] + p[1] * rgt[1] + p[2] * rgt[2]) * scale * k,
        cy - (p[0] * upv[0] + p[1] * upv[1] + p[2] * upv[2]) * scale * k,
        d,
      ];
    };

    const FLOOR = -1.3;   // 本体の底（-2/3）より少し下。影を落とす面でもある

    // ---- 床のグリッド
    if ($('chkGrid').checked) {
      ctx.strokeStyle = 'rgba(48,54,61,0.9)';
      ctx.lineWidth = dpr;
      const R0 = 3;
      for (let i = -R0; i <= R0; i++) {
        const a = project([i * 0.75, -R0 * 0.75, FLOOR]);
        const b = project([i * 0.75, R0 * 0.75, FLOOR]);
        const c = project([-R0 * 0.75, i * 0.75, FLOOR]);
        const d = project([R0 * 0.75, i * 0.75, FLOOR]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
      }
    }

    // ---- 影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    for (let a = 0; a <= 360; a += 12) {
      const t = a * Math.PI / 180;
      const p = project([Math.cos(t) * 1.15, Math.sin(t) * 1.15, FLOOR + 0.01]);
      if (a === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fill();

    // ---- キューブ本体。実機は上から見ると正方形で低いので 幅 : 高さ ≒ 3 : 2
    const hx = 1, hy = 1, hz = 2 / 3;
    const polys = [];

    /**
     * 面を 1 枚積む。
     * @param {object} [opt] on … 面に貼りつく飾りのとき、貼り先の面の中心（ローカル座標）。
     *   飾りを自分の重心の深さで並べると、傾き次第で親の面より奥と判定されて
     *   隠れてしまうので、親と同じ深さにわずかな前寄せを足す
     */
    const push = (localPts, normal, color, opt) => {
      const world = localPts.map((p) => apply(R, p));
      const nw = apply(R, normal);
      if (nw[0] * nrm[0] + nw[1] * nrm[1] + nw[2] * nrm[2] <= 0.001) return;  // 裏面は描かない
      const scr = world.map(project);
      const depth = opt && opt.on
        ? project(apply(R, opt.on))[2] + 0.02
        : scr.reduce((s, p) => s + p[2], 0) / scr.length;
      const lit = 0.45 + 0.55 * Math.max(0, nw[0] * LIGHT[0] + nw[1] * LIGHT[1] + nw[2] * LIGHT[2]);
      polys.push({ scr, depth, color: shade(color, lit), opt: opt || {} });
    };

    const FACE_COLOR = ['#eef1f6', '#e2e6ee', '#e8ecf3', '#e8ecf3', '#f7f9fc', '#c9ced8'];
    boxFaces(hx, hy, hz).forEach((f, i) => push(f.pts, f.n, has ? FACE_COLOR[i] : '#39414d'));

    // 車輪（左右の面に貼る板）
    for (const sy of [1, -1]) {
      const y = sy * (hy + 0.05);
      push([[-0.62, y, -hz], [0.62, y, -hz], [0.62, y, -hz + 0.42], [-0.62, y, -hz + 0.42]],
        [0, sy, 0], '#39414d', { on: [0, sy * hy, 0] });
    }

    // 天面の矢印（前を示す）
    push([[0.74, 0, hz + 0.02], [0.02, 0.42, hz + 0.02], [0.02, -0.42, hz + 0.02]],
      [0, 0, 1], has ? '#58a6ff' : '#4b5563', { on: [0, 0, hz] });

    // 正面のランプ
    push([[hx + 0.02, -0.26, -0.16], [hx + 0.02, 0.26, -0.16], [hx + 0.02, 0.26, 0.24], [hx + 0.02, -0.26, 0.24]],
      [1, 0, 0], has ? '#1f6feb' : '#39414d', { glow: has, on: [hx, 0, 0] });

    polys.sort((a, b) => a.depth - b.depth);
    for (const p of polys) {
      ctx.beginPath();
      ctx.moveTo(p.scr[0][0], p.scr[0][1]);
      for (let i = 1; i < p.scr.length; i++) ctx.lineTo(p.scr[i][0], p.scr[i][1]);
      ctx.closePath();
      if (p.opt.glow) { ctx.shadowColor = '#58a6ff'; ctx.shadowBlur = 12 * dpr; }
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(13,17,23,0.45)';
      ctx.lineWidth = dpr;
      ctx.stroke();
    }

    // ---- 軸（機体に固定）
    if ($('chkAxes').checked) {
      const axes = [[[2.0, 0, 0], '#f85149', 'X 前'], [[0, 1.9, 0], '#3fb950', 'Y 左'], [[0, 0, 1.9], '#58a6ff', 'Z 上']];
      ctx.font = `${10 * dpr}px ui-monospace, monospace`;
      for (const [v, color, label] of axes) {
        const a = project([0, 0, 0]);
        const b = project(apply(R, v));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8 * dpr;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if (compact) continue;   // 小さいと文字だらけになるのでラベルは省く
        ctx.fillStyle = color;
        ctx.fillText(label, b[0] + 4 * dpr, b[1]);
      }
    }

    if (!has) {
      ctx.fillStyle = '#8b949e';
      ctx.font = `${(compact ? 9 : 12) * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('姿勢角を待っています', w / 2, h - 8 * dpr);
      ctx.textAlign = 'left';
    }
  }

  function drawAttitude() {
    renderAttitude(attCanvas, attCtx, false);
    if (miniState.visible && miniState.level) renderAttitude(miniAttCanvas, miniAttCtx, true);
  }

  // ------------------------------------------------------------ 描画ループ
  function loop() {
    drawMat();
    drawAttitude();
    renderPose(poseCanvas, poseCtx, false);
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------ ダブルタップズーム対策
  // user-scalable=no を無視するブラウザ（アクセシビリティ設定で強制的に
  // 拡大を許可している場合を含む）向けの保険。2 回目のタップの既定動作を
  // 潰すと、拡大や「ダブルタップした要素を中央に寄せるスクロール」が起きない。
  //
  // 除外しているのはクリックで動く UI だけ。touchend の既定動作を潰すと
  // 合成される click が飛ばなくなるため。鍵盤は pointerdown/up で鳴らしていて
  // click に依存していないので、除外しない（横スクロールが勝手に動くのを防ぐ）。
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350 && e.cancelable) {
      const t = e.target;
      if (!(t && t.closest && t.closest('button, input, select, textarea, a, .cube-tab'))) {
        e.preventDefault();
      }
    }
    lastTouchEnd = now;
  }, { passive: false });

  // ---------------------------------------------------------------- 起動
  if (!navigator.bluetooth) {
    $('unsupported').classList.remove('hidden');
    $('btnConnect').disabled = true;
  }

  renderTabs();
  updateTrailSourceUI();
  applyJoyMode();
  syncCam();
  renderKeyboard();
  renderScenario();
  renderMelody();
  renderTargetList();
  syncReadouts();
  requestAnimationFrame(loop);

  window.addEventListener('beforeunload', () => {
    for (const c of cubes) { if (c.connected) { try { c.stop(); } catch (e) { /* noop */ } } }
  });
})();
