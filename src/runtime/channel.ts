/**
 * The link between the presenter's window and the audience's.
 *
 * `BroadcastChannel` when there is one, `localStorage` otherwise — a `storage`
 * event fires in every *other* tab of the origin, which is the same shape of
 * delivery, so the fallback needs no separate protocol.
 *
 * Every message carries who sent it and a counter, because an audience tab is
 * a new document on every slide: it cannot remember what it has already seen,
 * and two tabs answering each other is a loop nobody wants during a talk.
 */
export type Outgoing =
  /** A deliberate move — someone pressed a key or clicked. Everyone follows. */
  | { readonly t: 'goto'; readonly slide: number; readonly url: string }
  /** A tab that just loaded, asking where everyone else is. */
  | { readonly t: 'ask' }
  /**
   * An answer to `ask`. The role matters: a slide tab announcing itself must
   * not drag a presenter backwards, and a late joiner told two different
   * things should believe the presenter.
   */
  | {
      readonly t: 'here'
      readonly slide: number
      readonly url: string
      readonly role: 'presenter' | 'audience'
    }

/** Who sent it, and their counter — see the note above about loops. */
export type Message = Outgoing & { readonly from: string; readonly n: number }

export interface Channel {
  post: (message: Outgoing) => void
  close: () => void
}

/** Survives navigation, so the counter keeps climbing across slides. */
const SEQ_KEY = 'slide:seq'

export function openChannel(deck: string, onMessage: (message: Message) => void): Channel {
  const name = `slide:${deck}`
  const id = senderId()
  const seen = new Map<string, number>()

  const receive = (message: Message | null): void => {
    if (!message || typeof message.from !== 'string' || message.from === id) return
    // Out of order or already handled: the channel makes no promises, and a
    // late duplicate would send the audience backwards.
    const last = seen.get(message.from) ?? -1
    if (message.n <= last) return
    seen.set(message.from, message.n)
    onMessage(message)
  }

  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(name) : null
  if (channel) channel.addEventListener('message', (event) => receive(event.data as Message))

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== name || !event.newValue) return
    try {
      receive(JSON.parse(event.newValue) as Message)
    } catch {
      // Someone else's key, or a half-written value. Not ours to explain.
    }
  }
  if (!channel) window.addEventListener('storage', onStorage)

  return {
    post: (message) => {
      const full: Message = { ...message, from: id, n: nextSeq() }
      if (channel) channel.postMessage(full)
      // The write itself is the event; the value has to differ every time, and
      // `n` already does.
      else localStorage.setItem(name, JSON.stringify(full))
    },
    close: () => {
      channel?.close()
      if (!channel) window.removeEventListener('storage', onStorage)
    },
  }
}

/**
 * One id per tab, kept in session storage so it stays the same tab across the
 * navigations a deck is made of.
 */
function senderId(): string {
  const existing = sessionStorage.getItem('slide:id')
  if (existing) return existing

  const id = Math.random().toString(36).slice(2, 10)
  sessionStorage.setItem('slide:id', id)
  return id
}

function nextSeq(): number {
  const next = Number(sessionStorage.getItem(SEQ_KEY) ?? '0') + 1
  sessionStorage.setItem(SEQ_KEY, String(next))
  return next
}
