---
title: CLI reference
description: Three commands, eight options, and what each one is for.
---

## Synopsis

```
slide dev <path> [options]      edit with live reload
slide build <path> [options]    write a static site
slide init [path]               write a deck to start from
```

`<path>` is a markdown file — one deck, at the output root — or a directory
holding several, which builds a [project](./projects.md) with an index page.

## Options

| Option | Does |
| --- | --- |
| `--out <dir>` | output directory (default: `dist` next to the input) |
| `--base <path>` | public base path (default: `/`) |
| `--serve` | serve the finished build and stay running (build only) |
| `--port <n>` | port for `dev` or `--serve` |
| `--host <host>` | host, e.g. `0.0.0.0` to reach it from a phone |
| `--open` | open a browser |
| `--no-minify` | leave the bundled runtime unminified (build only) |
| `-v`, `--version` | print the version |
| `-h`, `--help` | print this |

## slide dev

```sh
slide dev talk.md --open
slide dev talks/ --host 0.0.0.0 --port 5000
```

Renders from memory at the same URLs the build writes, through the same
renderer, so a preview cannot drift from the output. Save a file and the
browser reloads.

It also measures each slide in the browser and tells you when one loses content
to the frame:

```
slide: slide 7 loses content to the frame (84px too tall). The build cuts it without a word.
```

The same warning appears in the browser console and as a badge on the slide. A
slide is `overflow: hidden`, so too much on it is trimmed with no other sign —
this is that sign, and it is the reason to draft in `dev` rather than in a text
editor alone.

`--host 0.0.0.0` is how you check a deck on a phone, or on the projector's own
machine, before the room is full.

## slide build

```sh
slide build talk.md
slide build talk.md --out public --base /talk/
slide build talks/ --serve --open
```

Writes a static site. See [what the build writes](./deploying.md#the-output).

`--base` is the public path the site will be served from. A GitHub Pages
project site lives at `/<repo>/`, so it needs `--base /<repo>/`; a custom
domain at the root does not. Getting it wrong shows up as a deck that loads
with no stylesheet.

`--serve` builds and then serves the result — the real output, as static files,
which is the last check before it goes anywhere.

`--no-minify` leaves the runtime readable, for when you want to see what the
6 kB actually is. `pnpm measure` breaks the same number down file by file.

## slide init

```sh
slide init                 # ./slides.md
slide init talk.md         # ./talk.md
slide init talks/intro.md  # creates the directory too
```

Writes one markdown file and nothing else — a cover, a slide of prose, a
two-column slide and a closing slide.

No config, no layouts directory, no stylesheet: a deck needs none of them, and
each one is a file to understand before you can change a word. It refuses to
overwrite an existing file.

## Exit codes

| Code | Means |
| --- | --- |
| `0` | it worked |
| `1` | a parse error, a missing file, a bad option — the message names the file and the line |

Every error the parser raises carries a source location, so a failing build in
CI tells you which line of which deck to open.
