import { openChannel } from './channel.js'

/**
 * The presenter window: two iframes of the real slide pages, the notes, and
 * the clocks.
 *
 * The slide it is showing is state held here rather than in the URL, because
 * the presenter page never navigates — moving a slide swaps the frames and
 * tells the audience over the channel. The audience does navigate, and says
 * where it landed, which is how the two stay together when the presenter is
 * not the one driving.
 */
interface SlideRef {
  readonly index: number
  readonly url: string
  readonly notes: string
}

export function startPresenter(): void {
  const body = document.body
  const deck = body.dataset.deck ?? 'deck'
  const slides = readSlides()
  if (slides.length === 0) return

  const current = frame('current')
  const next = frame('next')
  const notes = role('notes')
  const position = role('index')

  let index = 1
  // The window may open in the middle of a talk, so the first thing it hears
  // from a slide tab moves it there. After that it is the one driving.
  let adopting = true

  function show(to: number, tell: boolean): void {
    const slide = slides[to - 1]
    if (!slide) return

    index = to
    if (current) current.src = preview(slide.url, 'current')
    if (next) next.src = slides[to] ? preview(slides[to].url, 'next') : 'about:blank'
    if (notes) notes.innerHTML = slide.notes || '<p class="presenter-empty">No notes for this slide.</p>'
    if (position) position.textContent = String(to)

    if (tell) {
      adopting = false
      channel.post({ t: 'goto', slide: to, url: slide.url })
    }
  }

  const channel = openChannel(deck, (message) => {
    if (message.t === 'ask') {
      const slide = slides[index - 1]
      if (slide) channel.post({ t: 'here', slide: index, url: slide.url, role: 'presenter' })
      return
    }
    // A `goto` is someone pressing a key on the audience window, which the
    // presenter should follow. A `here` is only ever an answer, and answers
    // are for the window that just opened — this one, and only until it moves.
    if (message.t === 'here' && !adopting) return
    if (message.slide !== index) show(message.slide, false)
  })

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const step = keyStep(event.key)
    if (step === 0) return

    event.preventDefault()
    if (step === Number.NEGATIVE_INFINITY) show(1, true)
    else if (step === Number.POSITIVE_INFINITY) show(slides.length, true)
    else show(Math.min(slides.length, Math.max(1, index + step)), true)
  })

  body.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement | null)?.closest('[data-action]')?.getAttribute('data-action')
    if (action === 'prev') show(Math.max(1, index - 1), true)
    else if (action === 'next') show(Math.min(slides.length, index + 1), true)
  })

  clocks()
  show(1, false)
  // The deck may already be open somewhere; if so, the answer moves us there.
  channel.post({ t: 'ask' })
}

/** The deck as the page carries it: one article per slide, URL and notes. */
function readSlides(): SlideRef[] {
  const template = document.querySelector<HTMLTemplateElement>('template[data-role="slides"]')
  if (!template) return []

  return [...template.content.querySelectorAll('article[data-slide]')].map((article) => ({
    index: Number(article.getAttribute('data-slide')),
    url: article.getAttribute('data-url') ?? '',
    notes: article.innerHTML.trim(),
  }))
}

/**
 * How the runtime in the frame knows to keep to itself — and which of the two
 * frames it is in. The current slide is live, embeds and all, because that is
 * the point of previewing the real page; the next one is a thumbnail, and its
 * demos can wait until the presenter gets there.
 */
function preview(url: string, which: 'current' | 'next'): string {
  return `${url}${url.includes('?') ? '&' : '?'}preview=${which}`
}

function keyStep(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Enter')
    return 1
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace') return -1
  if (key === 'Home') return Number.NEGATIVE_INFINITY
  if (key === 'End') return Number.POSITIVE_INFINITY
  return 0
}

/**
 * Elapsed time and the wall clock. The elapsed timer starts paused — a talk
 * has a moment between opening the window and starting — and both it and the
 * start time survive a reload of the presenter window.
 */
function clocks(): void {
  const elapsed = role('elapsed')
  const clock = role('clock')

  const read = (key: string): number | null => {
    const value = sessionStorage.getItem(`slide:${key}`)
    return value === null ? null : Number(value)
  }

  let started = read('started')
  let held = read('held') ?? 0

  const tick = (): void => {
    const seconds = Math.floor((held + (started === null ? 0 : Date.now() - started)) / 1000)
    if (elapsed) {
      elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      elapsed.classList.toggle('is-running', started !== null)
    }
    if (clock) {
      clock.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
  }

  const save = (): void => {
    if (started === null) sessionStorage.removeItem('slide:started')
    else sessionStorage.setItem('slide:started', String(started))
    sessionStorage.setItem('slide:held', String(held))
  }

  document.body.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement | null)?.closest('[data-action]')?.getAttribute('data-action')
    if (action === 'timer') {
      if (started === null) started = Date.now()
      else {
        held += Date.now() - started
        started = null
      }
      save()
      tick()
    } else if (action === 'reset') {
      started = null
      held = 0
      save()
      tick()
    }
  })

  tick()
  setInterval(tick, 1000)
}

function frame(name: string): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(`iframe[data-role="${name}"]`)
}

function role(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-role="${name}"]`)
}
