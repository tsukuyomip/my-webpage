// ============================================================================
//  TMMN HOUSE — 物件データ（このファイルが「唯一の正」）
// ============================================================================
//
//  平面図・面積表・坪数・畳数・検算パネルは、すべてこのファイルから計算されます。
//  面積を手で書く欄はどこにもありません（ポリゴンから自動計算）。
//  ここを直せば、図も数字も同時に、必ず一致した状態で変わります。
//
//  ── 座標系 ──────────────────────────────────────────────
//    1単位 = 1.0m（図面の1マス = 1,000mm）
//    x : 西 → 東（画面左 → 右）
//    y : 北 → 南（画面上 → 下）   ※SVGのy方向と一致させるためこの向き
//    原点 (0,0) = 建物の北西角。建物は 10.0m × 10.0m。
//
//  ── 面積の規約 ──────────────────────────────────────────
//    ポリゴンは「内法（うちのり）＝ネット面積」で定義し、壁厚は隣り合う部屋の
//    境界線の上に太さとして描きます。この規約により
//        Σ(各室の面積) + Σ(吹抜・中庭) = 建築面積 100.00㎡
//    がちょうど成立します。検算パネルがこれを毎回チェックします。
//
//  ── 編集するときの注意 ──────────────────────────────────
//    ポリゴンを動かすと面積は自動で追従しますが、隣の部屋との間に
//    「すき間」や「重なり」ができることがあります。
//    画面右下の【検算】パネルが被覆率と重複を実測して警告するので、
//    編集後はそこが全部 OK になっていることを確認してください。
// ============================================================================

/** 建物・図面のメタ情報 */
export const meta = {
  title: '約50坪・中庭のあるビルトインガレージハウス',
  subtitle: '2層吹抜の中庭を囲む、土間中心の2階建て',
  scale: '1/100',
  gridMm: 1000,
  /** 建物外形（フットプリント）。建築面積の計算にも使う */
  footprint: { w: 10.0, d: 10.0 },
  /** 面積換算の定数 */
  tsuboPerM2: 1 / 3.305785, // 1坪 = 3.305785㎡
  jyoPerM2: 1 / 1.62,       // 1畳 = 1.62㎡（中京間換算）
};

// ----------------------------------------------------------------------------
//  仕上げ材のパレット
//    tone: 'base'   … 基調（淡い木＋モルタル＋白）
//          'accent' … 意図的に落とす「こもる」ダークアクセント
//          'wet'    … 水回り
// ----------------------------------------------------------------------------
export const materials = {
  'f-tile-beige':   { name: 'ベージュタイル 600角',      tone: 'base',   color: '#ded5c8' },
  'f-oak-pale':     { name: 'オーク（淡色）フローリング', tone: 'base',   color: '#dcc199' },
  'f-mortar':       { name: 'モルタル金鏝押え',          tone: 'base',   color: '#b4aea6' },
  'f-concrete':     { name: '土間コンクリート',          tone: 'accent', color: '#8f8b85' },
  'f-rubber-dark':  { name: 'ラバータイル（ダーク）',    tone: 'accent', color: '#3a3632' },
  'f-walnut':       { name: 'ウォールナット張り',        tone: 'accent', color: '#6b4b33' },
  'f-tile-white':   { name: '磁器質タイル（白）',        tone: 'wet',    color: '#ece9e3' },
  'f-lawn':         { name: '芝＋砂利',                  tone: 'base',   color: '#9bb07a' },

  'w-mortar':       { name: 'モルタル左官',              tone: 'base',   color: '#bdb5aa' },
  'w-white':        { name: '白塗装',                    tone: 'base',   color: '#f2efe9' },
  'w-mirror':       { name: 'ミラー（全面）',            tone: 'accent', color: '#9aa3a6' },
  'w-walnut-slat':  { name: 'ウォールナット縦格子',      tone: 'accent', color: '#5c4130' },
  'w-walnut-shelf': { name: 'ウォールナット造作棚',      tone: 'accent', color: '#5c4130' },
  'w-tile-mosaic':  { name: 'モザイクタイル',            tone: 'wet',    color: '#d8d3ca' },
  'w-concrete':     { name: '打放しコンクリート',        tone: 'base',   color: '#a8a49e' },

  'c-wood-pale':    { name: '淡色木羽目板 天井',         tone: 'base',   color: '#dcc196' },
  'c-white':        { name: '白塗装 天井',               tone: 'base',   color: '#f4f1eb' },
  'c-dark-slat':    { name: 'ダークルーバー天井',        tone: 'accent', color: '#38312b' },
  'c-open':         { name: '（屋外／吹抜）',            tone: 'base',   color: '#cfe0ea' },
};

// ----------------------------------------------------------------------------
//  ゾーン（平面図の塗り分けと凡例に使う）
// ----------------------------------------------------------------------------
export const zones = {
  public:      { name: 'LDK・共用',   color: 'var(--z-public)' },
  private:     { name: '個室',        color: 'var(--z-private)' },
  service:     { name: '水回り・収納', color: 'var(--z-service)' },
  circulation: { name: '土間・動線',   color: 'var(--z-circulation)' },
  dark:        { name: 'ダーク系',    color: 'var(--z-dark)' },
  outdoor:     { name: '中庭・吹抜',   color: 'var(--z-outdoor)' },
};

// ----------------------------------------------------------------------------
//  各階
//    rooms[] … 床面積に算入する室
//    voids[] … 床面積に算入しない部分（中庭＝屋外、吹抜）
//
//  room のフィールド
//    id / name       : 識別子と表示名
//    zone            : 上の zones のキー
//    polygon         : [[x,y], ...] 時計回り。面積はここから計算
//    labelAt         : （任意）L字などで重心が室外に出る場合のラベル位置
//    finishes        : { floor, wall, ceiling } … materials のキー
//    lighting        : 照明計画のメモ
//    features[]      : 特記事項
//    views[]         : この室から見た「絵」。平面図に視点マーカーとして出る
//        id     : 画像ファイル名にもなる（images/<id>.jpg）
//        label  : 視点の説明
//        at     : [x,y] 立ち位置
//        dir    : 視線方位（度）0=北 90=東 180=南 270=西
//        ref    : 参考写真の通し番号（もらった14枚のうち何枚目か）
// ----------------------------------------------------------------------------

export const floors = [
  // ==========================================================================
  //  1F — 土間が中庭をL字に回り込み、その周りに個室が並ぶ
  // ==========================================================================
  {
    id: '1f',
    name: '1F',
    rooms: [
      {
        id: 'master-bedroom',
        name: '主寝室',
        zone: 'private',
        polygon: [[0, 0], [3.4, 0], [3.4, 3.4], [0, 3.4]],
        finishes: { floor: 'f-oak-pale', wall: 'w-mortar', ceiling: 'c-wood-pale' },
        lighting: 'R壁の裏に間接照明。手元は小型スタンドのみ',
        features: [
          'ヘッドボード側をR（曲面）壁にし、天井との間から間接光を落とす',
          '北側に地窓＋造作デスク',
          'WICと直結。土間廊下側にも扉を持つ2WAY',
        ],
        views: [
          { id: 'master-bedroom', label: 'ベッド／R壁の間接照明を見る', at: [2.9, 2.9], dir: 315, ref: 13 },
        ],
      },
      {
        id: 'wic',
        name: 'WIC',
        zone: 'service',
        polygon: [[3.4, 0], [4.4, 0], [4.4, 3.4], [3.4, 3.4]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: 'ライン照明１本',
        features: ['幅1.0m × 奥行3.4mのウォークイン', '主寝室と土間廊下の両方から入れる'],
        views: [],
      },
      {
        id: 'study',
        name: '書斎',
        zone: 'private',
        polygon: [[4.4, 0], [8.0, 0], [8.0, 2.4], [4.4, 2.4]],
        finishes: { floor: 'f-walnut', wall: 'w-walnut-shelf', ceiling: 'c-white' },
        lighting: '棚下ライン照明＋デスクスタンド。全体照明は絞る',
        features: [
          '基調から意図的に外した「こもる」ダークアクセントの部屋',
          '壁一面のウォールナット造作本棚＋L字デスク',
          '窓辺に小上がりの読書スペース（座面高400）',
        ],
        views: [
          { id: 'study', label: '造作本棚と小上がりを見る', at: [7.5, 2.1], dir: 300, ref: 14 },
        ],
      },
      {
        id: 'washroom',
        name: '洗面脱衣室＋ランドリー',
        zone: 'service',
        polygon: [[8.0, 0], [10.0, 0], [10.0, 3.4], [8.0, 3.4]],
        finishes: { floor: 'f-tile-white', wall: 'w-tile-mosaic', ceiling: 'c-wood-pale' },
        lighting: '木天井の折り上げに間接照明。ミラー左右にライン照明',
        features: [
          '洗面 → ランドリー → 浴室が一直線の家事動線',
          '洗濯機はカウンター下に納め、天板を作業台として連続させる',
          '三面鏡裏収納＋ガラス棚',
        ],
        views: [
          { id: 'washroom', label: '洗面から浴室方向を見る', at: [9.0, 0.35], dir: 180, ref: 8 },
        ],
      },
      {
        id: 'nook',
        name: 'ヌック／猫スペース',
        zone: 'public',
        polygon: [[4.4, 2.4], [8.0, 2.4], [8.0, 3.4], [4.4, 3.4]],
        finishes: { floor: 'f-tile-beige', wall: 'w-mortar', ceiling: 'c-wood-pale' },
        lighting: '木天井の見切りに仕込んだライン間接照明のみ',
        features: [
          '中庭に面した幅3.6m・奥行1.0mの居場所',
          '造作ベンチ（座面高400・下部は猫トイレとストック収納）',
          '猫の通り道として書斎・土間廊下へキャットドアで抜ける',
        ],
        views: [
          { id: 'nook', label: 'ベンチと中庭側の窓を見る', at: [7.7, 2.9], dir: 270, ref: 6 },
        ],
      },
      {
        id: 'storage-1f',
        name: '収納室',
        zone: 'service',
        polygon: [[0, 3.4], [3.4, 3.4], [3.4, 4.4], [0, 4.4]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: '人感センサーのダウンライト',
        features: ['可動棚の多用途収納', 'ガレージ側からも土間廊下側からも入れる'],
        views: [],
      },
      {
        id: 'bath',
        name: '浴室',
        zone: 'service',
        polygon: [[8.0, 3.4], [10.0, 3.4], [10.0, 5.4], [8.0, 5.4]],
        finishes: { floor: 'f-tile-white', wall: 'w-tile-mosaic', ceiling: 'c-wood-pale' },
        lighting: '防湿ダウンライト＋洗い場側に足元灯',
        features: [
          '2.0m × 2.0m。中庭に面し、浴槽から中庭のシンボルツリーを見上げる',
          '天井は淡色の木羽目板（洗面と連続）',
        ],
        views: [],
      },
      {
        id: 'wc-1f',
        name: 'トイレ（1F）',
        zone: 'service',
        polygon: [[8.0, 5.4], [10.0, 5.4], [10.0, 6.4], [8.0, 6.4]],
        finishes: { floor: 'f-mortar', wall: 'w-mortar', ceiling: 'c-white' },
        lighting: 'ミラー全周のバックライト＋天井コーニス間接。ダウンライトなし',
        features: [
          '一枚板のカウンターにガラスボウルを置く',
          '壁は左官モルタル。照度を落として陰影で見せる',
          '壁掛け式便器で床を通し、足元をすっきりさせる',
        ],
        views: [
          { id: 'wc-1f', label: 'ミラーと一枚板カウンターを見る', at: [9.6, 6.2], dir: 0, ref: 11 },
        ],
      },
      {
        id: 'garage',
        name: 'ビルトインガレージ（1台）',
        zone: 'dark',
        polygon: [[0, 4.4], [3.4, 4.4], [3.4, 10.0], [0, 10.0]],
        finishes: { floor: 'f-concrete', wall: 'w-concrete', ceiling: 'c-dark-slat' },
        lighting: '天井ルーバーに沿ったライン照明＋車体を舐めるスポット',
        features: [
          '3.4m × 5.6m。1台＋前後の作業スペース',
          '東側の壁に大きな室内窓。土間から車が「展示」のように見える',
          '土間との間に人用の扉を別途設ける',
        ],
        views: [],
      },
      {
        id: 'doma',
        name: '玄関土間',
        zone: 'circulation',
        // L字（南の主部 → 中庭の西側を北へ回り込む廊下）
        polygon: [
          [3.4, 3.4], [4.4, 3.4], [4.4, 6.9], [8.0, 6.9],
          [8.0, 7.6], [6.6, 7.6], [6.6, 10.0], [3.4, 10.0],
        ],
        labelAt: [5.9, 8.3],
        finishes: { floor: 'f-tile-beige', wall: 'w-mortar', ceiling: 'c-wood-pale' },
        lighting: '壁の見切りの間接照明＋階段の踏板下ライン照明',
        features: [
          'この家の背骨。玄関から中庭の西側を北へ回り込み、各室へ配る',
          '中庭側は床から立ち上がるピクチャーウィンドウ',
          'スケルトン階段（幅1.0m・直階段）がこの土間の中に浮く',
          'ガレージへ大室内窓、ジムへ室内窓。土間から2つの「見せ場」が見える',
          '自転車をそのまま持ち込める土間仕上げ',
        ],
        views: [
          { id: 'genkan-hall',        label: '玄関から北を見る（框と縦格子）',   at: [5.4, 9.6], dir: 0,   ref: 10 },
          { id: 'doma-stair',         label: 'スケルトン階段を見る',             at: [4.9, 9.2], dir: 350, ref: 3 },
          { id: 'doma-garage-window', label: 'ガレージの室内窓越しに車を見る',   at: [5.0, 8.6], dir: 270, ref: 2 },
          { id: 'doma-courtyard',     label: '中庭沿いの廊下を北へ見る',         at: [3.9, 6.4], dir: 0,   ref: 7 },
        ],
      },
      {
        id: 'pantry-sc',
        name: 'パントリー／シューズクローク',
        zone: 'service',
        polygon: [[8.0, 6.4], [10.0, 6.4], [10.0, 7.6], [8.0, 7.6]],
        finishes: { floor: 'f-tile-beige', wall: 'w-white', ceiling: 'c-white' },
        lighting: '人感センサーのライン照明',
        features: ['玄関土間から直接入る土間続きの収納', '可動棚で靴・防災備蓄・アウトドア用品を兼用'],
        views: [],
      },
      {
        id: 'gym',
        name: 'ジム',
        zone: 'dark',
        polygon: [[6.6, 7.6], [10.0, 7.6], [10.0, 10.0], [6.6, 10.0]],
        finishes: { floor: 'f-rubber-dark', wall: 'w-mirror', ceiling: 'c-dark-slat' },
        lighting: 'ダーク天井に埋めたライン照明。ミラー面を斜めから照らす',
        features: [
          '【新設】参考写真のジムに該当する室が原案になかったため追加した部屋',
          '3.4m × 2.4m。トレッドミル１台＋マットスペースの家庭用サイズ',
          '東面いっぱいのミラー壁。ガレージと同じダークトーンで揃える',
          '土間側に室内窓。ガレージの室内窓と土間を挟んで向かい合う',
          '防振ゴム下地。1Fに置くことで上階への振動を避ける',
        ],
        views: [
          { id: 'gym', label: '入口からミラー壁側を見る', at: [7.1, 9.4], dir: 60, ref: 4 },
        ],
      },
    ],
    voids: [
      {
        id: 'courtyard',
        name: '中庭（2層吹抜）',
        zone: 'outdoor',
        kind: 'outdoor',
        polygon: [[4.4, 3.4], [8.0, 3.4], [8.0, 6.9], [4.4, 6.9]],
        finishes: { floor: 'f-lawn', wall: 'w-concrete', ceiling: 'c-open' },
        lighting: '株元からのアッパーライト3灯。夜は樹形が2Fの窓に映る',
        features: [
          '3.6m × 3.5m。1F・2Fを貫く2層吹抜',
          'シンボルツリー（株立ちのアオダモ／シマトネリコ想定）',
          '樹冠が2Fの開口の高さに来るので、2F LDKからは「緑に面した窓」になる',
          '四周を建物で囲うため、道路からの視線が入らない',
          '西側のガラス越しに、土間のスケルトン階段が見える',
        ],
        views: [
          { id: 'courtyard', label: '中庭から見上げる', at: [6.2, 6.5], dir: 0, ref: 9 },
        ],
      },
    ],
    openings: [
      { type: 'entrance',         from: [5.4, 10.0], to: [6.4, 10.0], label: '玄関' },
      { type: 'garage-door',      from: [0, 10.0],   to: [3.4, 10.0], label: 'ガレージシャッター' },
      { type: 'interior-window',  from: [3.4, 5.2],  to: [3.4, 8.2],  label: 'ガレージ室内窓' },
      { type: 'interior-window',  from: [6.6, 8.0],  to: [6.6, 9.6],  label: 'ジム室内窓' },
      { type: 'glass',            from: [4.4, 3.6],  to: [4.4, 6.7],  label: '中庭／土間廊下' },
      { type: 'glass',            from: [8.0, 3.6],  to: [8.0, 5.2],  label: '中庭／浴室' },
      { type: 'glass',            from: [4.6, 3.4],  to: [7.8, 3.4],  label: '中庭／ヌック' },
      { type: 'glass',            from: [4.6, 6.9],  to: [7.8, 6.9],  label: '中庭／土間' },
    ],
    /** スケルトン階段（土間の中に浮く直階段。床面積は土間に含む） */
    stairs: [
      { id: 'stair-main', from: [3.5, 6.8], to: [4.3, 3.6], steps: 14, dir: 'up', label: 'スケルトン階段' },
    ],
  },

  // ==========================================================================
  //  2F — 中庭の吹抜に face する細長いLDK＋ホールブリッジ
  // ==========================================================================
  {
    id: '2f',
    name: '2F',
    rooms: [
      {
        id: 'kitchen',
        name: 'キッチン',
        zone: 'public',
        polygon: [[0, 0], [3.4, 0], [3.4, 3.4], [0, 3.4]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-wood-pale' },
        lighting: '天井の木羽目板に沿ったライン照明＋アイランド上のペンダント',
        features: [
          'アイランド型。背面に壁付けの収納一列',
          '天井の木羽目板はLDK全体で連続させる',
          '北側の高窓から安定した光を入れる',
        ],
        views: [],
      },
      {
        id: 'dining',
        name: 'ダイニング',
        zone: 'public',
        polygon: [[0, 3.4], [3.4, 3.4], [3.4, 6.6], [0, 6.6]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-wood-pale' },
        lighting: 'テーブル上にペンダント2灯',
        features: [
          '東側は全面ガラス。ホールブリッジ越しに中庭の吹抜と樹冠が見える',
          'キッチンと一直線に連続する配置',
        ],
        views: [],
      },
      {
        id: 'living',
        name: 'リビング',
        zone: 'public',
        polygon: [[0, 6.6], [3.4, 6.6], [3.4, 10.0], [0, 10.0]],
        finishes: { floor: 'f-oak-pale', wall: 'w-mortar', ceiling: 'c-wood-pale' },
        lighting: '間接照明主体。AV側はダウンライトを外して映り込みを避ける',
        features: [
          '西側のモルタル壁をAVコーナーに。壁掛けTV＋トールスピーカー',
          '低いローボードで壁面を水平に伸ばす',
          '東側は全面ガラス。玄関上部の吹抜にも面し、1Fの気配が届く',
        ],
        views: [
          { id: 'living-av', label: 'AVコーナー（モルタル壁）を見る', at: [2.9, 9.4], dir: 270, ref: 5 },
          { id: 'ldk',       label: 'リビングからLDK全体を見通す',     at: [1.0, 9.5], dir: 0,   ref: 12 },
        ],
      },
      {
        id: 'hall-2f',
        name: '廊下（2F）',
        zone: 'circulation',
        polygon: [[3.4, 0], [8.0, 0], [8.0, 1.0], [3.4, 1.0]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: '足元のフットライト＋ダウンライト',
        features: ['北面に沿ってホールブリッジと東側の各室をつなぐ'],
        views: [],
      },
      {
        id: 'pantry-2f',
        name: 'パントリー（2F）',
        zone: 'service',
        polygon: [[3.4, 1.0], [4.4, 1.0], [4.4, 3.4], [3.4, 3.4]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: '人感センサーのライン照明',
        features: ['キッチンの真横。食品ストックと家電の置き場'],
        views: [],
      },
      {
        id: 'bedroom-2f',
        name: '洋室',
        zone: 'private',
        polygon: [[4.4, 1.0], [8.0, 1.0], [8.0, 3.4], [4.4, 3.4]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: 'ダウンライト＋ベッド脇のブラケット',
        features: ['南面が中庭の吹抜に面する', '将来2室に間仕切れる幅（3.6m）を確保'],
        views: [],
      },
      {
        id: 'hall-bridge',
        name: 'ホールブリッジ',
        zone: 'circulation',
        polygon: [[3.4, 3.4], [4.4, 3.4], [4.4, 10.0], [3.4, 10.0]],
        labelAt: [3.9, 8.5],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-wood-pale' },
        lighting: '手すり下のライン照明。夜は中庭側に光がこぼれる',
        features: [
          '中庭と玄関、2つの吹抜に沿って架かる開放通路',
          '壁ではなく手すりのみ。LDKからは吹抜の緑が抜けて見える',
          '1Fのスケルトン階段はここに着く',
        ],
        views: [],
      },
      {
        id: 'wc-2f',
        name: 'トイレ（2F）',
        zone: 'service',
        polygon: [[8.0, 0], [10.0, 0], [10.0, 1.0], [8.0, 1.0]],
        finishes: { floor: 'f-mortar', wall: 'w-mortar', ceiling: 'c-white' },
        lighting: '1Fと同じ考え方（ミラーバックライト＋間接）',
        features: ['1Fトイレと仕上げを揃える'],
        views: [],
      },
      {
        id: 'family-closet',
        name: 'ファミリークローゼット',
        zone: 'service',
        polygon: [[8.0, 1.0], [10.0, 1.0], [10.0, 3.0], [8.0, 3.0]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: 'ライン照明1本',
        features: ['2.0m × 2.0m。家族分の衣類をまとめて持つ'],
        views: [],
      },
      {
        id: 'library',
        name: '書庫／ワークスペース',
        zone: 'private',
        polygon: [[8.0, 3.0], [10.0, 3.0], [10.0, 6.9], [8.0, 6.9]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: '棚下ライン照明＋デスクスタンド',
        features: [
          '西面が中庭の吹抜に面する。座ると目線の高さに樹冠が来る',
          '幅2.0mの細長い空間。壁一面を書棚に',
        ],
        views: [],
      },
      {
        id: 'storage-2f',
        name: '収納（2F）',
        zone: 'service',
        polygon: [[8.0, 6.9], [10.0, 6.9], [10.0, 8.0], [8.0, 8.0]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: '人感センサーのダウンライト',
        features: ['可動棚'],
        views: [],
      },
      {
        id: 'hobby',
        name: 'ホビールーム／納戸',
        zone: 'private',
        polygon: [[8.0, 8.0], [10.0, 8.0], [10.0, 10.0], [8.0, 10.0]],
        finishes: { floor: 'f-oak-pale', wall: 'w-white', ceiling: 'c-white' },
        lighting: 'ダウンライト',
        features: ['2.0m × 2.0m。用途を決めない予備室'],
        views: [],
      },
    ],
    voids: [
      {
        id: 'void-courtyard',
        name: '吹抜（中庭上部）',
        zone: 'outdoor',
        kind: 'void',
        polygon: [[4.4, 3.4], [8.0, 3.4], [8.0, 6.9], [4.4, 6.9]],
        finishes: { floor: 'f-lawn', wall: 'w-concrete', ceiling: 'c-open' },
        lighting: '（1F 中庭を参照）',
        features: [
          '1Fの中庭がそのまま抜ける',
          'ここに立つ樹の樹冠が、2FのLDK・洋室・書庫の窓の高さに来る',
        ],
        views: [],
      },
      {
        id: 'void-entrance',
        name: '吹抜（玄関上部）',
        zone: 'outdoor',
        kind: 'void',
        polygon: [[4.4, 6.9], [8.0, 6.9], [8.0, 10.0], [4.4, 10.0]],
        finishes: { floor: 'f-tile-beige', wall: 'w-mortar', ceiling: 'c-wood-pale' },
        lighting: '（1F 玄関土間を参照）',
        features: ['玄関土間の上を抜く', 'ホールブリッジから1Fの土間を見下ろせる'],
        views: [],
      },
    ],
    openings: [
      { type: 'glass', from: [3.4, 3.6],  to: [3.4, 9.8], label: 'LDK／ホールブリッジ' },
      { type: 'glass', from: [4.6, 3.4],  to: [7.8, 3.4], label: '洋室／吹抜' },
      { type: 'glass', from: [8.0, 3.6],  to: [8.0, 6.7], label: '書庫／吹抜' },
    ],
    stairs: [
      { id: 'stair-main-2f', from: [3.5, 3.6], to: [4.3, 6.8], steps: 14, dir: 'down', label: 'スケルトン階段（下り）' },
    ],
  },
];

// ----------------------------------------------------------------------------
//  動線ツアー：玄関から順に「見せ場」を巡る順路
//  （floor / room / view のIDで指定。データを直せばツアーも変わる）
// ----------------------------------------------------------------------------
export const tour = [
  { floor: '1f', room: 'doma',           view: 'genkan-hall' },
  { floor: '1f', room: 'doma',           view: 'doma-stair' },
  { floor: '1f', room: 'doma',           view: 'doma-garage-window' },
  { floor: '1f', room: 'gym',            view: 'gym' },
  { floor: '1f', room: 'doma',           view: 'doma-courtyard' },
  { floor: '1f', room: 'courtyard',      view: 'courtyard' },
  { floor: '1f', room: 'nook',           view: 'nook' },
  { floor: '1f', room: 'study',          view: 'study' },
  { floor: '1f', room: 'master-bedroom', view: 'master-bedroom' },
  { floor: '1f', room: 'washroom',       view: 'washroom' },
  { floor: '1f', room: 'wc-1f',          view: 'wc-1f' },
  { floor: '2f', room: 'living',         view: 'ldk' },
  { floor: '2f', room: 'living',         view: 'living-av' },
];

// ----------------------------------------------------------------------------
//  設計の前提と、参考写真との矛盾をどう解いたかの記録
//  （アプリの「設計メモ」タブにそのまま出ます）
// ----------------------------------------------------------------------------
export const designNotes = {
  tone: {
    title: '内装トーンの階層',
    body: [
      '基調は「淡い木＋モルタル＋白」。土間・中庭・水回り・ヌック・LDK・寝室はすべてこの系統で通す。',
      '例外は意図的に落とす「こもる」部屋だけ ── 書斎・ジム・ガレージ。濃い木／黒／ミラーを使う。',
      '参考写真のウォールナット系（玄関ホール）は、框と縦格子だけを濃色にして、床・壁は基調に寄せる。',
    ],
  },
  resolved: [
    {
      issue: '原案の1Fの室面積の合計が83.5㎡で、1F床面積82.6㎡を超えていた',
      fix: '面積を手打ちせず、すべてポリゴンから計算する方式に変更。合計が床面積とちょうど一致するよう再配分した。',
    },
    {
      issue: '原案の2Fは室面積の合計が56.0㎡なのに床面積が82.7㎡。差の26.7㎡は吹抜だが、法規上、吹抜は床面積に算入しない',
      fix: '吹抜・中庭を床面積から除外する定義に統一。結果、延床163.64㎡（49.50坪）。',
    },
    {
      issue: '参考写真のジムに該当する室が原案になかった',
      fix: '1Fの南東角にジム（8.16㎡）を新設。ガレージと同じダークトーンで揃え、土間を挟んで室内窓が向かい合う構成にした。土間は22.0㎡→14.40㎡に縮小。',
    },
    {
      issue: '参考写真の中庭に外部階段が写っているが、この計画にはない',
      fix: 'ガラス越しに見えているのは室内のスケルトン階段だと解釈。階段を中庭の西側に接して置き、中庭から見えるようにした。',
    },
    {
      issue: '参考写真の2F LDKが屋外の緑に面しているが、2Fには中庭の吹抜しかない',
      fix: '中庭を2層吹抜にして、シンボルツリーの樹冠が2Fの開口の高さに来るようにした。これが「なぜ2層吹抜なのか」の理由にもなっている。',
    },
    {
      issue: '参考写真のジムは商業ジムの規模（トレッドミル複数台）',
      fix: 'ミラー壁・ダークトーン・ライン照明という要素だけを引き継ぎ、住宅サイズ（3.4m × 2.4m）に縮小。',
    },
    {
      issue: '参考写真の浴室から木が見えるが、原案の記述と整合していなかった',
      fix: '浴室を中庭に面して配置。浴槽からシンボルツリーを見上げる関係にした。',
    },
  ],
  assumptions: [
    '建物外形は 10.0m × 10.0m の総二階。建築面積100.00㎡（30.25坪）。',
    '壁厚はポリゴンの境界線上に描く太さとして表現し、面積は内法（ネット）で扱う。',
    '1Fに個室、2FにLDKを置く逆転プラン（原案どおり）。',
    '玄関・ガレージともに南側の道路に面する。',
  ],
};
