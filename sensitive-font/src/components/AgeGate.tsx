import { useState } from 'react'

const KEY = 'sensitive-font:agreed'

export function AgeGate() {
  const [agreed, setAgreed] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })

  if (agreed) return null

  const accept = () => {
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* 保存できなくても続行はできる */
    }
    setAgreed(true)
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <h1>✨ 透過文字ジェネレータ</h1>
        <p>
          成人向け作品での利用を想定した文字素材ツールです。表示される文例に
          性的な表現が含まれます。
        </p>
        <p className="small">
          入力したテキストや作った画像はどこにも送信されず、すべてブラウザ内で処理されます。
        </p>
        <div className="gate-actions">
          <button type="button" className="primary" onClick={accept}>
            18歳以上です・利用する
          </button>
          <a className="ghost" href="../">
            戻る
          </a>
        </div>
      </div>
    </div>
  )
}
