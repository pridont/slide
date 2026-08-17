---
title: Cross-document view transitions
description: Why every slide is its own page
colorScheme: light
layout: cover
class: theme-cyan
---

# Cross-document view transitions

## Or: why every slide is its own page

<!-- This deck sets colorScheme: light, overriding nothing — the project config leaves it alone — to show a per-deck override. -->

---
class: theme-cyan
---

#### The trade

## A page per slide

The obvious design is one page and a router. It is also the one that gives up
the browser's own transition machinery, because cross-document transitions
only fire for real navigations.

| Approach | Transition | Preloading |
| --- | --- | --- |
| One page, JS router | you animate it | you write it |
| A page per slide | `@view-transition` | speculation rules |

---
class: theme-cyan
---

#### The trade

## What it costs

Nothing is free. A page per slide means:

- Every slide pays a document parse — which prerendering hides
- State does not survive navigation, so state lives in the URL
- The runtime has to be small enough to re-execute constantly

```js
// The whole of navigation.
location.href = document.body.dataset.next
```

---
class: theme-cyan
---

#### The trade

## Light decks work too

This deck sets `colorScheme: light` in its own frontmatter. The project it
lives in says nothing about colour, and a deck's own frontmatter would win
anyway.
