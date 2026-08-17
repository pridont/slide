---
title: Presenting
description: The keys, the presenter window, and two browser windows that follow each other without a server.
---

## Keys

| Key | Does |
| --- | --- |
| <kbd>→</kbd> <kbd>↓</kbd> <kbd>space</kbd> <kbd>page down</kbd> <kbd>enter</kbd> | next slide |
| <kbd>←</kbd> <kbd>↑</kbd> <kbd>page up</kbd> <kbd>backspace</kbd> | previous slide |
| <kbd>home</kbd> <kbd>end</kbd> | first, last |
| <kbd>f</kbd> | fullscreen |
| <kbd>p</kbd> | presenter window |

Keys are ignored while you are typing in a field, so an embedded demo with an
input in it does not lose keystrokes to the deck.

On a touch screen, tapping the right two thirds advances and the left third
goes back. On a mouse it does not, because click-to-advance fights with
selecting text.

## The presenter window

<kbd>p</kbd> opens `/<deck>/presenter/`:

- the current slide
- the next one
- your [speaker notes](./writing.md#speaker-notes)
- an elapsed timer, which starts when you click it
- the wall clock

Both frames are the real slide pages, so what you rehearse against is what the
room sees. There is no second renderer to drift.

### How the two windows stay together

Over a `BroadcastChannel` — a browser API, no server involved. Drive from
either window and the other follows. A window that joins late asks for the
current position and catches up on its own, without dragging the window that
was already there back to the start.

The preview frames stay quiet: they do not run their own navigation, do not
fire transitions, and do not load embeds. Only the window you are driving does.

## A deck is a URL

Every slide is its own page, so slide 12 is `/talk/12/`. That means the browser
back button walks the talk backwards, a link in your notes can point at the
slide it is about, and reloading mid-talk puts you exactly where you were.

If you present from a second machine, the deck is a static site — put it
[online](./deploying.md) and open the URL.

## Fullscreen

<kbd>f</kbd> asks the browser for fullscreen. The deck is letterboxed to its
`aspectRatio` inside whatever it gets, so a 16/9 deck on a 16/10 projector
keeps its shape rather than stretching.

## Try it

Open [the demo deck](/demo/), press <kbd>p</kbd>, and drive it from either
window.
