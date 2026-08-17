---
title: Deploying
description: What the build writes, the cache headers it wants, the CSP it passes under, and a GitHub Pages workflow to copy.
---

## The output

```
dist/
  index.html                 project index, when there is more than one deck
  <deck>/index.html          slide 1
  <deck>/2/index.html        slide 2…n
  <deck>/presenter/index.html
  assets/runtime-<hash>.js   shared by every page of every deck
  assets/runtime-<hash>.css
  assets/<name>-<hash>.<ext> images, fonts, anything referenced
  embeds/<name>-<hash>/      directory embeds, copied whole
```

Static files. Any host that serves a directory will do: GitHub Pages, Netlify,
Cloudflare Pages, S3, nginx, a USB stick.

For a single-deck build, slide 1 is `dist/index.html` and there is no project
index.

## The base path

The one thing to get right. `--base` is the public path the site is served
from:

| Where it lives | Base |
| --- | --- |
| `https://you.github.io/talk/` | `--base /talk/` |
| `https://you.github.io/` (a user site) | `--base /` |
| `https://talks.example.com/` | `--base /` |
| `https://example.com/2026/talk/` | `--base /2026/talk/` |

Getting it wrong looks like a deck that loads with no stylesheet, because every
asset URL is absolute and rooted at the base.

## GitHub Pages

Put the deck in a repository, add this as `.github/workflows/pages.yml`, and
turn on Pages with **Source: GitHub Actions** in the repository settings.

```yaml
name: Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write
  actions: read

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      # The base path is the repository name on a project site.
      - run: npx slide build talk.md --out dist --base "/${GITHUB_REPOSITORY#*/}/"
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - id: deploy
        uses: actions/deploy-pages@v5
```

Action majors matter here: anything older than `checkout@v5`, `setup-node@v5`,
`upload-pages-artifact@v5` or `deploy-pages@v5` runs on the Node 20 runtime the
runners are retiring, and `deploy-pages` needs `actions: read` to fetch the
artifact it deploys.

`npm ci` needs the CLI in the deck's `package.json` — see
[installing it as a project dependency](./install.md#as-a-project-dependency).
That is what pins the version your deck is built with, so a talk you gave in
March still builds in November.

### With diagrams

A deck with a ` ```mermaid ` fence needs a browser on the runner:

```yaml
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx slide build talk.md --out dist --base "/${GITHUB_REPOSITORY#*/}/"
```

## Cache headers

Everything hashed is immutable; the pages are not:

```
/assets/*   Cache-Control: public, max-age=31536000, immutable
/embeds/*   Cache-Control: public, max-age=31536000, immutable
*.html      Cache-Control: no-cache
```

The pages are the URLs a deck is linked by, so they want revalidation. A stale
page pointing at an asset that no longer exists is the failure worth avoiding.

GitHub Pages sets its own headers and does not let you change them, which is
fine — hashed filenames mean a stale asset is never the wrong asset.

## Content-Security-Policy

Nothing the build emits sets a policy, and the output works under a strict one:

```
Content-Security-Policy:
  default-src 'self';
  script-src  'self' 'inline-speculation-rules';
  style-src   'self';
  img-src     'self' data:;
  font-src    'self'
```

There is nothing to hash and nothing to allow, because there is no inline
script and no inline `style` attribute anywhere in a page: custom properties
that would have been inline styles are generated into a stylesheet instead, and
the one script that must run before the first render is an external
parser-blocking file.

`'inline-speculation-rules'` is the exception, and dropping it fails silently —
prerendering stops with no console warning. The alternative is a
`Speculation-Rules` response header, which needs server configuration a static
host may not offer.

If your deck has [embeds](./embeds.md) that reach outside their own directory,
they need `frame-src` and whatever the embedded page itself uses. Nothing the
tool emits does.

## Size budgets

A [project](./projects.md) can tell the build what "too big" means:

```ts
export default {
  budget: { page: 100, asset: 1000 },
} satisfies ProjectConfig
```

Sizes in kB. The build complains past them and keeps going; `0` turns a check
off. A deck that quietly grows a 4 MB background is the thing this catches.

## Other hosts

Nothing is host-specific. The commands are all the same shape:

```sh
slide build talk.md --out dist --base /

# Netlify
netlify deploy --dir dist --prod

# Cloudflare Pages
wrangler pages deploy dist

# Anything with a directory
rsync -av --delete dist/ you@host:/var/www/talk/
```

For a subdirectory on your own server, remember `--base /that/subdirectory/`.
