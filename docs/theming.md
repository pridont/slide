---
title: Theming
description: Sixty design tokens, three accents, two colour schemes, and fonts of your own if the system stack will not do.
---

## Tokens

The default theme reads its values from CSS custom properties, and `theme:`
overrides any of them. Names are the properties without the `--slide-` prefix,
in either spelling — `colorAccent` and `color-accent` are the same token:

```yaml
---
colorScheme: light
theme:
  colorAccent: '#ff8800'
  fontBody: Georgia, serif
  fontSize: 2.4 # percent of the slide's width
---
```

A mistyped token is an error with a did-you-mean, so it cannot quietly do
nothing:

```
talk.md:4  unknown theme token "colorAcent". Did you mean "color-accent"?
```

### What there is

Sixty of them, in six groups:

| Group | Names | For |
| --- | --- | --- |
| Raw palette | `ink-*`, `paper-*`, `apricot-*`, `lilac-*`, `cyan-*` | the colours the semantic ones are derived from |
| Semantic colour | `color-bg`, `color-panel`, `color-fg`, `color-muted`, `color-backdrop`, `color-apricot`, `color-lilac`, `color-cyan`, `color-accent`, `color-accent-contrast`, `rule`, `rule-strong` | what the stylesheet actually reads |
| Syntax | `syn-comment`, `syn-keyword`, `syn-function`, `syn-string`, `syn-number`, `syn-class`, `syn-builtin`, `syn-property`, `syn-punct` | highlighted code |
| Type | `font-body`, `font-heading`, `font-mono`, `font-size`, `fs-*`, `lh-*`, `tracking-*` | faces, sizes, leading, tracking |
| Space | `padding`, `gap`, `radius-panel`, `radius-code`, `radius-pill` | the shape of things |
| Motion | `transition-duration`, `transition-easing` | the view transition between slides |

Overriding a *raw* token feeds every semantic one derived from it. Setting
`paper-bg` under `colorScheme: light` changes the slide background, the
scrims and everything else that reads it — which is the whole reason the rules
go on `<html>` rather than on the slide.

### Sizes are relative on purpose

`font-size` and `padding` are percentages of the slide's width; every other
size is an `em` multiple of them. Everything is expressed in `cqw` against the
slide's own size container, so a deck looks identical on a laptop and a
projector with no measuring script anywhere.

That is also the one rule a custom stylesheet has to respect: a value in pixels
is the thing that breaks it.

## Colour schemes

```yaml
---
colorScheme: light
---
```

`dark` is the default — the "aubergine dusk" ink palette. `light` puts `.light`
on `<html>` and swaps to paper, with the syntax colours re-tuned for AA
contrast against the lighter code panel rather than merely inverted.

## The three accents

The theme comes with an accent trio. A slide picks one:

```md
---
class: theme-apricot
---
```

`theme-apricot`, `theme-lilac`, `theme-cyan`. They are the same three colours
the categorical series in a [diagram](./diagrams.md) cycles through, lightened
on ink and used as-is on paper, so a slide accent and a chart never clash.

## Fonts

The theme names system faces, so a deck costs no font requests at all. To ship
your own:

```yaml
---
fonts:
  Inter: ./fonts/inter.woff2
  IBM Plex Mono:
    - src: ./fonts/plex-400.woff2
    - src: ./fonts/plex-700.woff2
      weight: 700
theme:
  fontBody: Inter, sans-serif
  fontMono: IBM Plex Mono, monospace
---
```

The files go through the asset pipeline like any other reference — hashed,
copied, referenced by their hashed URL — and the `@font-face` rules are
generated for you.

Declaring a family loads it; pointing a token at it is what uses it. The two
steps are separate so a deck can ship a face it only uses from its own CSS —
but it also means a family you declare and never name in a token is a download
nobody reads.

A per-face entry takes `src`, `weight`, `style`, `display` and `unicodeRange`.
Left out, a face is `normal`, `normal`, `swap`.

## Project-wide theming

In a [project](./projects.md), `theme:` in the config is the default for every
deck, and a deck's own frontmatter wins over it:

```ts
export default {
  theme: { colorAccent: '#e6a878' },
  css: './theme.css',
} satisfies ProjectConfig
```

`css:` names stylesheets loaded after the theme — where a
[custom layout's](./layouts.md#layouts-of-your-own) classes are styled, and
where anything the tokens do not reach can be written by hand.
