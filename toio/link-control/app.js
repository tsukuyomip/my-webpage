/*
 * toio リンクコントロール
 *
 * 2 台のコアキューブを「コントローラ（手に持つ側）」と「操作対象（走る側）」に分け、
 * コントローラの姿勢角で操作対象を走らせる。
 *
 *   ヨー   → 操作対象の向き。コントローラを回した角度に追従して回る
 *   ピッチ → 前後。前に傾けると前進、後ろに傾けると後退（倒した角度で無段階）
 *   ロール → いまは未使用。割り当てを増やせるよう ROLL_ACTIONS に口だけ用意してある
 *
 * BLE の読み書きは ../shared/toio.js（コントロールパネルと共有）に任せ、
 * このファイルは「制御」と「表示」だけを持つ。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const T = window.Toio;

  const num = (id) => Number($(id).value);
  const chk = (id) => $(id).checked;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** 0〜360 に畳む */
  function wrap360(d) { return ((d % 360) + 360) % 360; }
  /** -180〜180 に畳む。角度の差を取るときに使う */
  function wrap180(d) { d = wrap360(d); return d > 180 ? d - 360 : d; }

  // ---------------------------------------------------------------- 状態
  const roles = { ctl: null, tgt: null };

  /** ヨーは 180/-180 をまたぐので、差分を積算して連続値として持つ */
  const ctlYaw = { prev: null, acc: 0 };
  const tgtYaw = { prev: null, acc: 0 };

  function accumulate(a, deg) {
    if (a.prev === null) { a.prev = deg; return a.acc; }
    let d = deg - a.prev;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    a.prev = deg;
    a.acc += d;
    return a.acc;
  }

  function resetAcc(a) { a.prev = null; a.acc = 0; }

  /**
   * 基準（ゼロ点）。
   * ctlAcc  … 基準を取った瞬間のコントローラのヨー積算値
   * heading … そのときの操作対象の実測の向き。ここを起点に追従させる
   */
  const anchor = { ctlAcc: 0, heading: 0, pitch: 0, roll: 0, has: false };

  const drive = {
    running: false,
    fwd: 0,            // なました前後指令
    turn: 0,
    l: 0, r: 0,
    err: null,         // 追従誤差（度）
    prevErr: null,
    desired: null,     // 目標の向き（度）
    actual: null,      // 実測の向き（度）
    source: null,      // 'id' | 'yaw' | 'dead' | 'rate'
    lastTick: performance.now(),
    stateText: 'キューブを 2 台接続してください',
    stateKind: 'idle',  // idle | ready | run | warn
  };

  /** 追従が不感帯に収まっている状態。細かく出入りして揺れないよう覚えておく */
  let yawRest = false;

  /**
   * 画面のスライダーで前後を操作するモードの状態。value は -1〜1。
   * 向き（ヨー）はどちらのモードでもキューブから取るので、ここには持たない。
   */
  const throttle = { value: 0, holding: false };

  /** 前後をどちらで操作するか */
  const fwdFromStick = () => $('radFwdStick').checked;

  /** 推測航法。単位は mm、角度は位置IDと同じ向き（x 右・y 下・時計回りが正） */
  const odo = { x: 0, y: 0, angle: 0 };
  const odoTrail = [];
  const idTrail = [];

  /**
   * ロールの割り当て。いまは「なし」だけ。
   * 拡張するときはここに (ctx) => void を足し、rollAction を切り替える。
   * ctx = { roll, cmd } で、cmd.fwd / cmd.turn を書き換えれば操作に効く。
   */
  const ROLL_ACTIONS = {
    none: function () { /* 未使用 */ },
  };
  let rollAction = 'none';

  // ------------------------------------------------------------ 設定の保存
  const SETTINGS_KEY = 'toio-link-control';
  const settingEls = () => Array.from(document.querySelectorAll('[data-setting]'));
  const defaults = {};

  /*
   * 保存済みの設定を新しい既定値に入れ替えるための版番号。
   * 既定値を直しても、いちど保存した端末では古い値が残り続けてしまう。
   * ここを上げると、下の一覧にあるキーだけ保存値を捨てて既定値を入れ直す。
   */
  const SETTINGS_VERSION = 2;
  const MIGRATIONS = {
    // v2: 追従が振動するため、旋回の速さを半分にして途切れの扱いを二段構えにした
    2: ['numTurnMax', 'numTurnMin', 'numYawKd', 'numTurnRamp', 'numRateGain', 'numAttInterval'],
  };

  const isToggle = (el) => el.type === 'checkbox' || el.type === 'radio';
  function readEl(el) { return isToggle(el) ? el.checked : el.value; }
  function writeEl(el, v) {
    if (isToggle(el)) el.checked = !!v;
    else el.value = v;
  }

  function captureDefaults() {
    for (const el of settingEls()) defaults[el.id] = readEl(el);
  }

  function saveSettings() {
    const o = { __v: SETTINGS_VERSION };
    for (const el of settingEls()) o[el.id] = readEl(el);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(o)); } catch (e) { /* 保存できなくても動く */ }
  }

  function loadSettings() {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { o = null; }
    if (!o) return;

    // 版が古ければ、見直したキーだけ保存値を使わず既定値のままにする
    const from = Number(o.__v) || 1;
    const stale = new Set();
    for (let v = from + 1; v <= SETTINGS_VERSION; v++) {
      for (const key of MIGRATIONS[v] || []) stale.add(key);
    }

    for (const el of settingEls()) {
      if (stale.has(el.id)) continue;
      if (Object.prototype.hasOwnProperty.call(o, el.id)) writeEl(el, o[el.id]);
    }

    if (stale.size) {
      saveSettings();
      setTimeout(() => toast('追従の設定を新しい既定値に更新しました（設定の「追従」タブで調整できます）'), 600);
    }
  }

  function resetSettings() {
    for (const el of settingEls()) writeEl(el, defaults[el.id]);
    saveSettings();
    syncSettingOutputs();
    toast('設定を既定値に戻しました');
  }

  /** スライダーの脇に出している数値を更新する */
  function syncSettingOutputs() {
    $('outPitchExpo').textContent = $('numPitchExpo').value + '%';
    $('outYawCurve').textContent = $('numYawCurve').value + '%';
    $('outCamAzim').textContent = $('numCamAzim').value + '°';
    $('outCamElev').textContent = $('numCamElev').value + '°';
    $('outCamZoom').textContent = $('numCamZoom').value + '%';
    $('matSelectWrap').classList.toggle('hidden', $('selTrailSource').value !== 'id');
    $('deadHint').classList.toggle('hidden', $('selTrailSource').value !== 'dead');
  }

  document.addEventListener('input', (e) => {
    if (!e.target.hasAttribute || !e.target.hasAttribute('data-setting')) return;
    syncSettingOutputs();
    saveSettings();
  });
  document.addEventListener('change', (e) => {
    if (!e.target.hasAttribute || !e.target.hasAttribute('data-setting')) return;
    syncSettingOutputs();
    saveSettings();
  });

  $('btnSettingsReset').addEventListener('click', resetSettings);

  // ---------------------------------------------------------------- トースト
  let toastTimer = 0;
  const lastToast = { msg: '', at: 0 };

  function toast(msg) {
    // 同じ知らせを短い間に何度も出さない。BLE が混んでいるときの
    // 「途切れました」が連呼されると、それだけで画面が使えなくなる
    const now = Date.now();
    if (msg === lastToast.msg && now - lastToast.at < 8000) return;
    lastToast.msg = msg;
    lastToast.at = now;

    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- 姿勢角
  function quatToEuler(q) {
    const { w, x, y, z } = q;
    const sinr = 2 * (w * x + y * z);
    const cosr = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr, cosr) * 180 / Math.PI;
    let sinp = 2 * (w * y - z * x);
    sinp = clamp(sinp, -1, 1);
    const pitch = Math.asin(sinp) * 180 / Math.PI;
    const siny = 2 * (w * z + x * y);
    const cosy = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny, cosy) * 180 / Math.PI;
    return { roll, pitch, yaw };
  }

  /** キューブの姿勢角を roll/pitch/yaw（度）で取り出す。形式の違いはここで吸収する */
  function eulerOf(cube) {
    const a = cube && cube.attitude;
    if (!a) return null;
    if (a.format === 2) return quatToEuler(a);
    return { roll: a.roll, pitch: a.pitch, yaw: a.yaw };
  }

  /** 直近 ms 以内に姿勢角の通知が来ているか */
  function attitudeFresh(cube, ms) {
    return !!(cube && cube.connected && cube.attitudeAt && Date.now() - cube.attitudeAt <= ms);
  }

  // ------------------------------------------------------------ 接続と役割
  async function connect(role) {
    const btn = $(role === 'ctl' ? 'btnConnectCtl' : 'btnConnectTgt');
    try {
      const cube = await T.requestCube();
      const other = roles[role === 'ctl' ? 'tgt' : 'ctl'];
      if (other && other.id === cube.id && other.connected) {
        toast('そのキューブはもう一方の役割で接続済みです');
        return;
      }
      const prev = roles[role];
      if (prev && prev.connected) prev.disconnect();

      btn.disabled = true;
      btn.textContent = '接続中…';
      hookCube(cube, role);
      await cube.connect();
      roles[role] = cube;
      applyNotifications(cube, role);
      applyRoleLight(cube, role);
      renderRoles();
      toast(cube.name + ' を' + (role === 'ctl' ? 'コントローラ' : '操作対象') + 'にしました');
    } catch (e) {
      if (e && e.name === 'NotFoundError') return; // ユーザーがキャンセルしただけ
      toast('接続失敗: ' + (e.message || e));
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = '接続';
    }
  }

  function hookCube(cube, role) {
    cube.role = role;
    cube.attRate = { count: 0, hz: 0 };
    cube.on('log', (entry) => appendLog(cube, entry));
    cube.on('attitude', () => { cube.attRate.count++; });
    cube.on('battery', renderRoles);
    cube.on('button', (pressed) => { if (pressed) flash('evButton'); });
    cube.on('collision', () => flash('evCollision'));
    cube.on('doubleTap', () => flash('evDoubleTap'));
    cube.on('position', (p) => {
      if (cube.role !== 'tgt') return;
      pushTrail(idTrail, p.x, p.y);
    });
    cube.on('disconnect', () => {
      renderRoles();
      if (drive.running) setRunning(false, (cube.role === 'ctl' ? 'コントローラ' : '操作対象') + 'が切断されました');
      toast(cube.name + ' が切断されました');
    });
  }

  /** 役割ごとにランプの色を変えて、どちらがどちらか分かるようにする */
  function applyRoleLight(cube, role) {
    if (!chk('chkLight') || !cube || !cube.connected) return;
    const c = role === 'ctl' ? [31, 111, 235] : [63, 185, 80];
    const p = cube.light(c[0], c[1], c[2], 0);
    if (p && p.catch) p.catch(() => {});
  }

  function applyNotifications(cube, role) {
    if (!cube || !cube.connected) return;
    const guard = (p) => { if (p && p.catch) p.catch(() => {}); };
    guard(cube.setAttitudeDetection(num('selAttFormat'), num('numAttInterval'), num('selAttCondition')));
    if (role === 'tgt') {
      guard(cube.setIdNotification(num('numIdInterval'), num('selIdCondition')));
      guard(cube.setMotorSpeedFeedback(chk('chkMotorFeedback')));
    }
  }

  $('btnConnectCtl').addEventListener('click', () => connect('ctl'));
  $('btnConnectTgt').addEventListener('click', () => connect('tgt'));

  $('btnDisconnectCtl').addEventListener('click', () => { if (roles.ctl) roles.ctl.disconnect(); roles.ctl = null; renderRoles(); });
  $('btnDisconnectTgt').addEventListener('click', () => {
    if (roles.tgt) { stopMotors(); roles.tgt.disconnect(); }
    roles.tgt = null;
    renderRoles();
  });

  $('btnSwap').addEventListener('click', () => {
    if (!roles.ctl && !roles.tgt) { toast('接続されているキューブがありません'); return; }
    setRunning(false, '役割を入れ替えました');
    stopMotors();
    const a = roles.ctl, b = roles.tgt;
    roles.ctl = b; roles.tgt = a;
    if (roles.ctl) { roles.ctl.role = 'ctl'; applyNotifications(roles.ctl, 'ctl'); applyRoleLight(roles.ctl, 'ctl'); }
    if (roles.tgt) { roles.tgt.role = 'tgt'; applyNotifications(roles.tgt, 'tgt'); applyRoleLight(roles.tgt, 'tgt'); }
    resetAcc(ctlYaw); resetAcc(tgtYaw);
    anchor.has = false;
    drive.source = null;
    renderRoles();
  });

  $('btnApplyNotify').addEventListener('click', () => {
    if (!roles.ctl && !roles.tgt) { toast('接続されているキューブがありません'); return; }
    applyNotifications(roles.ctl, 'ctl');
    applyNotifications(roles.tgt, 'tgt');
    toast('通知設定を送りました');
  });

  function renderRoles() {
    for (const [role, ids] of [['ctl', ['cardCtl', 'ctlName', 'ctlSub', 'btnConnectCtl', 'btnDisconnectCtl']],
      ['tgt', ['cardTgt', 'tgtName', 'tgtSub', 'btnConnectTgt', 'btnDisconnectTgt']]]) {
      const cube = roles[role];
      const [card, name, sub, con, dis] = ids.map($);
      const on = !!(cube && cube.connected);
      card.classList.toggle('on', on);
      name.textContent = on ? shortName(cube) : '未接続';
      sub.textContent = on && cube.battery !== null ? cube.battery + '%' : '';
      con.classList.toggle('hidden', on);
      dis.classList.toggle('hidden', !on);
    }
    $('btnRun').disabled = !(roles.ctl && roles.ctl.connected && roles.tgt && roles.tgt.connected);
  }

  function shortName(cube) {
    return cube.name.replace(/^toio Core Cube[-\s]*/i, '') || cube.name;
  }

  function flash(id) {
    const el = $(id);
    el.classList.add('fire');
    setTimeout(() => el.classList.remove('fire'), 400);
  }

  // ------------------------------------------------------------ 走行の開始・停止
  function setRunning(on, reason) {
    if (on === drive.running) return;
    drive.running = on;
    for (const id of ['btnRun', 'fsBtnRun']) {
      $(id).textContent = on ? '走行停止' : '走行開始';
      $(id).classList.toggle('danger', on);
      $(id).classList.toggle('primary', !on);
    }
    if (on) {
      captureZero(true);
      drive.fwd = 0; drive.turn = 0; drive.prevErr = null;
      signCheck.score = 0;
      if (chk('chkSound') && roles.tgt) safe(roles.tgt.soundEffect(0, 200));
    } else {
      stopMotors();
      if (chk('chkSound') && roles.tgt && roles.tgt.connected) safe(roles.tgt.soundEffect(2, 180));
    }
    if (reason) toast(reason);
  }

  function safe(p) { if (p && p.catch) p.catch(() => {}); return p; }

  function stopMotors() {
    drive.fwd = 0; drive.turn = 0; drive.l = 0; drive.r = 0;
    setThrottle(0);   // 画面のスライダーも中立に戻す。倒したままだと再開時にいきなり走る
    const t = roles.tgt;
    if (t && t.connected) safe(t.stop());
  }

  $('btnRun').addEventListener('click', () => setRunning(!drive.running));
  $('btnEstop').addEventListener('click', () => {
    setRunning(false);
    stopMotors();
    toast('停止しました');
  });

  window.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space' || e.code === 'Escape') {
      e.preventDefault();
      setRunning(false);
      stopMotors();
    }
  });

  window.addEventListener('blur', () => { if (drive.running) setRunning(false, 'ページから離れたので停止しました'); });

  /** いまの姿勢を基準（中立）にする。走行開始時にも呼ばれる */
  function captureZero(quiet) {
    const ctl = roles.ctl;
    const e = ctl ? eulerOf(ctl) : null;
    if (!e) { if (!quiet) toast('コントローラの姿勢角がまだ届いていません'); return false; }
    accumulate(ctlYaw, e.yaw);
    anchor.ctlAcc = ctlYaw.acc;
    anchor.pitch = e.pitch;
    anchor.roll = e.roll;
    anchor.heading = drive.actual === null ? 0 : drive.actual;
    anchor.has = true;
    drive.prevErr = null;
    if (!quiet) toast('いまの姿勢を基準にしました');
    return true;
  }

  // -------------------------------------------- 画面のスライダー（前後）
  // パネルの中と全画面モードに 1 本ずつあり、どちらも同じ throttle を動かす
  const throttleSticks = [];

  /** つまみは「枠の高さ − つまみの高さ」の範囲で動かす。大きさが違っても同じ操作感になる */
  function placeKnob(s) {
    const travel = Math.max(0, (s.el.clientHeight - s.knob.offsetHeight) / 2);
    s.knob.style.transform = `translateY(${-throttle.value * travel}px)`;
  }

  function setThrottle(v) {
    throttle.value = clamp(v, -1, 1);
    for (const s of throttleSticks) placeKnob(s);
    const text = Math.round(throttle.value * 100) + '%';
    $('throttleVal').textContent = text;
    $('fsThrottleVal').textContent = text;
  }

  function bindThrottleStick(elId, knobId) {
    const el = $(elId), knob = $(knobId);
    const s = { el, knob };
    throttleSticks.push(s);

    const fromEvent = (e) => {
      const r = el.getBoundingClientRect();
      setThrottle(-(e.clientY - (r.top + r.height / 2)) / (r.height / 2));   // 上へ倒すほど前進
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      throttle.holding = true;
      el.classList.add('active');
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      fromEvent(e);
    });
    el.addEventListener('pointermove', (e) => { if (throttle.holding) fromEvent(e); });
    el.addEventListener('pointerup', releaseThrottle);
    el.addEventListener('pointercancel', releaseThrottle);
  }

  function releaseThrottle() {
    if (!throttle.holding) return;
    throttle.holding = false;
    for (const s of throttleSticks) s.el.classList.remove('active');
    if (!chk('chkThrottleHold')) setThrottle(0);   // 離したら中立に戻す
  }

  bindThrottleStick('stickFwd', 'stickFwdKnob');
  bindThrottleStick('fsStick', 'fsStickKnob');
  window.addEventListener('blur', releaseThrottle);
  // 画面の向きや大きさが変わるとつまみの可動域も変わる
  window.addEventListener('resize', () => { for (const s of throttleSticks) placeKnob(s); });

  $('btnThrottleZero').addEventListener('click', () => setThrottle(0));

  // ------------------------------------------------ 全画面モード
  let fsNative = false;

  function fsOpen() { return !$('fsThrottle').classList.contains('hidden'); }

  function openFs() {
    $('fsThrottle').classList.remove('hidden');
    for (const s of throttleSticks) placeKnob(s);   // 表示された直後は高さが確定している
    // 使えるならブラウザの全画面にも入る。使えなくても画面いっぱいの表示にはなる
    const el = $('fsThrottle');
    if (el.requestFullscreen) {
      el.requestFullscreen().then(() => { fsNative = true; }, () => { fsNative = false; });
    }
  }

  function closeFs() {
    $('fsThrottle').classList.add('hidden');
    releaseThrottle();
    if (fsNative && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    fsNative = false;
  }

  $('btnThrottleFs').addEventListener('click', openFs);
  $('fsBtnClose').addEventListener('click', closeFs);
  $('fsBtnZero').addEventListener('click', () => captureZero(false));
  $('fsBtnRun').addEventListener('click', () => setRunning(!drive.running));
  $('fsBtnStop').addEventListener('click', () => { setRunning(false); stopMotors(); toast('停止しました'); });

  // ブラウザ側で全画面を抜けたとき（スワイプなど）は表示も閉じる
  document.addEventListener('fullscreenchange', () => {
    if (fsNative && !document.fullscreenElement) closeFs();
  });

  /** モードを切り替えたら必ず中立から始める。前のモードの値が残ると危ない */
  function applyFwdMode() {
    const stick = fwdFromStick();
    $('throttleWrap').classList.toggle('hidden', !stick);
    if (!stick && fsOpen()) closeFs();   // 傾けるモードに戻したら全画面も閉じる
    releaseThrottle();
    setThrottle(0);
  }

  for (const id of ['radFwdPitch', 'radFwdStick']) {
    $(id).addEventListener('change', applyFwdMode);
  }

  for (const id of ['btnZero', 'btnZeroTop']) {
    $(id).addEventListener('click', () => captureZero(false));
  }
  $('btnRezeroHint').addEventListener('click', () => {
    toast('コントローラを持ちたい向き・角度に構えてから押すと、その姿勢が「まっすぐ・停止」になります');
  });

  // ------------------------------------------------------------ 向きの取得
  /**
   * 操作対象の「いまの向き」を返す。取得元は設定と実際に届いているデータで決まる。
   * @returns {{v:number, s:string}|null}
   */
  function resolveHeading() {
    const tgt = roles.tgt;
    if (!tgt || !tgt.connected) return null;
    const mode = $('selHeadingSource').value;
    if (mode === 'rate') return null;

    // 実測の向きは制御ほど新しさを求めない。ホールドの間も直前の値で追い続ける
    const stale = Math.max(num('numStaleStop'), 500);
    const byId = () => (tgt.onMat && tgt.position) ? { v: wrap360(tgt.position.angle), s: 'id' } : null;
    const byYaw = () => {
      if (!attitudeFresh(tgt, stale)) return null;
      return { v: wrap360(tgtYaw.acc * (chk('chkHeadingInvert') ? -1 : 1)), s: 'yaw' };
    };
    const byDead = () => ({ v: wrap360(odo.angle), s: 'dead' });

    if (mode === 'id') return byId();
    if (mode === 'yaw') return byYaw();
    if (mode === 'dead') return byDead();
    return byId() || byYaw() || byDead();
  }

  const HEADING_LABEL = {
    id: '位置ID', yaw: '姿勢角（ヨー）', dead: '推測航法',
    rate: '追従なし（設定）', none: '取得できず → 追従なし',
  };

  // ヨーの符号が逆だと追従が発散する。指示した旋回と実測の変化を突き合わせて気づけるようにする。
  const signCheck = { score: 0, warned: false, prev: null };

  function checkYawSign(actual, turn) {
    if (actual === null || drive.source === 'dead' || !drive.running) { signCheck.prev = actual; return; }
    const prev = signCheck.prev;
    signCheck.prev = actual;
    if (prev === null) return;
    const d = wrap180(actual - prev);
    if (Math.abs(turn) < 12 || Math.abs(d) < 0.3) return;
    signCheck.score += Math.sign(turn) * Math.sign(d) > 0 ? 1 : -1;
    if (signCheck.score < -25 && !signCheck.warned) {
      signCheck.warned = true;
      toast('旋回の向きと実測の向きが逆です。設定の「操作対象のヨーを反転」を試してください');
    }
  }

  // ------------------------------------------------------------ 推測航法
  function pushTrail(arr, x, y) {
    const last = arr[arr.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) < 1) return;
    arr.push([x, y]);
    const lim = clamp(num('numTrailLen'), 50, 5000);
    while (arr.length > lim) arr.shift();
  }

  function stepOdometry(dt, actual) {
    const tgt = roles.tgt;
    if (!tgt || !tgt.connected) return;
    const s = tgt.speedEstimate || { left: 0, right: 0 };
    const k = num('numDrScale') || 1;
    const tread = Math.max(1, num('numDrTread') || 27);
    const vl = s.left * k, vr = s.right * k;   // mm/s
    const v = (vl + vr) / 2;

    // 実測の向きが取れているならそれを使う。取れていないぶんだけ積算に頼る
    if (actual !== null && drive.source !== 'dead') odo.angle = actual;
    else odo.angle = wrap360(odo.angle + ((vl - vr) / tread) * dt * 180 / Math.PI);

    if (!vl && !vr) return;
    const rad = odo.angle * Math.PI / 180;
    odo.x += v * dt * Math.cos(rad);
    odo.y += v * dt * Math.sin(rad);
    pushTrail(odoTrail, odo.x, odo.y);
  }

  function resetOdometry() {
    odo.x = 0; odo.y = 0; odo.angle = 0;
    odoTrail.length = 0;
    idTrail.length = 0;
    resetAcc(tgtYaw);
    drive.source = null;   // 取得元を取り直させて基準もずらす
    anchor.has = false;
  }

  $('btnResetOdom').addEventListener('click', () => { resetOdometry(); toast('原点・0°に戻しました'); });
  $('btnClearTrail').addEventListener('click', () => { odoTrail.length = 0; idTrail.length = 0; });

  // ------------------------------------------------------------ 制御ループ
  let tickTimer = 0;

  function scheduleTick() {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(() => { try { controlTick(); } catch (e) { console.error(e); } scheduleTick(); },
      clamp(num('numSendMs') || 60, 30, 500));
  }

  function setState(kind, text) { drive.stateKind = kind; drive.stateText = text; }

  function controlTick() {
    const now = performance.now();
    const dt = Math.min(0.5, Math.max(0.001, (now - drive.lastTick) / 1000));
    drive.lastTick = now;

    const ctl = roles.ctl, tgt = roles.tgt;

    // ---- 入力（コントローラの姿勢角）
    const ce = ctl && ctl.connected ? eulerOf(ctl) : null;
    if (ce) accumulate(ctlYaw, ce.yaw);
    const te = tgt && tgt.connected ? eulerOf(tgt) : null;
    if (te) accumulate(tgtYaw, te.yaw);

    // ---- 操作対象の向き
    const res = resolveHeading();
    const src = res ? res.s : ($('selHeadingSource').value === 'rate' ? 'rate' : 'none');
    if (src !== drive.source) {
      // 取得元が変わると角度の基準もずれるので、その瞬間を中立として取り直す。
      // こうしておけば、マットから外れて推測航法に落ちても急に回り出さない
      drive.source = src;
      anchor.heading = res ? res.v : 0;
      anchor.ctlAcc = ctlYaw.acc;
      anchor.has = true;
      drive.prevErr = null;
      signCheck.prev = null;
    }
    drive.actual = res ? res.v : null;

    stepOdometry(dt, drive.actual);

    // ---- 走行できる状態か
    // ok=false のあいだは指令を 0 にする。stop=true は走行そのものを打ち切る。
    //
    // 姿勢角の通知は、走っているあいだ BLE が混むと数百 ms 平気で飛ぶ。そのたびに
    // 走行を解除すると「停止しました」が出っぱなしになるので、二段構えにする。
    //   ホールド … 指令だけ 0 にして待つ。復帰したらそのまま走り続けられる
    //   停止     … それでも戻らなければ走行を解除する
    const hold = num('numStaleHold');
    const stopMs = Math.max(num('numStaleStop'), hold);
    const age = ctl && ctl.attitudeAt ? Date.now() - ctl.attitudeAt : Infinity;
    let ok = true, stop = false;
    if (!ctl || !ctl.connected || !tgt || !tgt.connected) {
      setState('idle', 'キューブを 2 台接続してください');
      ok = false; stop = true;
    } else if (!ce) {
      setState('warn', 'コントローラの姿勢角が届いていません（設定の「通知」タブで適用してください）');
      ok = false;
    } else if (age > hold) {
      setState('warn', `姿勢角の通知が ${Math.round(age)}ms 途切れています（復帰待ち）`);
      ok = false;
      if (age > stopMs) stop = true;
    } else if (!drive.running) {
      setState('ready', '準備完了。走行開始を押してください');
    } else if (chk('chkDeadman') && !ctl.button) {
      setState('warn', 'コントローラのボタンを押している間だけ走ります');
      ok = false;
    } else {
      setState('run', '走行中');
    }

    if (drive.running && stop) {
      setRunning(false, `姿勢角が ${Math.round(stopMs / 100) / 10} 秒以上途切れたので停止しました`);
      ok = false;
    }

    // ---- 前後。キューブの傾きか、画面のスライダーか
    let t = 0;                       // -1〜1 に正規化した倒し量
    if (fwdFromStick()) {
      t = clamp(throttle.value, -1, 1);
    } else if (ce) {
      const zeroPitch = chk('chkZeroPitch') && anchor.has ? anchor.pitch : 0;
      // キューブのピッチは「上向きが正・下向きが負」。前に傾ける＝負なので、
      // そのままだと前後が逆になる。既定で符号を反転して「前傾＝前進」にする
      const p = (ce.pitch - zeroPitch) * (chk('chkPitchInvert') ? 1 : -1);
      const dead = num('numPitchDead');
      const full = Math.max(num('numPitchFull'), dead + 1);
      const a = Math.abs(p);
      if (a > dead) t = Math.sign(p) * Math.min(1, (a - dead) / (full - dead));
    }
    // 反応カーブと最大速度はどちらのモードでも共通にかける
    const expo = clamp(num('numPitchExpo') / 100, 0, 1);
    const wantFwd = ((1 - expo) * t + expo * t * t * t) * num('numSpeedMax');   // t³ は符号を保つ

    // ---- 向き（ヨー）
    const ratio = num('numYawRatio') || 1;
    const ysign = chk('chkYawInvert') ? -1 : 1;
    const cmdDelta = anchor.has ? (ctlYaw.acc - anchor.ctlAcc) * ysign * ratio : 0;

    let err = null;
    if (!ce) {
      drive.desired = null;
    } else if (drive.actual === null) {
      // 追従なし（オープンループ）。ヨーの差をそのまま旋回の速さにする
      drive.desired = null;
      err = wrap180(cmdDelta);
    } else {
      drive.desired = wrap360(anchor.heading + cmdDelta);
      err = wrap180(drive.desired - drive.actual);
    }

    // ---- 旋回の速さ
    // 誤差にそのまま比例させると、BLE の往復と車体の慣性のぶんだけ行き過ぎて振動する。
    // 「遠ければ速く、近づくほど緩やかに」を素直な形にして、上限も低めに置く。
    let turn = 0;
    if (err !== null) {
      const dead = num('numYawDead');
      // 不感帯にはヒステリシスを持たせる。境目で出入りを繰り返すと小刻みに揺れるため、
      // いちど収まったら「不感帯の 2.5 倍 + 1 度」ずれるまで動き出さない
      if (yawRest) { if (Math.abs(err) > dead * 2.5 + 1) yawRest = false; }
      else if (Math.abs(err) <= dead) yawRest = true;

      if (!yawRest) {
        const tmax = num('numTurnMax');
        const eff = Math.max(0, Math.abs(err) - dead);   // 不感帯の外側だけを見る
        let mag;
        if (drive.actual === null) {
          // 追従なし（開ループ）。倒した角度がそのまま旋回の速さになる
          mag = num('numRateGain') * eff;
        } else {
          const full = Math.max(num('numYawFull'), 1);   // ここまで離れたら全速
          const t = clamp(eff / full, 0, 1);
          const c = clamp(num('numYawCurve') / 100, 0, 1);
          const shaped = (1 - c) * t + c * t * t;        // c を上げるほど近くで緩やかになる
          const tmin = Math.min(num('numTurnMin'), tmax);
          // 不感帯を出た瞬間が最低速度、離れるほど最大速度へ。段差なくつながる
          mag = tmin + (tmax - tmin) * shaped;
        }
        let u = Math.sign(err) * mag;
        if (drive.actual !== null && drive.prevErr !== null) {
          // 誤差が縮まっている勢いに応じて先に緩める（行き過ぎ防止）。
          // またぎでの跳ねは wrap で潰す
          u += num('numYawKd') * (wrap180(err - drive.prevErr) / dt);
        }
        turn = clamp(u, -tmax, tmax);
      }
    } else {
      yawRest = false;
    }
    drive.prevErr = err;
    drive.err = err;

    // ---- なまし
    // 前後も旋回も、指令をそのまま送ると段差が出る。時定数を分けて別々になます
    const ramp = num('numRampMs');
    const tramp = num('numTurnRamp');
    if (!ok) {
      drive.fwd = 0; drive.turn = 0;
    } else {
      if (ramp <= 0) drive.fwd = wantFwd;
      else drive.fwd += (wantFwd - drive.fwd) * (1 - Math.exp(-dt * 1000 / ramp));
      if (tramp <= 0) drive.turn = turn;
      else drive.turn += (turn - drive.turn) * (1 - Math.exp(-dt * 1000 / tramp));
    }

    // ---- ロール（拡張点）
    (ROLL_ACTIONS[rollAction] || ROLL_ACTIONS.none)({ roll: ce ? ce.roll - anchor.roll : 0, cmd: drive });

    // ---- 左右のモーターへ
    let l = drive.fwd + drive.turn;
    let r = drive.fwd - drive.turn;
    const peak = Math.max(Math.abs(l), Math.abs(r));
    if (peak > 115) { l = l * 115 / peak; r = r * 115 / peak; }   // 比を保ったまま頭打ちにする
    // 表示は「実際に送っている値」に合わせる。走っていないのに数字が出ていると紛らわしい
    const sending = ok && drive.running;
    drive.l = sending ? Math.round(l) : 0;
    drive.r = sending ? Math.round(r) : 0;

    checkYawSign(drive.actual, drive.turn);

    // 走行中は「止めるべきとき」も 0 を送る。送らないと直前の速度で走り続けてしまう
    if (drive.running && tgt && tgt.connected) safe(tgt.motor(drive.l, drive.r));

    updateCommandUi();
  }

  // ---------------------------------------------------------------- 表示
  function setBar(id, v, max) {
    const el = $(id);
    const pct = clamp(v / max, -1, 1) * 50;
    el.style.left = (pct < 0 ? 50 + pct : 50) + '%';
    el.style.width = Math.abs(pct) + '%';
  }

  function updateCommandUi() {
    setBar('barFwd', drive.fwd, 115);
    setBar('barTurn', drive.turn, 115);
    setBar('barErr', drive.err === null ? 0 : drive.err, 90);
    $('valFwd').textContent = Math.round(drive.fwd);
    $('valTurn').textContent = Math.round(drive.turn);
    $('valErr').textContent = drive.err === null ? '—' : Math.round(drive.err) + '°';
    $('valL').textContent = drive.l;
    $('valR').textContent = drive.r;
    $('valHeadSrc').textContent = drive.source ? HEADING_LABEL[drive.source] : '—';
    $('valDesired').textContent = drive.desired === null ? '—' : Math.round(drive.desired) + '°';

    const line = $('stateLine');
    line.className = 'state-line ' + drive.stateKind;
    $('stateText').textContent = drive.stateText;

    // 全画面モードの読み出し
    $('fsState').textContent = drive.stateText;
    $('fsCmd').textContent = `${Math.round(drive.fwd)} / ${Math.round(drive.turn)}`;
    $('fsErr').textContent = drive.err === null ? '—' : Math.round(drive.err) + '°';
  }

  function updateStatus() {
    const set = (id, v) => { $(id).textContent = v === null || v === undefined ? '—' : v; };

    for (const [role, p] of [['ctl', 'stCtl'], ['tgt', 'stTgt']]) {
      const c = roles[role];
      const on = !!(c && c.connected);
      set(p + 'Conn', on ? '接続中' : '未接続');
      $(p + 'Conn').className = on ? 'ok' : 'off';
      set(p + 'Name', on ? shortName(c) : null);
      set(p + 'Batt', on && c.battery !== null ? c.battery + '%' : null);
      set(p + 'Btn', on ? (c.button ? '押されている' : '離されている') : null);
      const e = on ? eulerOf(c) : null;
      set(p + 'Att', e ? `${e.roll.toFixed(0)} / ${e.pitch.toFixed(0)} / ${e.yaw.toFixed(0)}` : null);
      set(p + 'Proto', on ? c.protocolVersion : null);
    }

    const ctl = roles.ctl;
    set('stCtlRate', ctl && ctl.connected ? ctl.attRate.hz.toFixed(0) + ' Hz' : null);
    const m = ctl && ctl.motion;
    set('stCtlFlat', m ? (m.flat ? '水平' : '傾き') + ' / ' + m.postureName : null);

    const tgt = roles.tgt;
    set('stTgtPos', tgt && tgt.position && tgt.onMat
      ? `${tgt.position.x}, ${tgt.position.y} (${tgt.position.angle}°)`
      : (tgt && tgt.connected ? 'マット外' : null));
    set('stTgtSpeed', tgt && tgt.motorSpeed ? `左 ${tgt.motorSpeed.left} / 右 ${tgt.motorSpeed.right}` : null);

    const ce = ctl && ctl.connected ? eulerOf(ctl) : null;
    set('valRoll', ce ? ce.roll.toFixed(1) + '°' : null);
    set('valPitch', ce ? ce.pitch.toFixed(1) + '°' : null);
    set('valYaw', ce ? ce.yaw.toFixed(1) + '°' : null);

    set('valPos', tgt && tgt.position && tgt.onMat ? `${tgt.position.x}, ${tgt.position.y}` : null);
    set('valPosAngle', tgt && tgt.position && tgt.onMat ? tgt.position.angle + '°' : null);
    set('valOdo', `${Math.round(odo.x)}, ${Math.round(odo.y)}`);
    set('valOdoAngle', Math.round(wrap360(odo.angle)) + '°');

    $('cardCtl').classList.toggle('live', attitudeFresh(ctl, 1000));
  }

  setInterval(updateStatus, 200);

  // 姿勢角が毎秒何回届いているか。詰まっているかどうかの目安になる
  setInterval(() => {
    for (const role of ['ctl', 'tgt']) {
      const c = roles[role];
      if (!c) continue;
      c.attRate.hz = c.attRate.count;
      c.attRate.count = 0;
    }
  }, 1000);

  // ------------------------------------------------------------ キャンバス共通
  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }

  // ------------------------------------------------------------ 軌跡（2D）
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

  const mapCanvas = $('mapCanvas');
  const mapCtx = mapCanvas.getContext('2d');

  const isDead = () => $('selTrailSource').value === 'dead';

  /** 推測航法の地図は、角度 0（＝リセット直後の向き）が上に来るよう表示だけ回す */
  function drRotate(x, y) { return [y, -x]; }

  function deadView() {
    let minX = -150, minY = -150, maxX = 150, maxY = 150;
    const pts = odoTrail.concat([[odo.x, odo.y]]);
    for (const p of pts) {
      const [x, y] = drRotate(p[0], p[1]);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pad = 40;
    return { name: '推測航法', minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  function updateAutoMat() {
    if ($('selMat').value !== 'auto') return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of idTrail) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) return;
    const margin = 30;
    autoMat.minX = minX - margin; autoMat.maxX = Math.max(maxX + margin, minX - margin + 50);
    autoMat.minY = minY - margin; autoMat.maxY = Math.max(maxY + margin, minY - margin + 50);
  }

  function matTransform(mat, w, h, padCss) {
    const pad = padCss * (window.devicePixelRatio || 1);
    const mw = mat.maxX - mat.minX, mh = mat.maxY - mat.minY;
    const scale = Math.min((w - pad * 2) / mw, (h - pad * 2) / mh);
    return {
      scale,
      ox: (w - mw * scale) / 2 - mat.minX * scale,
      oy: (h - mh * scale) / 2 - mat.minY * scale,
    };
  }

  function drawArrow(ctx, x, y, angleDeg, size, fill, stroke) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.65, size * 0.58);
    ctx.lineTo(-size * 0.65, -size * 0.58);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, size * 0.14); ctx.stroke(); }
    ctx.restore();
  }

  function renderMap() {
    const cv = mapCanvas, ctx = mapCtx;
    const dpr = fitCanvas(cv);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    const dead = isDead();
    if (!dead) updateAutoMat();
    const mat = dead ? deadView() : ($('selMat').value === 'auto' ? autoMat : MATS[$('selMat').value]);
    const tf = matTransform(mat, w, h, 26);
    const X = (x) => x * tf.scale + tf.ox;
    const Y = (y) => y * tf.scale + tf.oy;
    const toScreen = dead
      ? (x, y) => { const p = drRotate(x, y); return [X(p[0]), Y(p[1])]; }
      : (x, y) => [X(x), Y(y)];

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

    ctx.fillStyle = '#8b949e';
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    if (dead) {
      ctx.strokeStyle = '#8b949e';
      ctx.beginPath();
      ctx.moveTo(X(-12), Y(0)); ctx.lineTo(X(12), Y(0));
      ctx.moveTo(X(0), Y(-12)); ctx.lineTo(X(0), Y(12));
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('0°', (X(mat.minX) + X(mat.maxX)) / 2, Y(mat.minY) + 3 * dpr);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`向き: ${drive.source ? HEADING_LABEL[drive.source] : '—'}`, X(mat.minX) + 4 * dpr, Y(mat.maxY) - 4 * dpr);
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(`${mat.minX}, ${mat.minY}`, X(mat.minX) + 4 * dpr, Y(mat.minY) + 4 * dpr);
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      ctx.fillText(`${mat.maxX}, ${mat.maxY}`, X(mat.maxX) - 4 * dpr, Y(mat.maxY) - 4 * dpr);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // 軌跡
    const trail = dead ? odoTrail : idTrail;
    if (chk('chkShowTrail') && trail.length > 1) {
      ctx.strokeStyle = 'rgba(63,185,80,0.5)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      const p0 = toScreen(trail[0][0], trail[0][1]);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < trail.length; i++) {
        const p = toScreen(trail[i][0], trail[i][1]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    // いまの位置と向き
    const tgt = roles.tgt;
    const live = !!(tgt && tgt.connected);
    const pose = !live ? null
      : (dead ? { x: odo.x, y: odo.y, angle: odo.angle }
        : (tgt.onMat && tgt.position ? tgt.position : null));
    if (!pose) return;
    const [px, py] = toScreen(pose.x, pose.y);
    const rot = pose.angle - (dead ? 90 : 0);   // 推測航法は表示を 90° 回している

    // 目標の向き（コントローラが示している向き）を薄く重ねる
    if (chk('chkShowGhost') && drive.desired !== null) {
      drawArrow(mapCtx, px, py, drive.desired - (dead ? 90 : 0), 20 * dpr, null, 'rgba(88,166,255,0.85)');
    }
    drawArrow(mapCtx, px, py, rot, 14 * dpr, '#3fb950', null);

    ctx.fillStyle = '#3fb950';
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    const label = tgt ? shortName(tgt) : '';
    const tw = ctx.measureText(label).width;
    if (px + 16 * dpr + tw > w) {
      ctx.textAlign = 'right';
      ctx.fillText(label, px - 16 * dpr, py + 4 * dpr);
      ctx.textAlign = 'left';
    } else {
      ctx.fillText(label, px + 16 * dpr, py + 4 * dpr);
    }
  }

  // ------------------------------------------------------------ 水準器
  const levelCanvas = $('levelCanvas');
  const levelCtx = levelCanvas.getContext('2d');

  function renderLevel() {
    const cv = levelCanvas, ctx = levelCtx;
    const dpr = fitCanvas(cv);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    const ctl = roles.ctl;
    const e = ctl && ctl.connected ? eulerOf(ctl) : null;
    const has = !!e;
    const roll = e ? e.roll : 0;
    const pitch = e ? e.pitch - (chk('chkZeroPitch') && anchor.has ? anchor.pitch : 0) : 0;

    const r = Math.min(h * 0.36, w * 0.16);
    const cy = h * 0.46;
    const cx = w * 0.19, dx = w * 0.53;

    // ---- 人工水平儀（ロールとピッチ）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-roll * Math.PI / 180);
    const off = clamp((pitch / 45) * r, -r, r);
    ctx.fillStyle = has ? '#1f6feb' : '#21262d';
    ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2 + off);
    ctx.fillStyle = has ? '#513c1c' : '#161b22';
    ctx.fillRect(-r * 2, off, r * 4, r * 2);
    ctx.strokeStyle = '#e6edf3';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(-r, off); ctx.lineTo(r, off);
    ctx.stroke();
    // ピッチの目盛り（10 度ごと）
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
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // 機体マーク（固定）
    ctx.strokeStyle = '#f0f6fc';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy); ctx.lineTo(cx - r * 0.15, cy);
    ctx.moveTo(cx + r * 0.15, cy); ctx.lineTo(cx + r * 0.5, cy);
    ctx.stroke();

    // ---- 方位盤（目標の向きと実測の向き）
    ctx.save();
    ctx.translate(dx, cy);
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8b949e';
    // 目盛りは方角ではなく角度で書く。ページのほかの表示（目標の向き・誤差）と単位を揃えるため。
    // 4 桁ぶんの幅が要るので、1 文字だったころより内側かつ小さめに置く
    ctx.font = `${8 * dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const deg of [0, 90, 180, 270]) {
      const a = (deg - 90) * Math.PI / 180;
      ctx.fillText(deg + '°', Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    }
    // 誤差の扇（目標と実測のあいだ）
    if (drive.desired !== null && drive.actual !== null) {
      const a0 = (drive.actual - 90) * Math.PI / 180;
      const a1 = (drive.desired - 90) * Math.PI / 180;
      ctx.fillStyle = 'rgba(88,166,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 0.5, a0, a1, wrap180(drive.desired - drive.actual) < 0);
      ctx.closePath();
      ctx.fill();
    }
    if (drive.actual !== null) drawArrow(ctx, 0, 0, drive.actual - 90, r * 0.48, '#3fb950', null);
    if (drive.desired !== null) drawArrow(ctx, 0, 0, drive.desired - 90, r * 0.62, null, '#58a6ff');
    ctx.restore();

    // ---- スロットル（前後の指令）
    const bx = w * 0.86, bw = w * 0.05, bh = r * 1.9;
    ctx.fillStyle = '#0d1117';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.rect(bx - bw / 2, cy - bh / 2, bw, bh);
    ctx.fill(); ctx.stroke();
    const f = clamp(drive.fwd / 115, -1, 1);
    ctx.fillStyle = f >= 0 ? '#3fb950' : '#d29922';
    ctx.fillRect(bx - bw / 2 + dpr, cy, bw - 2 * dpr, -f * (bh / 2 - dpr));
    ctx.strokeStyle = '#8b949e';
    ctx.beginPath();
    ctx.moveTo(bx - bw / 2, cy); ctx.lineTo(bx + bw / 2, cy);
    ctx.stroke();

    // ---- ラベル
    ctx.fillStyle = '#8b949e';
    ctx.font = `${10 * dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ly = cy + r + 8 * dpr;
    ctx.fillText('ロール / ピッチ', cx, ly);
    ctx.fillText('向き（青=目標 緑=実測）', dx, ly);
    ctx.fillText('前後', bx, ly);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ------------------------------------------------------------ 3D（姿勢）
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

  const cam = { azim: 35, elev: 28, zoom: 1 };

  function syncCam() {
    cam.azim = num('numCamAzim');
    cam.elev = num('numCamElev');
    cam.zoom = num('numCamZoom') / 100;
  }

  $('btnCamReset').addEventListener('click', () => {
    $('numCamAzim').value = defaults.numCamAzim;
    $('numCamElev').value = defaults.numCamElev;
    $('numCamZoom').value = defaults.numCamZoom;
    syncSettingOutputs();
    saveSettings();
  });

  // キャンバスを掴んで視点を回す
  let camDrag = null;
  poseCanvas.addEventListener('pointerdown', (e) => {
    camDrag = { x: e.clientX, y: e.clientY, azim: num('numCamAzim'), elev: num('numCamElev') };
    try { poseCanvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  });
  poseCanvas.addEventListener('pointermove', (e) => {
    if (!camDrag) return;
    $('numCamAzim').value = clamp(camDrag.azim - (e.clientX - camDrag.x) * 0.4, -180, 180);
    $('numCamElev').value = clamp(camDrag.elev + (e.clientY - camDrag.y) * 0.3, -10, 85);
    syncSettingOutputs();
  });
  const endCamDrag = () => { if (camDrag) { camDrag = null; saveSettings(); } };
  poseCanvas.addEventListener('pointerup', endCamDrag);
  poseCanvas.addEventListener('pointercancel', endCamDrag);

  // -------------------------------------------- 姿勢のミニ表示（浮かせる）
  // 操縦のパネルと姿勢を同時に見たいので、画面のどこにいても見える位置に浮かせる。
  // 掴めば動かせて、大きさも変えられる。閉じたら上のツールバーから戻せる。
  const MINI_SIZES = [130, 175, 230];
  const fsPoseCanvas = $('fsPoseCanvas');
  const fsPoseCtx = fsPoseCanvas.getContext('2d');
  const poseMini = $('poseMini');
  const poseMiniCanvas = $('poseMiniCanvas');
  const poseMiniCtx = poseMiniCanvas.getContext('2d');
  const MINI_KEY = 'toio-link-control-pose-mini';
  const miniState = { visible: true, size: 1, left: null, top: null };

  try { Object.assign(miniState, JSON.parse(localStorage.getItem(MINI_KEY) || '{}')); } catch (e) { /* 壊れていたら初期値 */ }

  function saveMiniState() {
    try { localStorage.setItem(MINI_KEY, JSON.stringify(miniState)); } catch (e) { /* noop */ }
  }

  /** 画面の外に出て掴めなくなるのを防ぐ */
  function clampMini() {
    if (miniState.left === null) return;
    const r = poseMini.getBoundingClientRect();
    const w = r.width || MINI_SIZES[miniState.size % MINI_SIZES.length];
    const h = r.height || w;
    miniState.left = Math.max(4, Math.min(window.innerWidth - w - 4, miniState.left));
    miniState.top = Math.max(4, Math.min(window.innerHeight - h - 4, miniState.top));
  }

  function applyMiniState() {
    poseMini.classList.toggle('hidden', !miniState.visible);
    poseMini.style.width = MINI_SIZES[miniState.size % MINI_SIZES.length] + 'px';
    if (miniState.left !== null && miniState.top !== null) {
      clampMini();
      poseMini.style.left = miniState.left + 'px';
      poseMini.style.top = miniState.top + 'px';
      poseMini.style.right = 'auto';
      poseMini.style.bottom = 'auto';
    }
    $('btnPoseMiniToggle').textContent = miniState.visible ? 'ミニ表示を隠す' : 'ミニ表示';
  }

  $('btnPoseMiniToggle').addEventListener('click', () => {
    miniState.visible = !miniState.visible;
    applyMiniState();
    saveMiniState();
  });

  $('btnPoseMiniHide').addEventListener('click', (e) => {
    e.stopPropagation();
    miniState.visible = false;
    applyMiniState();
    saveMiniState();
  });

  $('btnPoseMiniSize').addEventListener('click', (e) => {
    e.stopPropagation();
    miniState.size = (miniState.size + 1) % MINI_SIZES.length;
    applyMiniState();
    saveMiniState();
  });

  // ドラッグで好きな位置へ動かす
  let miniDrag = null;
  poseMini.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.minimap-btn')) return;
    const r = poseMini.getBoundingClientRect();
    miniDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    miniState.left = r.left;
    miniState.top = r.top;
    poseMini.classList.add('dragging');
    try { poseMini.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  });

  poseMini.addEventListener('pointermove', (e) => {
    if (!miniDrag) return;
    miniState.left = e.clientX - miniDrag.dx;
    miniState.top = e.clientY - miniDrag.dy;
    applyMiniState();
  });

  const endMiniDrag = () => {
    if (!miniDrag) return;
    miniDrag = null;
    poseMini.classList.remove('dragging');
    saveMiniState();
  };

  poseMini.addEventListener('pointerup', endMiniDrag);
  poseMini.addEventListener('pointercancel', endMiniDrag);
  window.addEventListener('resize', () => { clampMini(); applyMiniState(); });

  /** 直方体の 6 面を {pts(ローカル), n(法線)} で返す */
  function boxFaces(hx, hy, hz, cz) {
    const z0 = -hz + (cz || 0), z1 = hz + (cz || 0);
    const v = (x, y, z) => [x, y, z];
    return [
      { n: [1, 0, 0], pts: [v(hx, -hy, z0), v(hx, hy, z0), v(hx, hy, z1), v(hx, -hy, z1)] },
      { n: [-1, 0, 0], pts: [v(-hx, hy, z0), v(-hx, -hy, z0), v(-hx, -hy, z1), v(-hx, hy, z1)] },
      { n: [0, 1, 0], pts: [v(hx, hy, z0), v(-hx, hy, z0), v(-hx, hy, z1), v(hx, hy, z1)] },
      { n: [0, -1, 0], pts: [v(-hx, -hy, z0), v(hx, -hy, z0), v(hx, -hy, z1), v(-hx, -hy, z1)] },
      { n: [0, 0, 1], pts: [v(hx, -hy, z1), v(hx, hy, z1), v(-hx, hy, z1), v(-hx, -hy, z1)] },
      { n: [0, 0, -1], pts: [v(-hx, -hy, z0), v(-hx, hy, z0), v(hx, hy, z0), v(hx, -hy, z0)] },
    ];
  }

  const LIGHT = (() => {
    const v = [0.35, 0.5, 1];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  })();

  function shade(hex, k) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const f = (x) => Math.round(clamp(x * k, 0, 255));
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
  }

  /**
   * 姿勢の 3D を描く。浮かせたミニ表示からも同じ関数を使う。
   * @param {boolean} compact 軸のラベルや説明文を省いて小さく描く
   */
  function renderPose(cv, ctx, compact) {
    const dpr = fitCanvas(cv);
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    syncCam();

    const ctl = roles.ctl;
    const e = ctl && ctl.connected ? eulerOf(ctl) : null;
    const has = !!e;

    // 表示用の符号。IMU の向きの取り方は機体ごとに読み替えが要るので設定で反転できる
    const roll = (e ? e.roll : 0) * (chk('chk3dRollInv') ? -1 : 1);
    const pitch = (e ? e.pitch : 0) * (chk('chk3dPitchInv') ? -1 : 1);
    const yaw = (e ? e.yaw : 0) * (chk('chkYawInvert') ? -1 : 1);

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

    const FLOOR = -1.55;

    // ---- 床のグリッド
    if (chk('chkGrid')) {
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

    // ---- 向きのリング（青＝目標 緑＝操作対象の実測）
    if (chk('chkRing')) {
      const rr = 2.1;
      ctx.strokeStyle = 'rgba(139,148,158,0.55)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (let a = 0; a <= 360; a += 6) {
        const t = a * Math.PI / 180;
        const p = project([Math.cos(t) * rr, -Math.sin(t) * rr, FLOOR]);
        if (a === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      const mark = (deg, color, len) => {
        if (deg === null) return;
        const t = deg * Math.PI / 180;
        const a = project([Math.cos(t) * rr * 0.8, -Math.sin(t) * rr * 0.8, FLOOR]);
        const b = project([Math.cos(t) * rr * (0.8 + len), -Math.sin(t) * rr * (0.8 + len), FLOOR]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      };
      mark(drive.desired, '#58a6ff', 0.4);
      mark(drive.actual, '#3fb950', 0.28);
      // 0°（基準の向き）
      mark(0, 'rgba(139,148,158,0.9)', 0.16);
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

    // ---- キューブ本体
    const hx = 1, hy = 1, hz = 0.92;
    const polys = [];

    const push = (localPts, normal, color, opt) => {
      const world = localPts.map((p) => apply(R, p));
      const nw = apply(R, normal);
      if (nw[0] * nrm[0] + nw[1] * nrm[1] + nw[2] * nrm[2] <= 0.001) return;  // 裏面は描かない
      const scr = world.map(project);
      const depth = scr.reduce((s, p) => s + p[2], 0) / scr.length;
      const lit = 0.45 + 0.55 * Math.max(0, nw[0] * LIGHT[0] + nw[1] * LIGHT[1] + nw[2] * LIGHT[2]);
      polys.push({ scr, depth, color: shade(color, lit), opt: opt || {} });
    };

    const FACE_COLOR = ['#eef1f6', '#e2e6ee', '#e8ecf3', '#e8ecf3', '#f7f9fc', '#c9ced8'];
    boxFaces(hx, hy, hz, 0).forEach((f, i) => push(f.pts, f.n, has ? FACE_COLOR[i] : '#39414d'));

    // 車輪（左右の面に貼る板）
    for (const sy of [1, -1]) {
      const y = sy * (hy + 0.05);
      push([[-0.62, y, -hz], [0.62, y, -hz], [0.62, y, -hz + 0.62], [-0.62, y, -hz + 0.62]],
        [0, sy, 0], '#39414d');
    }

    // 天面の矢印（前を示す）
    push([[0.74, 0, hz + 0.02], [0.02, 0.42, hz + 0.02], [0.02, -0.42, hz + 0.02]],
      [0, 0, 1], has ? '#58a6ff' : '#4b5563');

    // 正面のランプ
    push([[hx + 0.02, -0.26, -0.2], [hx + 0.02, 0.26, -0.2], [hx + 0.02, 0.26, 0.3], [hx + 0.02, -0.26, 0.3]],
      [1, 0, 0], has ? '#1f6feb' : '#39414d', { glow: has });

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
    if (chk('chkAxes')) {
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
      ctx.fillText(compact ? '姿勢角を待っています' : 'コントローラの姿勢角を待っています', w / 2, h - 8 * dpr);
      ctx.textAlign = 'left';
    }
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
      ['d', cube.role === 'ctl' ? 'CTL' : 'TGT'],
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
    const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20;
    logEl.appendChild(line);
    while (logEl.childElementCount > 300) logEl.removeChild(logEl.firstChild);
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  $('btnLogClear').addEventListener('click', () => { logEl.textContent = ''; });

  // ---------------------------------------------------------------- タブ
  document.querySelectorAll('.tabs').forEach((tabs) => {
    tabs.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.tab');
      if (!btn) return;
      const panel = tabs.parentElement;
      panel.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      panel.querySelectorAll('.tabpane').forEach((p) => {
        p.classList.toggle('active', p.dataset.pane === btn.dataset.tab);
      });
    });
  });

  // ------------------------------------------------ ダブルタップズーム対策
  // user-scalable=no を無視するブラウザ向けの保険。クリックで動く UI は除外する
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350 && e.cancelable) {
      const t = e.target;
      if (!(t && t.closest && t.closest('button, input, select, textarea, a'))) e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  // ------------------------------------------------------------ 描画ループ
  function loop() {
    renderMap();
    renderLevel();
    renderPose(poseCanvas, poseCtx, false);
    if (miniState.visible) renderPose(poseMiniCanvas, poseMiniCtx, true);
    if (fsOpen()) renderPose(fsPoseCanvas, fsPoseCtx, true);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 起動
  if (!navigator.bluetooth) {
    $('unsupported').classList.remove('hidden');
    $('btnConnectCtl').disabled = true;
    $('btnConnectTgt').disabled = true;
  }

  captureDefaults();
  loadSettings();
  syncSettingOutputs();
  applyFwdMode();
  applyMiniState();
  renderRoles();
  updateCommandUi();
  updateStatus();
  scheduleTick();
  requestAnimationFrame(loop);

  window.addEventListener('beforeunload', () => {
    const t = roles.tgt;
    if (t && t.connected) { try { t.stop(); } catch (e) { /* noop */ } }
  });
})();
