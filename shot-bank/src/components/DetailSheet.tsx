import { useEffect, useMemo, useRef, useState } from "react";
import { getImage } from "../lib/db";
import { guessedMoods } from "../lib/filter";
import { formatBytes, formatDate } from "../lib/format";
import { formatStory } from "../lib/story";
import type { Character, Face, Shot } from "../lib/types";
import { BlobImage } from "./BlobImage";
import { FaceBoxes } from "./FaceBoxes";
import { suggestFor, type Suggestion } from "../lib/suggest";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack";

const LAYOUT_LABEL: Record<string, string> = {
  "portrait-adv": "縦・ADV",
  "portrait-adv-nopanel": "縦・ADV（セリフなし）",
  "portrait-plain": "縦・UI なし",
  "landscape-story": "横・ストーリー",
};

export function DetailSheet({
  shot,
  onClose,
  onDelete,
  onShare,
  onFaces,
  allShots,
  onSaveText,
  onReRecognize,
  onResetFaces,
  onToggleMood,
  onToggleCharacter,
  onSetSpeaker,
  onToggleFavorite,
  onViewShot,
  imageMoodBusy,
  roster,
  moods,
  busy,
}: {
  shot: Shot;
  onClose: () => void;
  onDelete: (shot: Shot) => void;
  onShare: (shot: Shot) => void;
  /** 顔の枠を書き換える */
  onFaces: (shot: Shot, faces: Face[]) => void;
  /** 提案の見本を集めるために全件が要る */
  allShots: Shot[];
  onSaveText: (shot: Shot, body: string, speakerRaw: string) => void;
  onReRecognize: (shot: Shot) => void;
  /** 顔を、手のぶんも含めて全部消して探し直す */
  onResetFaces: (shot: Shot) => void;
  onToggleMood: (shot: Shot, mood: string) => void;
  onToggleCharacter: (shot: Shot, characterId: string) => void;
  /** 話者を手で決める。null で外す。決めた色は名簿が覚える（App 側） */
  onSetSpeaker: (shot: Shot, characterId: string | null) => void;
  onToggleFavorite: (shot: Shot) => void;
  /** この 1 枚を開いた（絵からの表情推定を、要る枚だけここで走らせる）。 */
  onViewShot?: (shot: Shot) => void;
  /** いま絵から表情を推している最中か。控えめな印を出すためだけの情報。 */
  imageMoodBusy?: boolean;
  roster: Character[];
  moods: string[];
  busy: boolean;
}) {
  const [blob, setBlob] = useState<Blob>();
  const [confirming, setConfirming] = useState(false);
  const [addingFace, setAddingFace] = useState(false);
  const [resettingFaces, setResettingFaces] = useState(false);
  const [pickedFace, setPickedFace] = useState<string>();
  const faces = shot.faces ?? [];
  const selectedFace = faces.find((f) => f.id === pickedFace);
  // 名前の付いていない枠に「たぶんこの人」を出す。名前が付くたびに見本が増える。
  const suggestions = useMemo(() => suggestFor(shot, allShots, roster), [shot, allShots, roster]);
  const suggested: Suggestion | undefined = selectedFace
    ? suggestions.get(selectedFace.id)
    : undefined;
  const suggestedName = suggested
    ? roster.find((c) => c.id === suggested.characterId)?.name
    : undefined;
  const sheet = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState(shot.body ?? "");
  const [speaker, setSpeaker] = useState(shot.speakerRaw ?? "");
  // 決まっていないときだけ開いておく。名簿は 20 人を超えるので、
  // 決まっている枚でも開いたままだと本文までが遠い。
  const [picking, setPicking] = useState(!shot.speakerId);
  const dirty =
    body !== (shot.body ?? "") || speaker !== (shot.speakerRaw ?? "");

  useEffect(() => {
    let alive = true;
    setBlob(undefined);
    setConfirming(false);
    setResettingFaces(false);
    setBody(shot.body ?? "");
    setSpeaker(shot.speakerRaw ?? "");
    setPicking(!shot.speakerId);
    getImage(shot.id).then((b) => {
      if (alive) setBlob(b);
    });
    return () => {
      alive = false;
    };
  }, [shot.id, shot.body, shot.speakerRaw, shot.speakerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // shot.id だけを見る。body 等の更新のたびには走らせない。
  useEffect(() => {
    onViewShot?.(shot);
  }, [shot.id, onViewShot]); // eslint 未導入。shot 全体は意図して依存に含めていない

  useEdgeSwipeBack(sheet, onClose);

  const picked = roster.find((c) => c.id === shot.speakerId);

  return (
    <div
      className="sheet over"
      ref={sheet}
      role="dialog"
      aria-modal="true"
      aria-label="スクショの詳細"
    >
      <div className="sheet-bar">
        <button className="ghost" onClick={onClose}>
          ← 戻る
        </button>
        <span className="sheet-name">{shot.fileName}</span>
        <button
          className={shot.favorite ? "star on" : "star"}
          onClick={() => onToggleFavorite(shot)}
          aria-label="お気に入り"
          aria-pressed={shot.favorite ?? false}
        >
          ★
        </button>
        {confirming ? (
          <span className="confirm">
            <button className="danger" onClick={() => onDelete(shot)}>
              削除する
            </button>
            <button className="ghost" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </span>
        ) : (
          <button className="ghost" onClick={() => setConfirming(true)}>
            削除
          </button>
        )}
      </div>

      <div className="sheet-body">
        {blob ? (
          <div className="shot-stage">
            <BlobImage blob={blob} alt={shot.fileName} />
            <FaceBoxes
              faces={faces}
              width={shot.width}
              height={shot.height}
              roster={roster}
              adding={addingFace}
              selectedId={pickedFace}
              onSelect={setPickedFace}
              onChange={(next) => onFaces(shot, next)}
            />
            {imageMoodBusy && (
              <span className="mood-infer-badge" role="status">
                <span className="spin" />
                絵から推論中
              </span>
            )}
          </div>
        ) : (
          <p className="muted">読み込み中…</p>
        )}
      </div>

      {/* 絵のすぐ下に置く。上の帯はもう 4 つで埋まっているし、
          「この 1 枚を送る」は絵を見ている場所で決まるので、ここが近い。 */}
      <div className="sheet-send">
        <button onClick={() => onShare(shot)} disabled={!blob || busy}>
          この 1 枚を送る
        </button>
      </div>

      <section className="face-tools">
        <div className="face-head">
          <span className="filter-label">
            顔 {faces.length} 個
            {faces.filter((f) => f.assigned).length > 0 &&
              `（うち ${faces.filter((f) => f.assigned).length} 個は仮）`}
            {shot.facesScanned === false || shot.facesScanned === undefined
              ? '（まだ探していません）'
              : ''}
          </span>
          <span className="row">
            {resettingFaces ? (
              <>
                <button
                  className="ghost tiny danger"
                  disabled={busy}
                  onClick={() => {
                    onResetFaces(shot);
                    setResettingFaces(false);
                  }}
                >
                  本当に消して探し直す
                </button>
                <button className="ghost tiny" onClick={() => setResettingFaces(false)}>
                  やめる
                </button>
              </>
            ) : (
              <>
                <button
                  className="ghost tiny"
                  disabled={busy || faces.length === 0}
                  onClick={() => setResettingFaces(true)}
                >
                  消して探し直す
                </button>
                <button
                  className={addingFace ? "ghost tiny on" : "ghost tiny"}
                  onClick={() => {
                    setAddingFace(!addingFace);
                    setPickedFace(undefined);
                  }}
                  aria-pressed={addingFace}
                >
                  {addingFace ? "足すのをやめる" : "枠を足す"}
                </button>
              </>
            )}
          </span>
        </div>

        {resettingFaces && (
          <p className="muted small">
            手で足した・動かした・確定した名前もすべて消えます。もう一度、自動で
            探し直します。元には戻せません。
          </p>
        )}

        {addingFace && (
          <p className="muted small">
            絵の上をなぞると枠になります。後ろ姿やぼけて写っている人も、頭のあたりを
            囲めば数に入れられます。
          </p>
        )}

        {selectedFace && !addingFace && (
          <>
            <div className="face-head">
              <span className="filter-label">
                この枠は誰？
                {selectedFace.characterId
                  ? ""
                  : "（押して選ぶ。もう一度押すと外れる）"}
              </span>
              <button
                className="ghost tiny danger"
                onClick={() => {
                  onFaces(shot, faces.filter((f) => f.id !== selectedFace.id));
                  setPickedFace(undefined);
                }}
              >
                この枠を消す
              </button>
            </div>
            {selectedFace.assigned && (
              <div className="face-guess">
                <span className="muted small">
                  <b>{roster.find((c) => c.id === selectedFace.characterId)?.name}</b>
                  {selectedFace.assigned === 'speaker'
                    ? " と仮置き（話者が読めていて顔が 1 つ）"
                    : " と仮置き（似ている顔から）"}
                </span>
                <button
                  className="tiny"
                  onClick={() =>
                    onFaces(
                      shot,
                      faces.map((f) =>
                        f.id === selectedFace.id
                          ? { ...f, assigned: undefined, namePicked: true }
                          : f,
                      ),
                    )
                  }
                >
                  確定
                </button>
              </div>
            )}
            {suggested && suggestedName && (
              <div className="face-guess">
                <span className="muted small">
                  たぶん <b>{suggestedName}</b>（
                  {suggested.confidence >= 0.5
                    ? "近い"
                    : suggested.confidence >= 0.3
                      ? "似ている"
                      : "自信なし"}
                  ・見本 {suggested.samples} 枚）
                </span>
                <button
                  className="tiny"
                  onClick={() =>
                    onFaces(
                      shot,
                      faces.map((f) =>
                        f.id === selectedFace.id
                          ? {
                              ...f,
                              characterId: suggested.characterId,
                              assigned: undefined,
                              namePicked: true,
                            }
                          : f,
                      ),
                    )
                  }
                >
                  そう
                </button>
              </div>
            )}
            <div className="chips-row">
              {roster.map((c) => {
                const on = selectedFace.characterId === c.id;
                return (
                  <button
                    key={c.id}
                    className={on ? "chip active" : "chip"}
                    onClick={() =>
                      onFaces(
                        shot,
                        faces.map((f) =>
                          f.id === selectedFace.id
                            ? {
                                ...f,
                                characterId: on ? undefined : c.id,
                                assigned: undefined,
                                namePicked: true,
                              }
                            : f,
                        ),
                      )
                    }
                    aria-pressed={on}
                    style={c.color && !on ? { borderColor: c.color } : undefined}
                  >
                    {c.color && (
                      <span className="chip-dot" style={{ background: c.color }} />
                    )}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>


      <section className="text-edit">
        <h2>タグ</h2>
        <span className="filter-label">表情</span>
        <div className="chips-row">
          {moods.map((m) => {
            const on = shot.moods?.includes(m) ?? false;
            const rejected = !on && (shot.moodsRejected?.includes(m) ?? false);
            // セリフ・絵から推しただけの札は、押されていない見た目のまま「仮」を添える。
            // 押せば手で振ったことになる ── 合っていれば 1 タップで確定できる。
            // guessedMoods は on・rejected をすでに除いている。
            const guessed = guessedMoods(shot).includes(m);
            return (
              <button
                key={m}
                className={on ? "chip active" : rejected ? "chip rejected" : guessed ? "chip guess" : "chip"}
                onClick={() => onToggleMood(shot, m)}
                aria-pressed={on}
                title={
                  rejected
                    ? "「これは違う」に。もう一度押すとニュートラルに戻ります"
                    : guessed
                      ? "セリフ・絵からの推測。押すと確定します"
                      : undefined
                }
              >
                {m}
                {guessed ? "（仮）" : ""}
              </button>
            );
          })}
        </div>
        {roster.length > 0 && (
          <>
            <span className="filter-label">写っている人</span>
            <div className="chips-row">
              {roster.map((c) => {
                const on = shot.characterIds?.includes(c.id) ?? false;
                return (
                  <button
                    key={c.id}
                    className={on ? "chip active" : "chip"}
                    onClick={() => onToggleCharacter(shot, c.id)}
                    aria-pressed={on}
                    style={
                      c.color && !on ? { borderColor: c.color } : undefined
                    }
                  >
                    {c.color && (
                      <span
                        className="chip-dot"
                        style={{ background: c.color }}
                      />
                    )}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="text-edit">
        <h2>読み取った文字</h2>
        {shot.ocr === "error" && (
          <p className="notice">読み取りに失敗しました: {shot.ocrError}</p>
        )}
        {shot.ocr !== "done" && shot.ocr !== "error" && !shot.textEdited && (
          <p className="muted">まだ読み取っていません。</p>
        )}
        <label className="field">
          <span>話者</span>
          <input
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            placeholder="（なし）"
          />
        </label>
        {/* 読めたのに弾いたときは、その生値を見せる。黙って空にすると
            「読めなかった」のか「読めたが名前と認めなかった」のか分からず、直しようがない。 */}
        {!speaker && shot.speakerRejected && (
          <p className="muted hint">
            読み取れたのは「{shot.speakerRejected}
            」でした。名前として受け取れなかったので空にしています。
          </p>
        )}
        {/* 誰かを選べば、その人にこのチップの色を覚えさせる。
            以後、同じ色で名前が読めなかった枚は、読み直しなしで同じ人に付く。
            読み取りは同じ絵でも当たり外れがあるので、教える口が要る。 */}
        {roster.length > 0 && (
          <>
            <button
              className="ghost small tagq-people"
              onClick={() => setPicking(!picking)}
              aria-expanded={picking}
            >
              話者は{picked ? `「${picked.name}」` : "（なし）"}
              {shot.speakerChipColor && (
                <>
                  {" · "}
                  <span
                    className="chip-dot"
                    style={{ background: shot.speakerChipColor }}
                  />{" "}
                  {shot.speakerChipColor}
                </>
              )}{" "}
              {picking ? "▲" : "▼"}
            </button>
            {picking && (
              <div className="chips-row">
                {roster.map((c) => {
                  const on = shot.speakerId === c.id;
                  return (
                    <button
                      key={c.id}
                      className={on ? "chip active" : "chip"}
                      onClick={() => onSetSpeaker(shot, on ? null : c.id)}
                      aria-pressed={on}
                      style={
                        c.color && !on ? { borderColor: c.color } : undefined
                      }
                    >
                      {c.color && (
                        <span
                          className="chip-dot"
                          style={{ background: c.color }}
                        />
                      )}
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
        <label className="field">
          <span>本文</span>
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="（なし）"
          />
        </label>
        <div className="row">
          <button
            disabled={!dirty}
            onClick={() => onSaveText(shot, body, speaker)}
          >
            直した内容を保存
          </button>
          <button
            className="ghost"
            disabled={busy}
            onClick={() => onReRecognize(shot)}
          >
            もう一度読み取る
          </button>
        </div>
        {shot.textEdited && (
          <p className="muted">
            手で直したものとして印がついています。以後の一括読み取りでは上書きしません。
          </p>
        )}
      </section>

      <dl className="meta">
        <div>
          <dt>種別</dt>
          <dd>
            {shot.layout ? (LAYOUT_LABEL[shot.layout] ?? shot.layout) : "—"}
          </dd>
        </div>
        <div>
          <dt>話</dt>
          <dd>{shot.story ? formatStory(shot.story) : "—"}</dd>
        </div>
        <div>
          <dt>寸法</dt>
          <dd>
            {shot.width} × {shot.height}
          </dd>
        </div>
        <div>
          <dt>容量</dt>
          <dd>{formatBytes(shot.size)}</dd>
        </div>
        <div>
          <dt>形式</dt>
          <dd>{shot.mime.replace("image/", "")}</dd>
        </div>
        <div>
          <dt>撮影</dt>
          <dd>{shot.shotAt ? formatDate(shot.shotAt) : "不明"}</dd>
        </div>
        <div>
          <dt>取り込み</dt>
          <dd>{formatDate(shot.createdAt)}</dd>
        </div>
      </dl>
    </div>
  );
}
