---
title: Projects
description: Several decks in one repository, sharing one runtime, one stylesheet and an index page.
---

## Point the CLI at a directory

```sh
slide build talks/
```

Every deck in it is built together, sharing one runtime and one stylesheet,
with an index page listing them:

```
talks/
  slide.config.ts
  theme.css
  layouts/
    card.html
  slides/
    intro.md              ->  /intro/
    2026/
      view-transitions.md ->  /2026/view-transitions/
```

## Which files are decks

A `slides/` directory, when there is one, is the authoritative answer and is
walked recursively. Without one, only top-level markdown counts — so a `notes/`
folder, a `README.md` or a directory of drafts never quietly joins the build.

A deck's URL is its path under `slides/`, minus the extension. `slug:` in a
deck's frontmatter overrides that.

## The config

`slide.config.ts` is optional. Without one, every markdown file under `slides/`
becomes a deck and the index is titled "Slides".

```ts
import type { ProjectConfig } from 'slide'

export default {
  title: 'Talks',
  description: 'Shown on the index page',

  // Defaults for every deck; a deck's own frontmatter wins.
  aspectRatio: '16/9',
  colorScheme: 'dark',
  theme: { colorAccent: '#e6a878' },
  fonts: { Inter: './fonts/inter.woff2' },

  // Order on the index page. Naming a deck here does not move its URL.
  decks: ['slides/intro.md', 'slides/2026/view-transitions.md'],

  // Stylesheets loaded after the theme.
  css: './theme.css',

  // Each <name>.html here becomes a layout a slide can ask for.
  layouts: './layouts',

  base: '/',
  outDir: 'dist',

  // Sizes in kB the build should complain past. 0 turns a check off.
  budget: { page: 100, asset: 1000 },
} satisfies ProjectConfig
```

`slide.config.ts`, `.mts`, `.js`, `.mjs` and `.json` all work. TypeScript needs
no build step of its own — the config is loaded through Vite, which compiles it
on the way in.

### Every key

| Key | Type | What it does |
| --- | --- | --- |
| `title` | string | the index page's heading, and its document title |
| `description` | string | the index page's standfirst |
| `base` | string | public base path; `--base` on the command line wins |
| `outDir` | string | where the build is written; `--out` wins |
| `decks` | string[] | the decks, in index order. Replaces discovery entirely |
| `colorScheme` | `dark` or `light` | default for every deck |
| `aspectRatio` | string | default for every deck |
| `theme` | object | project-wide [tokens](./theming.md), merged token by token under a deck's own |
| `fonts` | object | [webfaces](./theming.md#fonts) every deck may use |
| `layouts` | string | directory of [layout templates](./layouts.md#layouts-of-your-own) |
| `css` | string or string[] | stylesheets loaded after the theme |
| `budget` | `{ page, asset }` | sizes in kB the build complains past; `0` turns a check off |

### How defaults merge

A deck's frontmatter wins over the project, key by key, and `theme:` merges
token by token — so a deck can change the accent without restating the palette:

```ts
// slide.config.ts
theme: { colorAccent: '#e6a878', fontHeading: 'Inter, sans-serif' }
```

```yaml
---
# slides/intro.md — keeps the heading font, changes the accent
theme:
  colorAccent: '#79c6cf'
---
```

## The index page

One card per deck: its `title`, its `description`, and a link to its first
slide. `decks:` in the config sets the order; without it they are listed in
filename order.

The index is a page built by the same renderer as the slides, so moving from it
into a deck is the same navigation, with the same transition.

## What it saves

Decks in a project share one runtime chunk and one stylesheet, both hashed. Two
decks or twenty, a visitor downloads them once — which is the point of building
them together rather than one at a time into separate directories.

[The project demo](/talks/) is four decks built this way, with a custom layout
and a page of diagrams.
