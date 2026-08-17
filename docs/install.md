---
title: Installation
description: One line to get the CLI, and the three other ways in case that line is not for you.
---

## The install script

```sh
curl -fsSL https://pridonte.github.io/slide/install.sh | sh
```

It resolves the latest GitHub release, downloads the npm tarball attached to
it, and installs that globally with npm. Then it runs `slide --version` and
tells you if the binary is not on your `PATH`.

Piping a script into a shell is worth reading first. It is
[one file](https://github.com/pridonte/slide/blob/main/install.sh), about a
hundred lines, and it only ever calls `curl`, `npm` and `node`:

```sh
curl -fsSL https://pridonte.github.io/slide/install.sh | less
```

### Requirements

| Needs | Why |
| --- | --- |
| Node.js 20 or newer | the CLI is an ES module and uses `node:util`'s `parseArgs` |
| npm | it resolves the CLI's dependencies; it ships with Node |
| `curl` or `wget` | to reach the GitHub API and download the release |

### Options

The script reads three environment variables:

```sh
# A specific release rather than the latest
curl -fsSL https://pridonte.github.io/slide/install.sh | SLIDE_VERSION=v0.2.0 sh

# Your own fork
curl -fsSL https://pridonte.github.io/slide/install.sh | SLIDE_REPO=you/slide sh

# A private repository, or an API that is rate-limiting you
curl -fsSL https://pridonte.github.io/slide/install.sh | GITHUB_TOKEN=ghp_… sh
```

## npm, without the script

The release asset is an ordinary npm tarball, so npm can install it straight
from its URL — no script involved:

```sh
npm install -g https://github.com/pridonte/slide/releases/latest/download/slide.tgz
```

### As a project dependency

A deck kept in a repository is usually better off with the CLI pinned beside
it, so everyone who checks it out builds it with the same version:

```sh
npm install -D https://github.com/pridonte/slide/releases/download/v0.2.0/slide-0.2.0.tgz
npx slide build slides/
```

This is also what a project using a TypeScript config wants, because
`slide.config.ts` imports its types from the package:

```ts
import type { ProjectConfig } from 'slide'
```

## From source

```sh
git clone https://github.com/pridonte/slide.git
cd slide
pnpm install
pnpm build
npm install -g .        # or: node dist/cli/index.js build talk.md
```

`pnpm` is what the repository uses; `npm install` works too.

## Diagrams need two more things

Nothing above installs mermaid or a browser, and a deck without a
` ```mermaid ` fence never wants either. A deck with one needs both, in the
project it is built from:

```sh
pnpm add -D mermaid playwright && pnpm exec playwright install chromium
```

They are optional peer dependencies. A deck that has a fence and neither
installed gets an error naming this line, rather than a diagram that quietly
renders differently somewhere else. See [Diagrams](./diagrams.md).

## Updating

Run the install script again — it always resolves the latest release:

```sh
curl -fsSL https://pridonte.github.io/slide/install.sh | sh
```

## Uninstalling

```sh
npm uninstall -g slide
```

## When it does not work

**`slide: command not found` after a successful install.** npm's global `bin`
directory is not on your `PATH`. The script prints the exact directory; add it
to your shell profile:

```sh
export PATH="$(npm prefix -g)/bin:$PATH"
```

**`npm cannot write to /usr/local`.** The global prefix is owned by root.
Either install with `sudo -E sh` — `-E` so `SLIDE_VERSION` and friends survive
— or, better, point npm somewhere you own and never need `sudo` again:

```sh
npm config set prefix ~/.local
export PATH="$HOME/.local/bin:$PATH"
```

**`has no published releases yet`.** There is no release to install from. Use
[from source](#from-source) until there is one.
