import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { displayPath } from '../build/paths.js'

/**
 * `slide init [path]` — a deck to start from.
 *
 * One markdown file and nothing else. A scaffold that writes a config, a
 * layouts directory and a stylesheet would be teaching the wrong thing: none
 * of those are needed, and every one of them is a file the author has to
 * understand before they can change a word.
 */
export async function init(target: string): Promise<string> {
  const path = resolve(target.endsWith('.md') ? target : `${target}/slides.md`)

  if (existsSync(path)) {
    throw new Error(`${displayPath(path)} already exists.\nPick another name, or edit the one that is there.`)
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, deck(basename(path, '.md')), 'utf8')
  return path
}

function deck(name: string): string {
  const title = name === 'slides' ? 'A new deck' : sentence(name)

  return `---
title: ${title}
layout: cover
---

# ${title}

## Written in markdown, served as a website

<!-- Speaker notes live in a comment at the end of a slide. Press p while
presenting to see them. -->

---

## One file, one slide per \`---\`

A separator is a line of exactly three dashes with a blank line above it, so a
setext heading and a thematic break are both still themselves.

- Every slide is its own page, and its own URL
- The next slide is prerendered, so moving between them is instant
- Arrow keys, space, \`f\` for fullscreen, \`p\` for the presenter window

---
layout: two-cols
---

## Frontmatter configures a slide

\`\`\`yaml
layout: two-cols
class: theme-lilac
background: ./photo.jpg
\`\`\`

::: right

## And the deck

Frontmatter at the top of the file sets the deck's \`title\`, \`theme\` tokens
and fonts — and doubles as the first slide's own.

---
layout: center
---

## Now write your own

\`slide dev ${name}.md\` to edit, \`slide build ${name}.md\` to publish.
`
}

/** `my-talk` becomes `My talk`, which is a better title than the filename. */
function sentence(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
