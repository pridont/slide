---
title: One repository, many talks
description: How a project is laid out, and what the decks share
layout: cover
---

# Many talks, one site

## A project is a directory of decks

<!-- The index page at the root of the build lists every deck in this project. -->

---

#### Layout

## Where decks live

```
talks/
  slide.config.ts
  slides/
    intro.md            ->  /intro/
    2026/
      view-transitions.md   ->  /2026/view-transitions/
```

A `slides/` directory, when present, is the authoritative answer and is walked
recursively. Without one, top-level markdown is used instead — so a `notes/`
folder never quietly becomes part of the build.

---

#### Layout

## Slugs come from paths

The URL of a deck is its path under `slides/`, minus the extension. Nesting
survives, so a year folder gives you `/2026/view-transitions/`.

- `slug:` in a deck's frontmatter overrides it
- Two decks resolving to the same URL is an error, not a coin toss
- `decks:` in the config sets the order of the index page

---

#### Sharing

## One runtime for the whole project

Every page of every deck links the same hashed runtime chunk and the same
stylesheet. Moving between decks costs nothing that moving between slides
does not already cost.

> That is the point of keeping the talks in one repository rather than one
> repository per talk.
