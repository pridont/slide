/**
 * Browser runtime — one chunk, shared by every page of every deck.
 *
 * Navigation is a real document navigation (`location.href`) on purpose: only
 * those fire cross-document view transitions, and the prerendered next page
 * only pays off if we navigate to it. Anything that cannot wait for the module
 * graph lives in the head script instead.
 */
import '../theme/base.css'
import { openChannel } from './channel.js'
import { startPresenter } from './presenter.js'

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'])
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'])

function target(name: 'prev' | 'next' | 'first' | 'last'): string | null {
  return document.body.dataset[name] ?? null
}

let announce: ((slide: number, url: string) => void) | undefined

/**
 * Every deliberate move is announced before it happens, because the tab that
 * makes it is about to be replaced by a new document — a slide is a page, and
 * this one will not be around to say where it went.
 */
function go(href: string | null): void {
  if (!href) return
  announce?.(slideNumber(href), href)
  location.href = href
}

/** The number in the URL; slide 1 sits at the deck root and has none. */
function slideNumber(href: string): number {
  const path = new URL(href, location.href).pathname.replace(/\/+$/, '')
  const index = Number(path.slice(path.lastIndexOf('/') + 1))
  return Number.isInteger(index) && index > 0 ? index : 1
}

function isTypingTarget(node: EventTarget | null): boolean {
  const element = node as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (element.isContentEditable) return true
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  if (isTypingTarget(event.target)) return

  if (NEXT_KEYS.has(event.key)) {
    event.preventDefault()
    go(target('next'))
  } else if (PREV_KEYS.has(event.key)) {
    event.preventDefault()
    go(target('prev'))
  } else if (event.key === 'Home') {
    event.preventDefault()
    go(target('first'))
  } else if (event.key === 'End') {
    event.preventDefault()
    go(target('last'))
  } else if (event.key === 'f') {
    event.preventDefault()
    void toggleFullscreen()
  } else if (event.key === 'p') {
    event.preventDefault()
    openPresenter()
  }
}

/**
 * A window of its own, not a tab: a presenter view belongs on the other
 * screen. Opened from a key press, so no popup blocker minds.
 */
function openPresenter(): void {
  const href = document.body.dataset.presenter
  if (href) window.open(href, 'slide-presenter', 'noopener,width=1280,height=800')
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    // Denied by the browser (no user gesture, or policy). Nothing to do.
  }
}

/** Coarse pointers only: on a mouse this fights text selection and links. */
function onPointerNavigation(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return
  if ((event.target as HTMLElement | null)?.closest('a, button, input, iframe, [data-no-nav]')) return
  go(event.clientX < window.innerWidth / 3 ? target('prev') : target('next'))
}

/**
 * Preloading for browsers without speculation rules. In script rather than in
 * the markup, so browsers that do prerender are not made to fetch twice.
 */
function addPrefetchFallback(): void {
  const scripts = HTMLScriptElement as unknown as { supports?: (type: string) => boolean }
  if (scripts.supports?.('speculationrules')) return

  for (const name of ['prev', 'next'] as const) {
    const href = target(name)
    if (!href) continue
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.href = href
    document.head.append(link)
  }
}

/**
 * Embeds carry their URL as data until the page is activated. A prerendered
 * slide would otherwise run someone's demo — timers, audio, whatever it does —
 * for a slide the presenter has not reached.
 */
function startEmbeds(): void {
  for (const frame of document.querySelectorAll('iframe[data-embed-src]')) {
    const src = frame.getAttribute('data-embed-src')
    if (src) frame.setAttribute('src', src)
  }
}

/**
 * Follows whoever is driving, and answers a tab that has just arrived.
 *
 * A slide is a document, so this is rebuilt on every navigation and keeps no
 * state of its own. On load it asks rather than announces: announcing would
 * tell a presenter window that the audience had moved, when all that happened
 * is that this page reloaded where it already was.
 */
function joinDeck(): void {
  const deck = document.body.dataset.deck
  if (!deck) return

  const here = { slide: Number(document.body.dataset.slide ?? '1'), url: location.pathname }
  let told = false

  const channel = openChannel(deck, (message) => {
    if (message.t === 'ask') {
      channel.post({ t: 'here', ...here, role: 'audience' })
      return
    }
    // Two answers can arrive — another slide tab and the presenter. The
    // presenter is the one to believe.
    if (message.t === 'here' && (told || message.role !== 'presenter')) return
    if (message.t === 'here') told = true
    if (message.slide !== here.slide) location.href = message.url
  })

  announce = (slide, url) => channel.post({ t: 'goto', slide, url })
  channel.post({ t: 'ask' })
}

function activate(): void {
  startEmbeds()
  document.addEventListener('keydown', onKeyDown)
  if (window.matchMedia('(pointer: coarse)').matches) {
    document.addEventListener('click', onPointerNavigation)
  }
  addPrefetchFallback()
  joinDeck()
}

/**
 * A prerendered page runs its scripts before anyone is looking at it — holding
 * off keeps timers, and later the presenter channel, from firing early.
 */
function whenActive(run: () => void): void {
  const doc = document as Document & { prerendering?: boolean }
  if (doc.prerendering) {
    document.addEventListener('prerenderingchange', run, { once: true })
  } else {
    run()
  }
}

// Transition direction and the skipped-transition guard are in the head
// script, which is listening before the first render.
const preview = new URLSearchParams(location.search).get('preview')

if (document.body.dataset.role === 'presenter') {
  // The presenter window drives; it never navigates, so none of the slide
  // behaviour above applies to it.
  whenActive(startPresenter)
} else if (preview === null) {
  whenActive(activate)
} else if (preview !== 'next') {
  // A slide inside the presenter's own window: no keys, no channel, nothing
  // announced. Its embeds do start, though — the presenter is looking at the
  // slide it is on, and an empty frame is not what the room will see. The
  // next-slide thumbnail is the one case that stays still.
  whenActive(startEmbeds)
}
