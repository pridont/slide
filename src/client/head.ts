/**
 * The one script that cannot wait for the module graph. Two jobs, both of
 * which must be listening before the first render opportunity — which a module
 * script cannot promise, since it waits on its imports.
 *
 * 1. Marks the transition direction, from the slide numbers in the two URLs,
 *    so browser back and forward animate correctly too.
 *
 * 2. Silences the AbortError a skipped transition rejects with. Skipping is
 *    routine — reduced motion, a backgrounded tab, a typed URL, a second
 *    navigation — but the rejection reaches the author's console looking like
 *    a bug in their deck. Catching the promise is not enough, and it took a
 *    browser to find out why: `pageswap` exposes the outgoing document's
 *    transition, `pagereveal` exposes none, and it is the incoming document's
 *    own transition that rejects. With nothing to attach a handler to, the
 *    rejection is intercepted where it surfaces, matched on this error alone.
 *
 * Served as an external, parser-blocking classic script: a strict `script-src`
 * blocks inline scripts, and a hash would burden whoever deploys the deck.
 */

/** Slide 1 lives at the deck root, so a URL with no number on the end is 1. */
function slideNumber(url: string): number {
  const path = new URL(url, location.href).pathname.replace(/\/+$/, '')
  const index = Number(path.slice(path.lastIndexOf('/') + 1))
  return Number.isInteger(index) && index > 0 ? index : 1
}

function markDirection(activation: SlideNavigationActivation | null | undefined): void {
  if (!activation?.from) return
  const back = slideNumber(activation.entry.url) < slideNumber(activation.from.url)
  document.documentElement.dataset.nav = back ? 'back' : 'forward'
}

function silence(transition: SlideViewTransition | null | undefined): void {
  transition?.ready?.catch(() => {})
  transition?.finished?.catch(() => {})
}

addEventListener('pageswap', (event) => {
  silence(event.viewTransition)
  markDirection(event.activation)
})

addEventListener('pagereveal', (event) => {
  silence(event.viewTransition)
  markDirection(window.navigation?.activation)
})

addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { name?: string; message?: string } | null
  if (reason?.name === 'AbortError' && /transition was skipped/i.test(String(reason.message))) {
    event.preventDefault()
  }
})

export {}
