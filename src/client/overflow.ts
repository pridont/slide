/**
 * Dev-only check for slides that lose content: `.slide` is `overflow: hidden`,
 * so an overstuffed one is trimmed with no error and no scrollbar. Height is
 * not knowable at build time, hence a browser doing the measuring.
 *
 * Two ways to lose content, and two measurements:
 *
 * 1. The slide overflows. `scrollHeight` misses this — scroll extent counts
 *    only what spills past the *end* edge, and `.slide-content` centres, so it
 *    under-reports by half. Measured instead: the union of the children's
 *    boxes against the content box.
 * 2. Nothing overflows and content is gone anyway. `pre` carries
 *    `overflow-x: auto`, and an item whose overflow is not visible has an
 *    automatic minimum size of zero, so as a flex item it shrinks and clips
 *    itself. Hence the scan for scrollable descendants.
 */

/** Where to post a report. Substituted when the dev server compiles this. */
declare const __SLIDE_REPORT_URL__: string

const TOLERANCE = 1

interface Overflow {
  readonly vertical: number
  readonly horizontal: number
}

interface Clip {
  readonly tag: string
  readonly hidden: number
}

function overflow(): Overflow | null {
  const content = document.querySelector('.slide-content')
  if (!content) return null

  const style = getComputedStyle(content)
  const box = content.getBoundingClientRect()
  const top = box.top + parseFloat(style.paddingTop)
  const bottom = box.bottom - parseFloat(style.paddingBottom)
  const left = box.left + parseFloat(style.paddingLeft)
  const right = box.right - parseFloat(style.paddingRight)

  let childTop = Infinity
  let childBottom = -Infinity
  let childLeft = Infinity
  let childRight = -Infinity

  for (const child of content.children) {
    const rect = child.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    childTop = Math.min(childTop, rect.top)
    childBottom = Math.max(childBottom, rect.bottom)
    childLeft = Math.min(childLeft, rect.left)
    childRight = Math.max(childRight, rect.right)
  }
  if (childBottom === -Infinity) return null

  return {
    vertical: Math.round(Math.max(0, top - childTop) + Math.max(0, childBottom - bottom)),
    horizontal: Math.round(Math.max(0, left - childLeft) + Math.max(0, childRight - right)),
  }
}

/**
 * Anything shorter than its own content. Vertical only — a `pre` scrolling
 * sideways past a long line is the theme working as intended.
 */
function clipped(): Clip[] {
  const found: Clip[] = []
  const content = document.querySelector('.slide-content')
  if (!content) return found

  for (const element of content.querySelectorAll('*')) {
    if (element.clientHeight === 0) continue
    // Only an element that clips can lose anything, and `scrollHeight` rounds
    // up — without this a heading fully on screen reports a stray pixel or two.
    // `pre` still qualifies: `overflow-x: auto` makes this axis `auto` too.
    if (getComputedStyle(element).overflowY === 'visible') continue

    const hidden = element.scrollHeight - element.clientHeight
    if (hidden > TOLERANCE) found.push({ tag: element.tagName.toLowerCase(), hidden: Math.round(hidden) })
  }
  return found
}

function describe(amount: Overflow | null, clips: readonly Clip[]): string[] {
  const parts: string[] = []
  if (amount && amount.vertical > 0) parts.push(`${amount.vertical}px too tall`)
  if (amount && amount.horizontal > 0) parts.push(`${amount.horizontal}px too wide`)
  for (const clip of clips) parts.push(`<${clip.tag}> clipped by ${clip.hidden}px`)
  return parts
}

function badge(text: string): void {
  const element = document.createElement('div')
  element.textContent = text
  element.style.cssText = [
    'position:fixed',
    'left:12px',
    'bottom:12px',
    'z-index:2147483647',
    'padding:6px 10px',
    'border-radius:6px',
    'pointer-events:none',
    'font:500 12px/1.2 ui-monospace,monospace',
    'color:#2a1600',
    'background:#f0b429',
    'box-shadow:0 2px 8px rgb(0 0 0 / 0.35)',
  ].join(';')
  document.body.append(element)
}

/**
 * Fonts change every measurement on the slide, and the two frames after them
 * are for the layout they cause. A hidden tab runs no frames at all, so wait
 * to be looked at first — otherwise the check simply never completes.
 */
async function settled(): Promise<void> {
  await document.fonts.ready
  if (document.visibilityState === 'hidden') {
    await new Promise<void>((resolve) => {
      document.addEventListener('visibilitychange', () => resolve(), { once: true })
    })
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

async function check(): Promise<void> {
  await settled()

  const amount = overflow()
  const clips = clipped()
  const parts = describe(amount, clips)
  if (parts.length === 0) return

  const slide = document.body.dataset.slide
  console.warn(
    `[slide] slide ${slide} loses content to the frame: ${parts.join(', ')}.` +
      ' What is cut off is invisible in the build.',
  )
  badge(`slide ${slide} · ${parts.join(', ')}`)

  void fetch(__SLIDE_REPORT_URL__, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck: document.body.dataset.deck,
      slide: Number(slide),
      vertical: amount?.vertical ?? 0,
      horizontal: amount?.horizontal ?? 0,
      clipped: clips,
    }),
  }).catch(() => {})
}

// A prerendered page is not being looked at, and its layout can still change.
if (document.prerendering) {
  document.addEventListener('prerenderingchange', () => void check(), { once: true })
} else {
  void check()
}

export {}
