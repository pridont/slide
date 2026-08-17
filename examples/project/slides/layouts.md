---
title: Every layout
description: What each layout looks like, and how a slide asks for one
layout: cover
---

# Every layout

## `layout:` in frontmatter picks one

<!-- Page through this deck to see each of them. The frontmatter above every slide is what selects it. -->

---
layout: section
---

## A change of subject

---

#### Divider

## That was `section`

A heading, centred, with a rule under it. Nothing else belongs on the slide —
it is punctuation between parts of a talk, not a place to put content.

```yaml
layout: section
```

---
layout: center
---

## One thing, in the middle

`layout: center`

---
layout: quote
---

> A deck is a website that happens to be shaped like slides.

The requirements, more or less

---

#### Quote

## What `quote` does

The blockquote is the slide, so it loses the usual quote decoration and gets
the accent marks instead. Whatever follows it becomes the attribution.

---
layout: two-cols
---

#### Two columns

## Split at `::: right`

Everything before the splitter stays in this column.

```md
## Left

::: right

## Right
```

::: right

#### And here

## The other side

No closing fence is needed: an unterminated container runs to the end of the
slide, which is exactly what a splitter is.

Close it with `:::` and the slide carries on in the first column.

---
layout: image-right
image: ../assets/dusk.svg
imageAlt: A dusk gradient
---

#### Picture

## `image-right`

The image comes from `image:` in frontmatter and goes through the asset
pipeline like any other reference. It bleeds to the edge of the frame; the
padding is on this side only.

---
layout: image-left
image: ../assets/dusk.svg
imageAlt: A dusk gradient
---

#### Picture

## `image-left`

The same, mirrored. Forget the `image:` and the build says so rather than
leaving half a slide empty.

---
layout: full-image
background: ../assets/dusk.svg
---

# `full-image`

The picture is an ordinary `background:`. What the layout adds is the scrim
that keeps words readable over a photograph nobody chose for its contrast.

---
layout: card
---

# A layout of my own

`layouts: ./layouts` in the project config makes every `<name>.html` in that
directory a layout. This slide is `card.html`, and the panel it draws is
styled in `theme.css` — listed as `css:` in the same config, because a
template is raw HTML with nowhere else to put its own CSS.

---

#### Escape hatch

## What a template gets

```html
<div class="slide-content">
  {{content}}
  <img src="{{image}}" alt="{{alt}}" />
  <div>{{right}}</div>
</div>
```

The `<main>` around it stays ours, so backgrounds, the aspect ratio and
`class:` keep working whatever the template does. A placeholder that is not a
thing a slide has is an error, not an empty space.
