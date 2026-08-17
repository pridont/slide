import { describe, expect, it } from 'vitest'
import { parseDeck } from '../parse/index.js'
import { renderSlidePage } from './index.js'
import { createMarkdown, renderMarkdown } from './markdown.js'

const FILE = '/deck.md'

function renderBody(body: string): string {
  return renderMarkdown(createMarkdown(), body, (ref) => ref).html
}

function page(source: string): string {
  const deck = parseDeck(source, FILE)
  return renderSlidePage({
    deck,
    slide: deck.slides[0]!,
    resolveAsset: (ref) => ref,
    href: () => '/',
    assets: { styles: [], modules: [], head: '/head.js' },
  })
}

describe('syntax highlighting', () => {
  it('marks up a known language', () => {
    const html = renderBody('```ts\nconst x: number = 1\n```')
    expect(html).toContain('<pre class="hljs" data-language="ts">')
    expect(html).toContain('hljs-keyword')
  })

  it('leaves an unknown language as an escaped plain block', () => {
    const html = renderBody('```wat\nnot a real language\n```')
    expect(html).toContain('<pre class="hljs"><code>not a real language')
    expect(html).not.toContain('data-language')
    expect(html).not.toContain('hljs-')
  })

  it('escapes a fence with no language at all', () => {
    expect(renderBody('```\n<script>x</script>\n```')).toContain('&lt;script&gt;x&lt;/script&gt;')
  })

  it('escapes markup inside a highlighted block', () => {
    const html = renderBody('```html\n<b>hi</b>\n```')
    expect(html).not.toContain('<b>hi</b>')
    expect(html).toContain('&lt;')
  })

  it('does not choke on code that is invalid for its language', () => {
    expect(() => renderBody('```json\n{ definitely not json\n```')).not.toThrow()
  })
})

describe('whitespace inside code blocks', () => {
  it('preserves indentation exactly', () => {
    // Indenting the document would indent every <pre> too, where space is
    // content.
    const html = page('```py\ndef f():\n    if x:\n        return 1\n```\n')
    expect(html).toContain('\n    <span class="hljs-keyword">if</span> x:\n        <span')
  })

  it('preserves indentation in an unhighlighted block too', () => {
    expect(page('```\nouter\n    inner\n```\n')).toContain('<code>outer\n    inner\n</code>')
  })

  it('does not leave trailing padding after the last line', () => {
    expect(page('```\nonly\n```\n')).toContain('<code>only\n</code></pre>')
  })
})

describe('colour scheme', () => {
  it('leaves the document element alone by default', () => {
    expect(page('# One\n')).toContain('<html lang="en">')
  })

  it('puts .light on the document element when asked', () => {
    // On <html> rather than swapped in by script, so it is right at first paint.
    expect(page('---\ncolorScheme: light\n---\n\n# One\n')).toContain('<html lang="en" class="light">')
  })

  it('rejects a scheme that is not one of the two', () => {
    expect(() => page('---\ncolorScheme: sepia\n---\n\n# One\n')).toThrow(
      /"colorScheme" must be one of dark, light; got "sepia"/,
    )
  })

  it('stays a class on the document element, with no inline style beside it', () => {
    // A class, not generated CSS: the scheme must be right at first paint,
    // and a stylesheet arrives later. The aspect ratio can wait, so it did.
    const html = page('---\ncolorScheme: light\naspectRatio: "4:3"\n---\n\n# One\n')
    expect(html).toContain('<html lang="en" class="light">')
    expect(html).not.toContain('style=')
  })
})

describe('accent classes', () => {
  it('passes a theme class through to the slide element', () => {
    expect(page('---\nclass: theme-lilac\n---\n\n# One\n')).toContain(
      'class="slide layout-default theme-lilac"',
    )
  })
})
