---
title: slide
nav: Overview
description: A markdown file in, a static slideshow out. Every slide is its own page, its own URL, and prerendered before you get there.
---

<div class="buttons">
  <a class="button button--primary" href="./install.md">Install</a>
  <a class="button" href="./quickstart.md">Write your first deck</a>
  <a class="button" href="/demo/">See a built deck</a>
</div>

```sh
slide init talk.md      # a deck to start from
slide dev talk.md       # edit it, with live reload
slide build talk.md     # write a static site to dist/
```

## What it does

A deck is one markdown file. A line of exactly `---` starts the next slide. The
build turns each slide into a real HTML page with its own URL, moving between
them is a real browser navigation, and the next slide is already prerendered
when you get there.

There is no client-side router, no framework, and nothing to boot: a built deck
is HTML, one shared script and one shared stylesheet — three requests and
6.0 kB over the wire, first slide included, whatever the length of the deck.
`pnpm measure` is where that number comes from, and CI fails if it stops being
true.

<ul class="cards">
  <li>
    <strong>One page per slide</strong>
    <p>Every slide has a URL you can link to, open in a new tab, and land on directly.</p>
  </li>
  <li>
    <strong>Nothing to boot</strong>
    <p>No framework and no hydration. The first frame is the finished slide.</p>
  </li>
  <li>
    <strong>Diagrams without the payload</strong>
    <p>Mermaid fences are drawn at build time and inlined as SVG. Nothing about mermaid reaches the browser.</p>
  </li>
  <li>
    <strong>A presenter view that is the deck</strong>
    <p>Notes, a timer and the next slide, in real slide pages, synced over a BroadcastChannel.</p>
  </li>
</ul>

## What a deck looks like

```md
---
title: A talk
layout: cover
---

# A talk

## With a subtitle

<!-- Only the presenter sees this note. -->

---
layout: two-cols
---

## Left

::: right

## Right
```

That is a two-slide deck: a cover, and a slide split into columns. `slide build
talk.md` writes it to `dist/`, ready for any static host.

## Where to go next

| If you want to | Read |
| --- | --- |
| Get the CLI on your machine | [Installation](./install.md) |
| Go from nothing to a built deck | [Your first deck](./quickstart.md) |
| Know exactly what the markdown means | [Writing a deck](./writing.md) |
| Change how it looks | [Theming](./theming.md) |
| Build several decks together | [Projects](./projects.md) |
| Put it online | [Deploying](./deploying.md) |

## Live demos

Both are built by `slide` itself, by the same workflow that builds this site.

- [The example deck](/demo/) — layouts, embeds, images, speaker notes
- [A project of several decks](/talks/) — a shared theme, custom layouts, diagrams

## Browser support

Chrome gets cross-document view transitions and prerendering. Everywhere else
navigates plainly: no animation, nothing broken, same URLs. Nothing about a deck
depends on either.
