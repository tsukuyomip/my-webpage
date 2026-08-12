/* toio コントロールパネル UI */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const T = window.Toio;

  // ---------------------------------------------------------------- 状態
  const cubes = [];
  let selected = null;
  const trails = new WeakMap();

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
    cube.on('log', (entry) => appendLog(cube, entry));
    cube.on('disconnect', () => {
      renderTabs();
      if (cube === selected) syncReadouts();
      toast(cube.name + ' が切断されました');
    });
    cube.on('position', (p) => {
      const tr = trails.get(cube) || [];
      tr.push([p.x, p.y]);
      if (tr.length > 600) tr.shift();
      trails.set(cube, tr);
      if (cube === selected) syncReadouts();
    });
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
    if (keysDown.size) { keysDown.clear(); setSliders(0, 0); send((c) => c.stop()); }
  });

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

  // 鍵盤。スマホでも指が入るよう 1 オクターブぶんだけ出し、オクターブは切り替える
  const BLACK = [1, 3, 6, 8, 10];
  let octaveBase = 48; // C4

  function renderKeyboard() {
    const wrap = $('keyboard');
    wrap.textContent = '';
    $('octLabel').textContent = T.noteName(octaveBase) + ' – ' + T.noteName(octaveBase + 12);
    for (let i = 0; i <= 12; i++) {
      const note = octaveBase + i;
      if (note > 127) break;
      const key = document.createElement('div');
      key.className = 'key' + (BLACK.includes(note % 12) ? ' black' : '');
      key.textContent = BLACK.includes(note % 12) ? '' : T.noteName(note);
      key.title = `${T.noteName(note)} (${note})`;
      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        key.classList.add('on');
        const vol = Number($('sVolume').value);
        send((c) => c.soundMidi([{ note, durationMs: 500, volume: vol }], 1));
      });
      const off = () => key.classList.remove('on');
      key.addEventListener('pointerup', off);
      key.addEventListener('pointerleave', off);
      key.addEventListener('pointercancel', off);
      wrap.appendChild(key);
    }
  }

  function shiftOctave(delta) {
    octaveBase = Math.max(0, Math.min(115, octaveBase + delta * 12));
    renderKeyboard();
  }

  $('btnOctDown').addEventListener('click', () => shiftOctave(-1));
  $('btnOctUp').addEventListener('click', () => shiftOctave(1));

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

  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  /** マット座標 → キャンバス座標の変換係数（w, h はデバイスピクセル） */
  function matTransform(mat, w, h) {
    // 余白もデバイスピクセルで取らないと、高 DPI 端末で目盛りの文字が枠外にはみ出す
    const pad = 26 * (window.devicePixelRatio || 1);
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

  function drawMat() {
    const dpr = fitCanvas(canvas);
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    updateAutoMat();
    const mat = currentMat();
    const tf = matTransform(mat, w, h);
    const X = (x) => x * tf.scale + tf.ox;
    const Y = (y) => y * tf.scale + tf.oy;

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
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(`${mat.minX}, ${mat.minY}`, X(mat.minX) + 4 * dpr, Y(mat.minY) + 4 * dpr);
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillText(`${mat.maxX}, ${mat.maxY}`, X(mat.maxX) - 4 * dpr, Y(mat.maxY) - 4 * dpr);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 目標マーカー
    ctx.strokeStyle = '#d29922';
    ctx.fillStyle = '#d29922';
    multiTargets.forEach((t, i) => {
      ctx.beginPath();
      ctx.arc(X(t.x), Y(t.y), 5 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(String(i + 1), X(t.x) + 8 * dpr, Y(t.y) - 8 * dpr);
    });

    // 軌跡とキューブ
    const showTrail = $('showTrail').checked;
    for (const cube of cubes) {
      const isSel = cube === selected;
      const color = isSel ? '#58a6ff' : '#3fb950';
      const tr = trails.get(cube);
      if (showTrail && tr && tr.length > 1) {
        ctx.strokeStyle = isSel ? 'rgba(88,166,255,0.45)' : 'rgba(63,185,80,0.35)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(X(tr[0][0]), Y(tr[0][1]));
        for (let i = 1; i < tr.length; i++) ctx.lineTo(X(tr[i][0]), Y(tr[i][1]));
        ctx.stroke();
      }
      if (!cube.position || !cube.onMat) continue;
      const px = X(cube.position.x), py = Y(cube.position.y);
      const rad = cube.position.angle * Math.PI / 180;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rad);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(14 * dpr, 0);
      ctx.lineTo(-9 * dpr, 8 * dpr);
      ctx.lineTo(-9 * dpr, -8 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
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
    for (const c of cubes) trails.set(c, []);
  });

  // ---------------------------------------------------------- 姿勢角の描画
  const attCanvas = $('attCanvas');
  const attCtx = attCanvas.getContext('2d');

  function drawAttitude() {
    const dpr = fitCanvas(attCanvas);
    const w = attCanvas.width, h = attCanvas.height;
    attCtx.clearRect(0, 0, w, h);

    const a = selected && selected.attitude;
    let roll = 0, pitch = 0, yaw = 0, has = false;
    if (a) {
      has = true;
      if (a.format === 2) { const e = quatToEuler(a); roll = e.roll; pitch = e.pitch; yaw = e.yaw; }
      else { roll = a.roll; pitch = a.pitch; yaw = a.yaw; }
    }

    const cx = w * 0.28, cy = h / 2, r = Math.min(h * 0.38, w * 0.2);

    // 人工水平儀（roll / pitch）
    attCtx.save();
    attCtx.beginPath();
    attCtx.arc(cx, cy, r, 0, Math.PI * 2);
    attCtx.clip();
    attCtx.translate(cx, cy);
    attCtx.rotate(-roll * Math.PI / 180);
    const off = Math.max(-r, Math.min(r, (pitch / 45) * r));
    attCtx.fillStyle = has ? '#1f6feb' : '#21262d';
    attCtx.fillRect(-r * 2, -r * 2, r * 4, r * 2 + off);
    attCtx.fillStyle = has ? '#513c1c' : '#161b22';
    attCtx.fillRect(-r * 2, off, r * 4, r * 2);
    attCtx.strokeStyle = '#e6edf3';
    attCtx.lineWidth = 1.5 * dpr;
    attCtx.beginPath();
    attCtx.moveTo(-r, off); attCtx.lineTo(r, off);
    attCtx.stroke();
    attCtx.restore();

    attCtx.strokeStyle = '#30363d';
    attCtx.lineWidth = dpr;
    attCtx.beginPath();
    attCtx.arc(cx, cy, r, 0, Math.PI * 2);
    attCtx.stroke();

    // ヨー（上から見た向き）
    const yx = w * 0.62;
    attCtx.save();
    attCtx.translate(yx, cy);
    attCtx.strokeStyle = '#30363d';
    attCtx.beginPath();
    attCtx.arc(0, 0, r, 0, Math.PI * 2);
    attCtx.stroke();
    attCtx.rotate(yaw * Math.PI / 180);
    attCtx.fillStyle = has ? '#58a6ff' : '#30363d';
    attCtx.beginPath();
    attCtx.moveTo(r * 0.8, 0);
    attCtx.lineTo(-r * 0.5, r * 0.45);
    attCtx.lineTo(-r * 0.5, -r * 0.45);
    attCtx.closePath();
    attCtx.fill();
    attCtx.restore();

    attCtx.fillStyle = '#8b949e';
    attCtx.font = `${11 * dpr}px ui-monospace, monospace`;
    attCtx.fillText('roll / pitch', cx - r, cy + r + 14 * dpr);
    attCtx.fillText('yaw', yx - r * 0.3, cy + r + 14 * dpr);
    if (!has) {
      attCtx.fillText('姿勢角は「適用」で有効化してください', w * 0.78, cy);
    }
  }

  // ------------------------------------------------------------ 描画ループ
  function loop() {
    drawMat();
    drawAttitude();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 起動
  if (!navigator.bluetooth) {
    $('unsupported').classList.remove('hidden');
    $('btnConnect').disabled = true;
  }

  renderTabs();
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
