/**
 * The parts of the platform these scripts use that TypeScript's DOM library
 * does not describe yet: cross-document view transitions, the Navigation API's
 * activation, and prerendering.
 */

interface SlideViewTransition {
  readonly ready?: Promise<void>
  readonly finished?: Promise<void>
}

interface SlideNavigationEntry {
  readonly url: string
}

interface SlideNavigationActivation {
  readonly entry: SlideNavigationEntry
  readonly from: SlideNavigationEntry | null
}

interface SlidePageSwapEvent extends Event {
  readonly viewTransition: SlideViewTransition | null
  readonly activation: SlideNavigationActivation | null
}

interface SlidePageRevealEvent extends Event {
  readonly viewTransition: SlideViewTransition | null
}

interface WindowEventMap {
  pageswap: SlidePageSwapEvent
  pagereveal: SlidePageRevealEvent
}

interface Window {
  readonly navigation?: { readonly activation?: SlideNavigationActivation | null }
}

interface Document {
  /** True while the page is being prerendered and nobody is looking at it. */
  readonly prerendering?: boolean
}
