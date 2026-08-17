/**
 * Tells the splitter which lines are real markdown structure and which sit
 * inside a code fence or an HTML comment, where a `---` is not a separator.
 */

export interface LineInfo {
  /** Line content, without the trailing newline or CR. */
  readonly text: string
  readonly blank: boolean
  /** True for fence delimiters and everything between them. */
  readonly inFence: boolean
  /** True for any line that is inside, opens, or closes an HTML comment. */
  readonly inComment: boolean
}

interface Fence {
  readonly char: string
  readonly len: number
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

function matchFence(text: string): { char: string; len: number; info: string } | null {
  const m = FENCE_RE.exec(text)
  if (!m) return null
  const marker = m[1]!
  return { char: marker[0]!, len: marker.length, info: m[2]!.trim() }
}

/** Scan a single line for comment delimiters, given whether it starts inside one. */
function scanComment(text: string, startsInside: boolean): { touched: boolean; endsInside: boolean } {
  let inside = startsInside
  let touched = startsInside
  let pos = 0

  for (;;) {
    if (inside) {
      const close = text.indexOf('-->', pos)
      if (close === -1) return { touched: true, endsInside: true }
      inside = false
      pos = close + 3
    } else {
      const open = text.indexOf('<!--', pos)
      if (open === -1) return { touched, endsInside: false }
      inside = true
      touched = true
      pos = open + 4
    }
  }
}

export function scanLines(source: string): LineInfo[] {
  const out: LineInfo[] = []
  let fence: Fence | null = null
  let inComment = false

  for (const raw of source.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const blank = text.trim() === ''

    if (fence) {
      const close = matchFence(text)
      out.push({ text, blank, inFence: true, inComment: false })
      if (close && close.char === fence.char && close.len >= fence.len && close.info === '') {
        fence = null
      }
      continue
    }

    if (inComment) {
      const c = scanComment(text, true)
      out.push({ text, blank, inFence: false, inComment: true })
      inComment = c.endsInside
      continue
    }

    const open = matchFence(text)
    // A backtick fence's info string may not contain a backtick (CommonMark).
    if (open && !(open.char === '`' && open.info.includes('`'))) {
      fence = { char: open.char, len: open.len }
      out.push({ text, blank, inFence: true, inComment: false })
      continue
    }

    const c = scanComment(text, false)
    out.push({ text, blank, inFence: false, inComment: c.touched })
    inComment = c.endsInside
  }

  return out
}
