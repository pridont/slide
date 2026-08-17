---
title: Diagrams
description: Mermaid fences, drawn to SVG at build time
layout: cover
---

# Diagrams

## A ```` ```mermaid ```` fence becomes a picture

<!-- Nothing about mermaid reaches the browser. Every diagram here is SVG in the page, drawn while the deck was built. -->

---

## Flowchart

```mermaid
flowchart LR
  A[markdown] --> B{fence?}
  B -->|mermaid| C[draw SVG]
  B -->|anything else| D[highlight]
  C --> E[page]
  D --> E
```

The colours are the deck's own tokens. Change `colorAccent` and the diagram
changes with it.

---
layout: two-cols
---

## Written as a fence

````markdown
```mermaid
sequenceDiagram
  participant S as Slide
  participant P as Presenter
  S->>P: hello
  P-->>S: state
```
````

Nothing else — no attributes, no configuration.

::: right

```mermaid
sequenceDiagram
  participant S as Slide
  participant P as Presenter
  S->>P: hello
  P-->>S: state
```

:::

---

## State

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Prerendering: speculation rules
  Prerendering --> Active: activation
  Active --> Transitioning: navigate
  Transitioning --> Active
```

---
layout: center
---

## Class

```mermaid
classDiagram
  class Deck {
    +string file
    +DeckMeta meta
    +Slide[] slides
  }
  class Slide {
    +number index
    +string body
  }
  Deck "1" --> "*" Slide
```

---

## What it costs the audience

```mermaid
pie showData
  title Bytes over the wire, gzipped
  "runtime JS" : 2500
  "theme CSS" : 3700
  "head script" : 425
```

Mermaid itself is not in that list, and that is the whole point: it ran at
build time. Shipping it would have added roughly 400 kB to any slide carrying
a diagram.

<!-- The build needs mermaid and playwright installed to draw these. They are optional peers — a deck without a diagram never needs either. -->
