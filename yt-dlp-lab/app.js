// メインスレッド側。重い処理は全部ワーカーに預け、ここは表示と受け渡しだけ。

const worker = new Worker("worker.js?v=20260826a", { type: "module" });

const $ = (id) => document.getElementById(id);
const logEl = $("log");

// 拡張が入っているかを確かめるための的。CORS を許可していないことが
// はっきりしていて、かつ軽い応答を返すものを選ぶ。
const BRIDGE_PROBE_URL = "https://www.youtube.com/robots.txt";

function log(line, level = "info") {
  const time = new Date().toTimeString().slice(0, 8);
  logEl.textContent += `[${time}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  if (level === "error") logEl.classList.add("has-error");
}

function setCheck(id, state, detail) {
  const li = $(id);
  li.dataset.state = state; // pending | ok | ng
  li.querySelector(".detail").textContent = detail;
}

// ---------------------------------------------------------------- 表示

const humanSize = (bytes) => {
  if (!bytes) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

const humanDuration = (sec) => {
  if (!sec) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s % 60).padStart(2, "0")}`;
};

function renderInfo(info) {
  $("resultPanel").hidden = false;

  const meta = [
    ["抽出器", info.extractor],
    ["タイトル", info.title],
    ["投稿者", info.uploader || info.channel],
    ["長さ", humanDuration(info.duration)],
    ["フォーマット数", (info.formats || []).length],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  // 値はサイト側から来た文字列なので、innerHTML には触れず textContent で入れる
  const dl = document.createElement("dl");
  for (const [k, v] of meta) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    dl.append(dt, dd);
  }
  $("summary").replaceChildren(dl);

  const tbody = $("formats").querySelector("tbody");
  tbody.textContent = "";
  for (const f of info.formats || []) {
    const cells = [
      f.format_id,
      f.ext,
      f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : (f.vcodec === "none" ? "audio only" : "")),
      f.fps || "",
      [f.vcodec, f.acodec].filter((c) => c && c !== "none").join(" / "),
      humanSize(f.filesize || f.filesize_approx),
      f.format_note || "",
    ];
    const tr = document.createElement("tr");
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c ?? "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  $("rawJson").textContent = JSON.stringify(info, null, 2);
}

// ---------------------------------------------------------------- ワーカー

worker.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case "log":
      log(msg.line, msg.level);
      break;

    case "ready":
      setCheck("chkRuntime", "ok", `yt-dlp ${msg.version}`);
      $("btnExtract").disabled = false;
      $("btnProbe").disabled = false;
      probe();
      break;

    case "probed": {
      // XHR は失敗理由を教えてくれないので、通ったかどうかだけで判断する。
      const ok = !msg.meta.error;
      // 通らなかった理由が CORS なのか回線なのかは XHR からは区別できない。
      // 「拡張がない」と断定せず、両方の可能性を出す。
      setCheck("chkBridge", ok ? "ok" : "ng", ok ? "有効" : "応答なし");
      $("bridgeHelp").hidden = ok;
      log(ok
        ? "CORS ブリッジ拡張が効いています。"
        : "外部サイトに届きませんでした。拡張が未導入か、ネットワークに出られていません。",
        ok ? "info" : "warn");
      break;
    }

    case "extracted":
      log("抽出できました。");
      renderInfo(msg.info);
      $("btnExtract").disabled = false;
      break;

    case "error":
      log(msg.message, "error");
      $("btnExtract").disabled = false;
      break;
  }
};

const probe = () => worker.postMessage({ type: "probe", payload: { url: BRIDGE_PROBE_URL } });

$("btnBoot").addEventListener("click", () => {
  $("btnBoot").disabled = true;
  setCheck("chkRuntime", "pending", "起動中…");
  const params = new URLSearchParams(location.search);
  worker.postMessage({ type: "boot", payload: {
    pyodideBase: params.get("pyodide") || undefined,
    ytdlpVersion: params.get("ytdlp") || undefined,
  }});
});

$("btnProbe").addEventListener("click", probe);

$("extractForm").addEventListener("submit", (e) => {
  e.preventDefault();
  $("btnExtract").disabled = true;
  $("resultPanel").hidden = true;
  worker.postMessage({ type: "extract", payload: { url: $("url").value.trim() } });
});
