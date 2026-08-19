---
title: Embeds
description: An interactive piece as its own little web page, sandboxed, and idle until the slide is reached.
---

## The syntax

```md
::: iframe {src=./demo/ aspect=16:9}
An optional caption.
:::
```

`src` is a file or a directory. A directory is served from its `index.html`,
which is what lets an embed have its own stylesheet and scripts; it is copied
whole, so the relative links inside it keep working.

## Keys

| Key | Value |
| --- | --- |
| `src` | a file or a directory, relative to the markdown — the one required key |
| `title` | the iframe's accessible name |
| `aspect` | `fill`, `16/9`, `4/3`, `3/2`, `1/1` — colons work too (`16:9`) |
| `height` | a height in pixels, instead of an aspect ratio |
| `sandbox` | extra permissions, or `off` |
| `loading` | `lazy` or `eager` |

With neither `aspect` nor `height`, an embed fills whatever height the slide
has left, which is usually what a slide wants. A ratio has to be one of the
listed ones: a free-form ratio would mean an inline `style` attribute or a rule
generated per embed, and the deck's stylesheet is written before the pages that
would need describing.

## What it does for you

**Sandboxed by default.** An embed runs with `allow-scripts` and nothing else.
Widen it when the thing inside genuinely needs more:

```md
::: iframe {src=./form/ sandbox="allow-scripts allow-forms"}
:::
```

`sandbox=off` removes the attribute entirely. That is the same trust level as
pasting the code into the slide itself, so it is spelled out rather than
implied.

**Idle until reached.** An embed stays empty until its slide is actually
navigated to. Slides are prerendered, and a demo that starts running two slides
early — playing audio, hitting the network, burning battery — is not a demo you
want prerendered.

## Embeds and a Content-Security-Policy

An embed is its own document, and it is served from your host like every other
file, so it inherits whatever policy that host sets. Under the strict one
[Deploying](./deploying.md#content-security-policy) suggests, a `<style>` block
or a `<script>` written inline in an embed is blocked — the slide around it
still renders, and the embed comes up unstyled and inert.

Nothing the build emits has this problem; an embed is your HTML, not the
tool's. Keeping its CSS and JS in files beside it is what a directory embed is
for, and it is how `examples/embeds/easing/` is written:

```
easing/
  index.html      <link rel=stylesheet href=./style.css>, <script src=./main.js>
  style.css
  main.js
```

## A directory embed

```
talk.md
demo/
  index.html
  demo.css
  demo.js
```

```md
::: iframe {src=./demo/ aspect=16/9}
Drag the handle to change the easing curve.
:::
```

The whole directory is copied to `embeds/<name>-<hash>/` in the output and
served from there. Everything inside it keeps its relative paths.

## A single file

```md
::: iframe {src=./easing.html height=420}
:::
```

One file goes through the asset pipeline like an image: hashed, copied, and
referenced by its hashed URL.

## Captions

Anything between the opening line and the closing `:::` is the caption, and it
is rendered as markdown:

```md
::: iframe {src=./demo/}
Built with **the same tokens** as the deck.
:::
```

## Errors

A missing `src`, an unknown key, a key set twice, a ratio that is not one of
the listed ones, a `height` that is not a number, a sandbox token that is not
an `allow-…`, or a `loading` that is neither `lazy` nor `eager` — each is an
error naming the file and the line it came from:

```
talk.md:31  unknown embed aspect "21/9". Valid: fill, 16-9, 4-3, 3-2, 1-1,
            or leave it out and the embed fills the space the slide has left.
```
