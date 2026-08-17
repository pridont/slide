---
title: Your first deck
description: From an empty directory to a built site, in four commands.
---

## Scaffold

```sh
slide init talk.md
```

One markdown file, and nothing else. There is no config to fill in, no
stylesheet to understand and no layouts directory: a deck needs none of them,
and every extra file is one more thing to read before you can change a word.

The file it writes is a small working deck — a cover, a slide of prose, a
two-column slide, and a closing slide — which is a faster start than an empty
document.

## Edit

```sh
slide dev talk.md --open
```

The dev server renders from memory at the same URLs the build writes, through
the same renderer, so what you see cannot drift from what ships. Save the file
and the browser reloads.

It also measures each slide in the browser and tells you when one loses content
to the frame. A slide is `overflow: hidden`, so too much on it is trimmed with
no other warning — this is that warning.

## Write

Slides are separated by a line of exactly `---` with a blank line above it:

```md
---
title: A talk
layout: cover
---

# A talk

## Markdown in, a slideshow out

---

## The second slide

- Ordinary markdown
- Ordinary lists

<!-- A comment at the end of a slide is a speaker note. -->
```

Frontmatter at the top configures the whole deck *and* the first slide. A block
straight after a separator configures the slide that follows it:

```md
---
layout: two-cols
class: theme-lilac
---
```

That is most of the syntax. [Writing a deck](./writing.md) is the rest.

## Build

```sh
slide build talk.md
```

```
dist/
  index.html            slide 1
  2/index.html          slide 2…n
  presenter/index.html
  assets/runtime-<hash>.js
  assets/runtime-<hash>.css
```

Static files, no server needed. `--serve` builds and then serves the result, if
you want to check the real output before it goes anywhere:

```sh
slide build talk.md --serve --open
```

## Publish

Anything that serves files will do. For GitHub Pages, the base path is the
repository name, and the build needs to know it:

```sh
slide build talk.md --out dist --base /talk/
```

[Deploying](./deploying.md) has the workflow file, the cache headers and the
Content-Security-Policy the output is designed to pass under.

## Then

- [Layouts](./layouts.md) — covers, columns, images, quotes
- [Theming](./theming.md) — colours, type, your own fonts
- [Presenting](./presenting.md) — the keys, and the presenter window
- [Projects](./projects.md) — several decks in one repository, one shared runtime
