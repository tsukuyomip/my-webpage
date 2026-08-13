/*
 * toio コアキューブ BLE ラッパー（Web Bluetooth API 直叩き）
 *
 * 公式の BLE 通信仕様（https://toio.github.io/toio-spec/）にある
 * キャラクタリスティックと機能をひととおり網羅することを目的にしている。
 * ライブラリ非依存・ビルド不要で、そのまま <script> で読める。
 */
(function (global) {
  'use strict';

  const SERVICE = '10b20100-5b3b-4571-9508-cf3efcd7bbae';

  const CHAR_UUID = {
    id: '10b20101-5b3b-4571-9508-cf3efcd7bbae',
    motor: '10b20102-5b3b-4571-9508-cf3efcd7bbae',
    light: '10b20103-5b3b-4571-9508-cf3efcd7bbae',
    sound: '10b20104-5b3b-4571-9508-cf3efcd7bbae',
    sensor: '10b20106-5b3b-4571-9508-cf3efcd7bbae',
    button: '10b20107-5b3b-4571-9508-cf3efcd7bbae',
    battery: '10b20108-5b3b-4571-9508-cf3efcd7bbae',
    config: '10b201ff-5b3b-4571-9508-cf3efcd7bbae',
  };

  /** 通知を受け取るキャラクタリスティック */
  const NOTIFY_CHARS = ['id', 'motor', 'sensor', 'button', 'battery', 'config'];

  const POSTURE = {
    1: '天面が上', 2: '底面が上', 3: '背面が上',
    4: '正面が上', 5: '右面が上', 6: '左面が上',
  };

  const MOTOR_RESPONSE_REASON = {
    0: '正常終了',
    1: 'タイムアウト',
    2: 'toio ID missed（マットから外れた）',
  };

  const SOUND_EFFECT = [
    'Enter', 'Selected', 'Cancel', 'Cursor', 'Mat in', 'Mat out',
    'Get 1', 'Get 2', 'Get 3', 'Effect 1', 'Effect 2',
  ];

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** MIDI ノート番号 → 音名（toio のノート番号 0 = C0） */
  function noteName(n) {
    if (n >= 128) return '無音';
    return NOTE_NAMES[n % 12] + Math.floor(n / 12);
  }

  function clamp(v, lo, hi) {
    v = Number(v);
    if (!Number.isFinite(v)) v = lo;
    return Math.min(hi, Math.max(lo, Math.round(v)));
  }

  function toHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  function parseHex(text) {
    const tokens = String(text).trim().split(/[\s,]+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
      const v = parseInt(t.replace(/^0x/i, ''), 16);
      if (Number.isNaN(v) || v < 0 || v > 255) throw new Error('不正なバイト: ' + t);
      out.push(v);
    }
    return new Uint8Array(out);
  }

  /**
   * ひとつのキューブ。
   * 書き込みは 1 本のキューにまとめて直列化する。BLE は同時に GATT 操作を
   * 走らせると "operation already in progress" で落ちるため。
   */
  class ToioCube {
    constructor(device) {
      this.device = device;
      this.chars = {};
      this.listeners = {};
      this.connected = false;

      this.protocolVersion = null;
      this.battery = null;
      this.button = false;
      this.position = null;       // {x, y, angle, sensorX, sensorY}
      this.standardId = null;     // {value, angle}
      this.onMat = false;
      this.motion = null;         // {flat, collision, doubleTap, posture, shake}
      this.magnet = null;         // {id, force, x, y, z}
      this.attitude = null;       // {format, ...}
      this.motorSpeed = null;     // {left, right}
      // 推測航法用。指示した速度を覚えておき、速度情報の通知が来たらそちらで上書きする
      this.speedEstimate = { left: 0, right: 0 };
      this._speedTimer = 0;

      this._queue = [];
      this._running = false;
      this._onDisconnected = this._handleDisconnected.bind(this);
    }

    get name() {
      return this.device.name || '(名前なし)';
    }

    get id() {
      return this.device.id;
    }

    // ---- イベント ------------------------------------------------------
    on(type, cb) {
      (this.listeners[type] || (this.listeners[type] = [])).push(cb);
      return this;
    }

    emit(type, payload) {
      for (const cb of this.listeners[type] || []) {
        try { cb(payload, this); } catch (e) { console.error(e); }
      }
      for (const cb of this.listeners['*'] || []) {
        try { cb({ type, payload }, this); } catch (e) { console.error(e); }
      }
    }

    log(dir, char, bytes, note) {
      this.emit('log', { dir, char, bytes, note, time: new Date() });
    }

    // ---- 接続 ----------------------------------------------------------
    async connect() {
      this.device.addEventListener('gattdisconnected', this._onDisconnected);
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);

      for (const key of Object.keys(CHAR_UUID)) {
        try {
          this.chars[key] = await service.getCharacteristic(CHAR_UUID[key]);
        } catch (e) {
          this.chars[key] = null;
          this.log('info', key, null, 'キャラクタリスティック取得に失敗（未対応ファームウェア？）');
        }
      }

      for (const key of NOTIFY_CHARS) {
        const c = this.chars[key];
        if (!c || !c.properties.notify) continue;
        c.addEventListener('characteristicvaluechanged', (ev) => {
          this._handleNotify(key, new Uint8Array(ev.target.value.buffer));
        });
        await c.startNotifications();
      }

      this.connected = true;

      // 初期値を読んでおく
      await this._readInitial();
      this.requestProtocolVersion();

      this.emit('connect');
      return this;
    }

    async _readInitial() {
      const reads = [['battery', 'battery'], ['button', 'button'], ['sensor', 'sensor'], ['id', 'id']];
      for (const [key] of reads) {
        const c = this.chars[key];
        if (!c || !c.properties.read) continue;
        try {
          const v = await c.readValue();
          this._handleNotify(key, new Uint8Array(v.buffer));
        } catch (e) { /* 読めない状態（マット外など）は無視 */ }
      }
    }

    disconnect() {
      if (this.device.gatt.connected) this.device.gatt.disconnect();
      else this._handleDisconnected();
    }

    /** 推測航法のもとになる速度を更新する。durationMs を渡すとその後 0 に戻す */
    _setSpeedEstimate(left, right, durationMs) {
      clearTimeout(this._speedTimer);
      this.speedEstimate = { left, right };
      if (durationMs) {
        this._speedTimer = setTimeout(() => { this.speedEstimate = { left: 0, right: 0 }; }, durationMs);
      }
    }

    _handleDisconnected() {
      clearTimeout(this._speedTimer);
      this.speedEstimate = { left: 0, right: 0 };
      this.connected = false;
      this._queue.length = 0;
      this._running = false;
      this.emit('disconnect');
    }

    // ---- 書き込みキュー ------------------------------------------------
    /**
     * @param {string} charKey  chars のキー
     * @param {Uint8Array|number[]} bytes
     * @param {object} [opt]  {key} を渡すと、未送信の同キーの要求を上書きする
     *                        （スライダー連打などで詰まらせないため）
     */
    write(charKey, bytes, opt) {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const key = opt && opt.key;
      const note = opt && opt.note;
      if (!this.connected) return Promise.reject(new Error('未接続'));

      if (key) {
        const pending = this._queue.find((it) => it.key === key);
        if (pending) {
          pending.bytes = buf;
          pending.charKey = charKey;
          pending.note = note;
          return pending.promise;
        }
      }

      const item = { charKey, bytes: buf, key, note };
      item.promise = new Promise((resolve, reject) => {
        item.resolve = resolve;
        item.reject = reject;
      });
      this._queue.push(item);
      this._run();
      return item.promise;
    }

    async _run() {
      if (this._running) return;
      this._running = true;
      while (this._queue.length) {
        const item = this._queue.shift();
        const c = this.chars[item.charKey];
        if (!c) { item.reject(new Error(item.charKey + ' が使えません')); continue; }
        try {
          await this._writeRaw(c, item.bytes, 3);
          this.log('tx', item.charKey, item.bytes, item.note);
          item.resolve();
        } catch (e) {
          this.log('error', item.charKey, item.bytes, String(e.message || e));
          this.emit('error', e);
          item.reject(e);
        }
      }
      this._running = false;
    }

    async _writeRaw(c, bytes, retry) {
      try {
        if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) {
          await c.writeValueWithoutResponse(bytes);
        } else {
          await c.writeValue(bytes);
        }
      } catch (e) {
        if (retry > 0 && /in progress/i.test(String(e.message || e))) {
          await new Promise((r) => setTimeout(r, 30));
          return this._writeRaw(c, bytes, retry - 1);
        }
        throw e;
      }
    }

    async read(charKey) {
      const c = this.chars[charKey];
      if (!c) throw new Error(charKey + ' が使えません');
      const v = await c.readValue();
      const bytes = new Uint8Array(v.buffer);
      this.log('rx', charKey, bytes, '（読み出し）');
      this._handleNotify(charKey, bytes);
      return bytes;
    }

    // ---- 受信の解釈 ----------------------------------------------------
    _handleNotify(charKey, bytes) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let note = '';
      try {
        switch (charKey) {
          case 'id': note = this._parseId(dv, bytes); break;
          case 'sensor': note = this._parseSensor(dv, bytes); break;
          case 'button': note = this._parseButton(dv); break;
          case 'battery': note = this._parseBattery(dv); break;
          case 'motor': note = this._parseMotor(dv); break;
          case 'config': note = this._parseConfig(dv, bytes); break;
        }
      } catch (e) {
        note = '解析エラー: ' + (e.message || e);
      }
      this.log('rx', charKey, bytes, note);
    }

    _parseId(dv, bytes) {
      const type = dv.getUint8(0);
      if (type === 0x01 && bytes.length >= 11) {
        this.position = {
          x: dv.getUint16(1, true), y: dv.getUint16(3, true), angle: dv.getUint16(5, true),
          sensorX: dv.getUint16(7, true), sensorY: dv.getUint16(9, true),
          sensorAngle: bytes.length >= 13 ? dv.getUint16(11, true) : null,
        };
        this.onMat = true;
        this.emit('position', this.position);
        return `位置ID x=${this.position.x} y=${this.position.y} θ=${this.position.angle}°`;
      }
      if (type === 0x02 && bytes.length >= 7) {
        this.standardId = { value: dv.getUint32(1, true), angle: dv.getUint16(5, true) };
        this.onMat = true;
        this.emit('standard', this.standardId);
        return `標準ID ${this.standardId.value} θ=${this.standardId.angle}°`;
      }
      if (type === 0x03) {
        this.position = null; this.onMat = false;
        this.emit('positionMissed');
        return '位置ID missed';
      }
      if (type === 0x04) {
        this.standardId = null; this.onMat = false;
        this.emit('standardMissed');
        return '標準ID missed';
      }
      return '不明な読み取りセンサー情報';
    }

    _parseSensor(dv, bytes) {
      const type = dv.getUint8(0);
      if (type === 0x01) {
        this.motion = {
          flat: dv.getUint8(1) === 1,
          collision: dv.getUint8(2) === 1,
          doubleTap: dv.getUint8(3) === 1,
          posture: dv.getUint8(4),
          postureName: POSTURE[dv.getUint8(4)] || '不明',
          shake: bytes.length > 5 ? dv.getUint8(5) : 0,
        };
        this.emit('motion', this.motion);
        if (this.motion.collision) this.emit('collision');
        if (this.motion.doubleTap) this.emit('doubleTap');
        return `モーション ${this.motion.flat ? '水平' : '傾斜'} / ${this.motion.postureName} / シェイク${this.motion.shake}`
          + (this.motion.collision ? ' / 衝突!' : '') + (this.motion.doubleTap ? ' / ダブルタップ!' : '');
      }
      if (type === 0x02) {
        if (bytes.length >= 6) {
          this.magnet = {
            id: dv.getUint8(1), force: dv.getUint8(2),
            x: dv.getInt8(3) / 10, y: dv.getInt8(4) / 10, z: dv.getInt8(5) / 10,
          };
        } else {
          this.magnet = { id: dv.getUint8(1), force: null, x: null, y: null, z: null };
        }
        this.emit('magnet', this.magnet);
        return this.magnet.force === null
          ? `磁石の状態 ${this.magnet.id}`
          : `磁力 強さ=${this.magnet.force} 向き=(${this.magnet.x}, ${this.magnet.y}, ${this.magnet.z})`;
      }
      if (type === 0x03) {
        this.attitudeAt = Date.now(); // 推測航法で「新しい値か」を見るのに使う
        const format = dv.getUint8(1);
        if (format === 1) {
          this.attitude = { format, roll: dv.getInt16(2, true), pitch: dv.getInt16(4, true), yaw: dv.getInt16(6, true) };
          this.emit('attitude', this.attitude);
          return `姿勢角(オイラー) roll=${this.attitude.roll}° pitch=${this.attitude.pitch}° yaw=${this.attitude.yaw}°`;
        }
        if (format === 2) {
          this.attitude = {
            format, w: dv.getInt16(2, true) / 10000, x: dv.getInt16(4, true) / 10000,
            y: dv.getInt16(6, true) / 10000, z: dv.getInt16(8, true) / 10000,
          };
          this.emit('attitude', this.attitude);
          return `姿勢角(クォータニオン) w=${this.attitude.w} x=${this.attitude.x} y=${this.attitude.y} z=${this.attitude.z}`;
        }
        if (format === 3) {
          // 高精度オイラー角。生の Int16 と 0.01 度換算の両方を持たせる
          this.attitude = {
            format,
            rawRoll: dv.getInt16(2, true), rawPitch: dv.getInt16(4, true), rawYaw: dv.getInt16(6, true),
            roll: dv.getInt16(2, true) / 100, pitch: dv.getInt16(4, true) / 100, yaw: dv.getInt16(6, true) / 100,
          };
          this.emit('attitude', this.attitude);
          return `姿勢角(高精度オイラー) roll=${this.attitude.roll} pitch=${this.attitude.pitch} yaw=${this.attitude.yaw}`;
        }
        return '姿勢角（未知の形式 ' + format + '）';
      }
      return '不明なモーションセンサー情報';
    }

    _parseButton(dv) {
      this.button = dv.getUint8(1) === 0x80;
      this.emit('button', this.button);
      return this.button ? 'ボタン 押されている' : 'ボタン 離されている';
    }

    _parseBattery(dv) {
      this.battery = dv.getUint8(0);
      this.emit('battery', this.battery);
      return `バッテリー ${this.battery}%`;
    }

    _parseMotor(dv) {
      const type = dv.getUint8(0);
      if (type === 0x83 || type === 0x84) {
        const res = {
          multi: type === 0x84,
          controlId: dv.getUint8(1),
          reason: dv.getUint8(2),
          reasonText: MOTOR_RESPONSE_REASON[dv.getUint8(2)] || `エラー（コード ${dv.getUint8(2)}）`,
        };
        this.emit('motorResponse', res);
        return `${res.multi ? '複数' : ''}目標指定の応答 制御識別値=${res.controlId} ${res.reasonText}`;
      }
      if (type === 0xe0) {
        this.motorSpeed = { left: dv.getUint8(1), right: dv.getUint8(2) };
        // 通知には向きが入っていないので、直前に指示した向きを流用する
        const sl = Math.sign(this.speedEstimate.left) || 1;
        const sr = Math.sign(this.speedEstimate.right) || 1;
        clearTimeout(this._speedTimer);
        this.speedEstimate = { left: sl * this.motorSpeed.left, right: sr * this.motorSpeed.right };
        this.emit('motorSpeed', this.motorSpeed);
        return `モーター速度 左=${this.motorSpeed.left} 右=${this.motorSpeed.right}`;
      }
      return '不明なモーター情報';
    }

    _parseConfig(dv, bytes) {
      const type = dv.getUint8(0);
      if (type === 0x81) {
        this.protocolVersion = new TextDecoder().decode(bytes.slice(2)).replace(/\0+$/, '');
        this.emit('protocolVersion', this.protocolVersion);
        return `BLEプロトコルバージョン ${this.protocolVersion}`;
      }
      const resp = dv.getUint8(1);
      return `設定応答 0x${type.toString(16)}（結果コード ${resp}）`;
    }

    // ---- モーター ------------------------------------------------------
    /** 基本のモーター制御（0x01）。left/right は -115〜115 */
    motor(left, right, opt) {
      const l = clamp(Math.abs(left), 0, 115), r = clamp(Math.abs(right), 0, 115);
      this._setSpeedEstimate(left < 0 ? -l : l, right < 0 ? -r : r);
      return this.write('motor', [0x01, 0x01, left < 0 ? 2 : 1, l, 0x02, right < 0 ? 2 : 1, r],
        Object.assign({ key: 'motor', note: `基本制御 L=${left} R=${right}` }, opt));
    }

    /** 時間指定モーター制御（0x02）。durationMs は 0〜2550、0 は無制限 */
    motorTimed(left, right, durationMs) {
      const l = clamp(Math.abs(left), 0, 115), r = clamp(Math.abs(right), 0, 115);
      const d = clamp(durationMs / 10, 0, 255);
      this._setSpeedEstimate(left < 0 ? -l : l, right < 0 ? -r : r, d ? d * 10 : 0);
      return this.write('motor', [0x02, 0x01, left < 0 ? 2 : 1, l, 0x02, right < 0 ? 2 : 1, r, d],
        { note: `時間指定 L=${left} R=${right} ${d * 10}ms` });
    }

    stop() {
      return this.motor(0, 0, { key: null, note: '停止' });
    }

    /**
     * 目標指定付きモーター制御（0x03）
     * @param {object} t {x, y, angle, rotateType}
     * @param {object} o {controlId, timeout, moveType, maxSpeed, speedType}
     */
    motorTarget(t, o) {
      const buf = new Uint8Array(13);
      const dv = new DataView(buf.buffer);
      dv.setUint8(0, 0x03);
      dv.setUint8(1, clamp(o.controlId, 0, 255));
      dv.setUint8(2, clamp(o.timeout, 0, 255));
      dv.setUint8(3, clamp(o.moveType, 0, 2));
      dv.setUint8(4, clamp(o.maxSpeed, 10, 255));
      dv.setUint8(5, clamp(o.speedType, 0, 3));
      dv.setUint8(6, 0x00);
      dv.setUint16(7, clamp(t.x, 0, 0xffff), true);
      dv.setUint16(9, clamp(t.y, 0, 0xffff), true);
      dv.setUint16(11, (clamp(t.rotateType, 0, 7) << 13) | clamp(t.angle, 0, 0x1fff), true);
      return this.write('motor', buf, { note: `目標指定 (${t.x}, ${t.y}, ${t.angle}°)` });
    }

    /** 複数目標指定付きモーター制御（0x04）。targets は最大 29 個 */
    motorMultiTarget(targets, o) {
      const n = Math.min(targets.length, 29);
      const buf = new Uint8Array(8 + 6 * n);
      const dv = new DataView(buf.buffer);
      dv.setUint8(0, 0x04);
      dv.setUint8(1, clamp(o.controlId, 0, 255));
      dv.setUint8(2, clamp(o.timeout, 0, 255));
      dv.setUint8(3, clamp(o.moveType, 0, 2));
      dv.setUint8(4, clamp(o.maxSpeed, 10, 255));
      dv.setUint8(5, clamp(o.speedType, 0, 3));
      dv.setUint8(6, 0x00);
      dv.setUint8(7, o.append ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const t = targets[i];
        dv.setUint16(8 + 6 * i, clamp(t.x, 0, 0xffff), true);
        dv.setUint16(10 + 6 * i, clamp(t.y, 0, 0xffff), true);
        dv.setUint16(12 + 6 * i, (clamp(t.rotateType, 0, 7) << 13) | clamp(t.angle, 0, 0x1fff), true);
      }
      return this.write('motor', buf, { note: `複数目標指定 ${n} 点` });
    }

    /**
     * 加速度指定モーター制御（0x05）
     * @param {object} p {speed, acceleration, rotationSpeed, rotationDir, moveDir, priority, durationMs}
     */
    motorAcceleration(p) {
      const rot = clamp(Math.abs(p.rotationSpeed), 0, 65535);
      return this.write('motor', [
        0x05,
        clamp(Math.abs(p.speed), 0, 255),
        clamp(p.acceleration, 0, 255),
        rot & 0xff, (rot >> 8) & 0xff,
        p.rotationDir ? 1 : 0,
        p.moveDir ? 1 : 0,
        p.priority ? 1 : 0,
        clamp(p.durationMs / 10, 0, 255),
      ], { note: '加速度指定' });
    }

    // ---- ランプ --------------------------------------------------------
    lightOff() {
      return this.write('light', [0x01], { note: '消灯' });
    }

    /** 点灯（0x03）。durationMs 0 は消灯しない */
    light(r, g, b, durationMs) {
      return this.write('light', [0x03, clamp((durationMs || 0) / 10, 0, 255), 0x01, 0x01,
        clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)],
        { key: 'light', note: `点灯 rgb(${r}, ${g}, ${b})` });
    }

    /** 連続点灯（0x04）。steps は {r,g,b,durationMs} の配列（最大 29） */
    lightScenario(steps, repeat) {
      const n = Math.min(steps.length, 29);
      const buf = new Uint8Array(3 + 6 * n);
      buf[0] = 0x04;
      buf[1] = clamp(repeat, 0, 255);
      buf[2] = n;
      for (let i = 0; i < n; i++) {
        const s = steps[i];
        buf[3 + 6 * i] = clamp(s.durationMs / 10, 1, 255);
        buf[4 + 6 * i] = 0x01;
        buf[5 + 6 * i] = 0x01;
        buf[6 + 6 * i] = clamp(s.r, 0, 255);
        buf[7 + 6 * i] = clamp(s.g, 0, 255);
        buf[8 + 6 * i] = clamp(s.b, 0, 255);
      }
      return this.write('light', buf, { note: `連続点灯 ${n} ステップ × ${repeat === 0 ? '∞' : repeat}` });
    }

    // ---- サウンド ------------------------------------------------------
    soundStop() {
      return this.write('sound', [0x01], { note: '再生停止' });
    }

    /** 効果音（0x02）。id 0〜10 */
    soundEffect(id, volume) {
      return this.write('sound', [0x02, clamp(id, 0, 10), clamp(volume, 0, 255)],
        { note: `効果音 ${SOUND_EFFECT[clamp(id, 0, 10)]}` });
    }

    /** MIDI（0x03）。notes は {note, durationMs, volume} の配列（最大 59） */
    soundMidi(notes, repeat) {
      const n = Math.min(notes.length, 59);
      const buf = new Uint8Array(3 + 3 * n);
      buf[0] = 0x03;
      buf[1] = clamp(repeat, 0, 255);
      buf[2] = n;
      for (let i = 0; i < n; i++) {
        buf[3 + 3 * i] = clamp(notes[i].durationMs / 10, 1, 255);
        buf[4 + 3 * i] = clamp(notes[i].note, 0, 128);
        buf[5 + 3 * i] = clamp(notes[i].volume === undefined ? 255 : notes[i].volume, 0, 255);
      }
      return this.write('sound', buf, { note: `MIDI ${n} 音 × ${repeat === 0 ? '∞' : repeat}` });
    }

    // ---- 設定 ----------------------------------------------------------
    requestProtocolVersion() {
      return this.write('config', [0x01, 0x00], { note: 'BLEプロトコルバージョン取得' });
    }

    /** 水平検出のしきい値（1〜45 度） */
    setFlatThreshold(deg) {
      return this.write('config', [0x05, 0x00, clamp(deg, 1, 45)], { note: `水平検出しきい値 ${deg}°` });
    }

    /** 衝突検出のしきい値（1〜10） */
    setCollisionThreshold(level) {
      return this.write('config', [0x06, 0x00, clamp(level, 1, 10)], { note: `衝突検出しきい値 ${level}` });
    }

    /** ダブルタップ検出の時間間隔（0〜7） */
    setDoubleTapInterval(level) {
      return this.write('config', [0x17, 0x00, clamp(level, 0, 7)], { note: `ダブルタップ間隔 ${level}` });
    }

    /** 読み取りセンサーのID通知設定。intervalMs は 10ms 単位、condition は通知条件 */
    setIdNotification(intervalMs, condition) {
      return this.write('config', [0x18, 0x00, clamp(intervalMs / 10, 0, 255), clamp(condition, 0, 255)],
        { note: `ID通知 間隔${intervalMs}ms 条件${condition}` });
    }

    /** 読み取りセンサーのID missed通知感度。sensitivityMs は 10ms 単位 */
    setIdMissedNotification(sensitivityMs) {
      return this.write('config', [0x19, 0x00, clamp(sensitivityMs / 10, 0, 255)],
        { note: `ID missed 感度 ${sensitivityMs}ms` });
    }

    /** 磁気センサーの設定。type 0=無効 1=磁石の状態 2=磁力、intervalMs は 20ms 単位 */
    setMagnetDetection(type, intervalMs, condition) {
      return this.write('config', [0x1b, 0x00, clamp(type, 0, 2), clamp(intervalMs / 20, 1, 255), clamp(condition, 0, 1)],
        { note: `磁気センサー 種類${type}` });
    }

    /** モーターの速度情報の取得 */
    setMotorSpeedFeedback(enable) {
      return this.write('config', [0x1c, 0x00, enable ? 1 : 0], { note: `モーター速度情報 ${enable ? '有効' : '無効'}` });
    }

    /** 姿勢角検出の設定。format 1=オイラー角 2=クォータニオン 3=高精度オイラー角 */
    setAttitudeDetection(format, intervalMs, condition) {
      return this.write('config', [0x1d, 0x00, clamp(format, 1, 3), clamp(intervalMs / 10, 0, 255), clamp(condition, 0, 1)],
        { note: `姿勢角検出 形式${format}` });
    }
  }

  async function requestCube() {
    if (!navigator.bluetooth) throw new Error('このブラウザは Web Bluetooth に対応していません');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }],
      optionalServices: [SERVICE],
    });
    return new ToioCube(device);
  }

  global.Toio = {
    SERVICE, CHAR_UUID, ToioCube, requestCube,
    POSTURE, SOUND_EFFECT, noteName, toHex, parseHex, clamp,
  };
})(window);
