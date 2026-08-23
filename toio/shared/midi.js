/*
 * 標準MIDIファイル（SMF）を読んで、toio のサウンド（0x03）に流せる形にする。
 *
 * toio 側の制約が強いので、そこに合わせて潰し込むのがこのファイルの仕事。
 *   - 同時に鳴らせるのは 1 音だけ
 *   - 1 コマンドあたり最大 59 音
 *   - 長さは 10〜2550ms（10ms 単位）
 *   - 音番号 0〜128（128 は無音＝休符に使う）
 *   - 音量 0〜255
 *
 * ライブラリ非依存・ビルド不要。<script> でそのまま読める。
 */
(function (global) {
  'use strict';

  /** 可変長数値（デルタタイム等）。[値, 次の位置] を返す */
  function readVarInt(bytes, pos) {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = bytes[pos++];
      if (b === undefined) throw new Error('MIDI が途中で終わっています');
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return [v, pos];
  }

  function readStr(bytes, pos, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[pos + i]);
    return s;
  }

  /** 1 トラックを、絶対 tick 付きのイベント列にする */
  function parseTrack(bytes, pos, end) {
    const events = [];
    let tick = 0;
    let status = 0;   // ランニングステータス
    while (pos < end) {
      let d;
      [d, pos] = readVarInt(bytes, pos);
      tick += d;

      // ステータスバイトが省略されていたら前のものを引き継ぐ（ランニングステータス）
      if (bytes[pos] & 0x80) { status = bytes[pos]; pos++; }

      if (status === 0xff) {
        const type = bytes[pos++];
        let len;
        [len, pos] = readVarInt(bytes, pos);
        events.push({ tick, meta: type, data: bytes.subarray(pos, pos + len) });
        pos += len;
      } else if (status === 0xf0 || status === 0xf7) {
        let len;
        [len, pos] = readVarInt(bytes, pos);
        pos += len;   // SysEx は読み飛ばす
      } else {
        const kind = status & 0xf0;
        const a = bytes[pos++];
        // プログラムチェンジとチャンネルプレッシャーだけデータが 1 バイト
        const b2 = (kind === 0xc0 || kind === 0xd0) ? 0 : bytes[pos++];
        events.push({ tick, kind, channel: status & 0x0f, a, b: b2 });
      }
    }
    return events;
  }

  /**
   * SMF を読む。
   * @param {ArrayBuffer} buf
   * @returns {{format:number, division:number, tracks:Array, durationMs:number}}
   *          tracks[i] = {name, notes:[{note, startMs, durMs, velocity}]}
   */
  function parse(buf) {
    const bytes = new Uint8Array(buf);
    if (readStr(bytes, 0, 4) !== 'MThd') throw new Error('MIDI ファイルではありません（MThd が無い）');
    const dv = new DataView(buf);
    const headLen = dv.getUint32(4);
    const format = dv.getUint16(8);
    const ntrks = dv.getUint16(10);
    const division = dv.getUint16(12);
    if (division & 0x8000) throw new Error('SMPTE 形式のタイムコードには未対応です');
    if (!division) throw new Error('分解能が 0 です');

    // トラックを全部イベント列にする
    let pos = 8 + headLen;
    const rawTracks = [];
    while (pos < bytes.length && rawTracks.length < ntrks) {
      const id = readStr(bytes, pos, 4);
      const len = dv.getUint32(pos + 4);
      pos += 8;
      if (id === 'MTrk') rawTracks.push(parseTrack(bytes, pos, pos + len));
      pos += len;
    }
    if (!rawTracks.length) throw new Error('トラックがありません');

    // テンポは format 1 だと 1 本目にだけ入っていることが多いが、
    // 曲全体に効くので全トラックから集めて tick 順に並べる
    const tempos = [];
    for (const ev of rawTracks.flat()) {
      if (ev.meta === 0x51 && ev.data.length >= 3) {
        tempos.push({ tick: ev.tick, usPerBeat: (ev.data[0] << 16) | (ev.data[1] << 8) | ev.data[2] });
      }
    }
    tempos.sort((x, y) => x.tick - y.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerBeat: 500000 });  // 既定 120BPM

    // tick → ms。テンポ変化の区間ごとに足していく
    const marks = [];
    let ms = 0;
    for (let i = 0; i < tempos.length; i++) {
      marks.push({ tick: tempos[i].tick, ms, usPerBeat: tempos[i].usPerBeat });
      if (i + 1 < tempos.length) {
        ms += (tempos[i + 1].tick - tempos[i].tick) / division * tempos[i].usPerBeat / 1000;
      }
    }
    const tickToMs = (tick) => {
      let m = marks[0];
      for (const k of marks) { if (k.tick <= tick) m = k; else break; }
      return m.ms + (tick - m.tick) / division * m.usPerBeat / 1000;
    };

    // ノートオン／オフを組にする
    const tracks = rawTracks.map((events, i) => {
      let name = '';
      const notes = [];
      const open = new Map();   // 音番号 → 開始 tick と強さ
      for (const ev of events) {
        if (ev.meta === 0x03 && !name) name = new TextDecoder().decode(ev.data);
        if (ev.kind === undefined) continue;
        const on = ev.kind === 0x90 && ev.b > 0;
        const off = ev.kind === 0x80 || (ev.kind === 0x90 && ev.b === 0);
        if (on) {
          // 同じ音が鳴りっぱなしのまま再度来たら、そこで一度切る
          if (open.has(ev.a)) closeNote(ev.a, ev.tick);
          open.set(ev.a, { tick: ev.tick, velocity: ev.b });
        } else if (off) {
          closeNote(ev.a, ev.tick);
        }
      }
      // 閉じ忘れは最後のイベントで閉じる
      const lastTick = events.length ? events[events.length - 1].tick : 0;
      for (const note of [...open.keys()]) closeNote(note, lastTick);

      function closeNote(note, tick) {
        const o = open.get(note);
        if (!o) return;
        open.delete(note);
        const startMs = tickToMs(o.tick);
        const durMs = tickToMs(tick) - startMs;
        if (durMs > 0) notes.push({ note, startMs, durMs, velocity: o.velocity });
      }

      notes.sort((x, y) => x.startMs - y.startMs || y.note - x.note);
      return { name: name || `トラック ${i + 1}`, notes };
    });

    const durationMs = Math.max(0, ...tracks.flatMap((t) => t.notes.map((n) => n.startMs + n.durMs)));
    return { format, division, tracks, durationMs };
  }

  /**
   * 和音を単音に潰す。キューブは 1 音しか鳴らせないので、
   * 重なったところは**高いほうを残す**（たいていそれが主旋律）。
   */
  function monophonic(notes) {
    const sorted = notes.slice().sort((a, b) => a.startMs - b.startMs || b.note - a.note);
    const out = [];
    for (const n of sorted) {
      const prev = out[out.length - 1];
      if (!prev) { out.push({ ...n }); continue; }
      const prevEnd = prev.startMs + prev.durMs;
      if (n.startMs >= prevEnd) { out.push({ ...n }); continue; }
      // 重なっている
      if (n.note > prev.note) {
        prev.durMs = n.startMs - prev.startMs;      // 前を切って乗り換える
        if (prev.durMs <= 0) out.pop();
        out.push({ ...n });
      }
      // 低いほうは捨てる（和音の下の音）
    }
    return out.filter((n) => n.durMs > 0);
  }

  const REST = 128;   // toio の「無音」

  /**
   * toio のシーケンス（{note, durationMs, volume} の配列）にする。
   * @param {Array} notes  parse() の track.notes
   * @param {object} [opt]
   *   transpose  半音（既定 0）
   *   rate       速さ %（既定 100。200 なら倍速）
   *   volume     音量の上限 0-255（既定 255）。強さをこの範囲に写す
   *   gapMs      これ未満の隙間は休符にしない（既定 30）
   */
  function toSequence(notes, opt) {
    const o = Object.assign({ transpose: 0, rate: 100, volume: 255, gapMs: 30 }, opt || {});
    const scale = 100 / (o.rate || 100);
    const seq = [];
    let cursor = 0;
    for (const n of monophonic(notes)) {
      const start = n.startMs * scale;
      const dur = n.durMs * scale;
      const gap = start - cursor;
      if (gap >= o.gapMs) seq.push({ note: REST, durationMs: quant(gap), volume: 0 });
      const note = n.note + o.transpose;
      // 音域外は捨てる。移調で外に出たものを無理に丸めると音痴になる。
      // 5ms 未満はゴミ（打ち込みの残骸）とみなして落とす。それ以上で
      // 10ms に満たないものは、キューブの下限に合わせて持ち上げる
      if (note >= 0 && note <= 127 && dur >= 5) {
        seq.push({
          note,
          durationMs: quant(dur),
          volume: Math.max(1, Math.round(n.velocity / 127 * o.volume)),
        });
      }
      cursor = start + dur;
    }
    return seq;
  }

  /** toio は 10ms 単位。10〜2550 に収める */
  function quant(ms) {
    return Math.min(2550, Math.max(10, Math.round(ms / 10) * 10));
  }

  /** 59 音ずつに割る。1 コマンドで送れる上限がそれのため */
  function chunk(seq, size) {
    const n = size || 59;
    const out = [];
    for (let i = 0; i < seq.length; i += n) out.push(seq.slice(i, i + n));
    return out;
  }

  /** そのまとまりを鳴らし切るのにかかる時間 */
  function totalMs(seq) {
    return seq.reduce((a, s) => a + s.durationMs, 0);
  }

  global.ToioMidi = { parse, monophonic, toSequence, chunk, totalMs, REST };
})(typeof window !== 'undefined' ? window : globalThis);
