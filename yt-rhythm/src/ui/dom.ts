type Props = {
  class?: string
  text?: string
  html?: string
  attrs?: Record<string, string | number | boolean>
  style?: Partial<CSSStyleDeclaration>
  on?: Record<string, (e: Event) => void>
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.text !== undefined) node.textContent = props.text
  if (props.html !== undefined) node.innerHTML = props.html
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === false) continue
      node.setAttribute(k, String(v))
    }
  }
  if (props.style) Object.assign(node.style, props.style)
  if (props.on) {
    for (const [k, fn] of Object.entries(props.on)) node.addEventListener(k, fn)
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return h('button', { class: cls, text: label, attrs: { type: 'button' }, on: { click: onClick } })
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/** mm:ss.mmm 表示。エディタの時刻表示用。 */
export function formatTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const s = Math.abs(seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${sign}${m}:${rest.toFixed(3).padStart(6, '0')}`
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = h('a', { attrs: { href: url, download: filename } })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { attrs: { type: 'file', accept } })
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null
      input.remove()
      resolve(file)
    })
    // キャンセル時にも DOM を残さない（対応ブラウザのみ）。
    input.addEventListener('cancel', () => {
      input.remove()
      resolve(null)
    })
    input.click()
  })
}

let toastTimer: number | undefined

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let node = document.querySelector<HTMLDivElement>('.toast')
  if (!node) {
    node = h('div', { class: 'toast' })
    document.body.appendChild(node)
  }
  node.textContent = message
  node.classList.toggle('toast-error', kind === 'error')
  node.classList.add('toast-show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => node?.classList.remove('toast-show'), 2800)
}
