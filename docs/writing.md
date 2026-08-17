---
title: Writing a deck
description: One markdown file. Separators, frontmatter, speaker notes, and the rules that keep prose from being mistaken for either.
---

## A deck is one file

```md
# The first slide

Some prose.

---

# The second
```

A line of exactly `---`, with a blank line above it, starts the next slide.

The blank line is what keeps a setext heading — a line of text with `---`
directly under it — from becoming a slide break. Four dashes or more is a
thematic break and stays one. A `---` inside a code fence or an HTML comment is
content, never a separator.

```md
Not a slide break
---

<!--
---
Also not one.
-->
```

Everything else is ordinary markdown: headings, lists, tables, links, images,
fenced code with syntax highlighting, and raw HTML where markdown has no
syntax for what you want.

## Frontmatter

A YAML block at the top of the file configures the deck, and doubles as the
first slide's own frontmatter. A block straight after a separator configures
the slide that follows it.

```md
---
title: A talk
colorScheme: light
layout: cover
---

# A talk

---
layout: two-cols
class: theme-lilac
---

## Split in two
```

### Deck keys

| Key | What it does |
| --- | --- |
| `title` | document title, and the fallback slide title |
| `description` | `<meta name=description>`, and the text on a project's index card |
| `slug` | the deck's URL in a project; defaults to its path under `slides/` |
| `aspectRatio` | `16/9`, `4:3`, anything CSS accepts |
| `colorScheme` | `dark` or `light` |
| `theme` | design-token overrides — see [Theming](./theming.md) |
| `fonts` | font files the deck ships — see [Fonts](./theming.md#fonts) |

### Slide keys

| Key | What it does |
| --- | --- |
| `layout` | one of the [built-in layouts](./layouts.md), or one of your own |
| `class` | extra classes on the slide element, e.g. `theme-lilac` |
| `background` | a CSS colour, or an image reference |
| `image` / `imageAlt` | the picture an `image-left` / `image-right` slide is built around |
| `notes` | speaker notes, if you would rather not use a comment |

### What counts as frontmatter

A block has to be contiguous — a blank line ends it — and has to contain at
least one key that means something. That is what stops prose which happens to
look like YAML from being eaten by the parser.

A block of nothing but typos is an error with a suggestion, not a silently
ignored slide:

```
talk.md:14  unknown key "backgound". Did you mean "background"?
```

The same is true of an unknown theme token, an unknown layout and a malformed
embed. The rule throughout: a deck that does not say what you meant should say
so, on the line where you said it.

## Speaker notes

An HTML comment at the end of a slide:

```md
# A slide

<!-- Only the presenter sees this. -->
```

Or the `notes:` key, if a comment is awkward — a slide that ends in raw HTML,
say:

```md
---
notes: The number to land on is 6 kB.
---
```

Either way the note is rendered as markdown and shown in the
[presenter window](./presenting.md), never in the deck.

## Images and other files

An ordinary markdown image is a reference the build resolves, content-hashes
and copies:

```md
![The build pipeline](./assets/pipeline.svg)
```

So are `src`, `href`, `poster` and `srcset` in raw HTML, which means
hand-written markup gets the same treatment:

```html
<img src="./assets/chart.png" srcset="./assets/chart.png 1x, ./assets/chart@2x.png 2x" alt="" />
```

The tool does not resize anything — that would mean a native image dependency,
and a deck's pictures are the author's own. What it does is make every
candidate you prepare go through the pipeline.

A link straight at a file (a PDF, say) is treated as an asset too. Links to
other pages are left alone. An external link gets `target="_blank"` and
`rel="noopener noreferrer"`.

## Columns

`::: right` splits a `two-cols` slide. It needs no closing fence — an
unterminated container runs to the end of the slide — but you can close it with
`:::` and carry on in the first column:

```md
---
layout: two-cols
---

## Left

::: right

## Right
```

## Diagrams and embeds

A ` ```mermaid ` fence becomes an SVG drawn at build time; `::: iframe` embeds
a little web page of your own. Both have a page each:
[Diagrams](./diagrams.md), [Embeds](./embeds.md).
