---
title: Layouts
description: Eight built-in arrangements, and how to add one of your own as a file of HTML.
---

## Asking for one

```md
---
layout: two-cols
---
```

Without a `layout:` key a slide is `default`. An unknown name is an error that
lists the ones that exist, including any of your own.

## The built-in eight

| Layout | For |
| --- | --- |
| `default` | anything |
| `cover` | a title slide — centred, larger, usually over a background |
| `center` | one thing, in the middle |
| `section` | a divider between parts of a talk |
| `quote` | a pull quote, with whatever follows as the attribution |
| `two-cols` | two columns, split at `::: right` |
| `image-left` / `image-right` | a picture on one side, bleeding to the frame |
| `full-image` | words over the slide's `background:` image, with a scrim |

[The example deck](/demo/) is every one of them, in order, if you would rather
look than read.

### cover

```md
---
title: A talk
layout: cover
background: ./assets/dusk.svg
---

# A talk

## With a subtitle
```

Deck frontmatter is also the first slide's, which is why a cover usually needs
no separator of its own.

### two-cols

Everything before `::: right` is the first column, the region is the second. A
slide that never splits still reads as one column.

```md
---
layout: two-cols
---

## Left

::: right

## Right
```

### image-left and image-right

These are built around a picture named in frontmatter, not one in the body:

```md
---
layout: image-right
image: ./assets/pipeline.svg
imageAlt: How a deck is built
---

## The build

Prose on the other side.
```

The image bleeds to the frame. A slide asking for one of these layouts without
an `image:` is an error saying so — an empty half-slide is not a useful thing
to discover from the back of a room.

### full-image

The picture is the slide's `background:`, and the layout is the part that makes
text on top of it readable:

```md
---
layout: full-image
background: ./assets/dusk.svg
---

# Over the top
```

### quote

```md
---
layout: quote
---

> Everything should be made as simple as possible, but no simpler.

Attributed to Einstein, probably wrongly
```

The blockquote does the talking; whatever follows it is the attribution.

## Layouts of your own

A project can name a directory of templates, and every `<name>.html` in it
becomes a layout a slide can ask for:

```ts
export default {
  layouts: './layouts',
} satisfies ProjectConfig
```

```
talks/
  layouts/
    card.html      ->  layout: card
```

A template fills in `{{content}}`, `{{image}}`, `{{alt}}`, and any region by
name — `{{right}}` for what follows `::: right`:

```html
<div class="slide-content card">
  <div class="card__panel">{{content}}</div>
</div>
```

The template supplies the inside of the slide; the `<main>` around it stays the
tool's, so backgrounds, the aspect ratio and `class:` keep working whatever the
template does.

A placeholder that is not something a slide has is an error listing what is
available, rather than an empty space: a typo that silently renders nothing is
a slide gone missing.

### Styling one

Style it from a stylesheet listed in `css:`:

```ts
export default {
  layouts: './layouts',
  css: './theme.css',
} satisfies ProjectConfig
```

```css
.card__panel {
  padding: 4cqw;
  border-radius: var(--slide-radius-panel);
  background: var(--slide-color-panel);
}
```

Two rules worth keeping:

- **Size in `cqw`, not pixels.** Everything is measured against the slide's own
  size container, which is what lets a deck look identical on a laptop and a
  projector. A pixel value is the one thing that breaks that.
- **No inline `style` attribute.** A template is raw HTML, and an inline style
  is the one thing a strict Content-Security-Policy blocks. See
  [Deploying](./deploying.md#content-security-policy).

Custom layouts are a project feature, because they need somewhere to live —
see [Projects](./projects.md).
