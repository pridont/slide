import { describe, expect, it } from 'vitest'
import { DiagramStyles, diagramKey, findDiagrams, normalizeDiagram } from './diagram.js'
import { createMarkdown, renderMarkdown } from './markdown.js'

const md = createMarkdown()

/**
 * A cut-down version of what mermaid actually returns, keeping every shape
 * this pass has to deal with: the `style` attribute on the root and on inner
 * elements, the embedded stylesheet, escaped selectors and quotes, ids that
 * carry a counter, full-precision coordinates, and path data.
 */
const RAW = [
  '<svg id="m-abc" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart"',
  ' style="max-width: 704.734375px;" viewBox="0 0 704.734375 162">',
  '<style>#m-abc{font-family:system-ui;}',
  '@keyframes dash{to{stroke-dashoffset:0;}}',
  '#m-abc text.actor&gt;tspan{fill:#ece6f1;}</style>',
  '<g id="flowchart-A-0" transform="translate(91.8798828125, 83)">',
  '<rect style="stroke: none; stroke-width: 0;" width="120.515625" height="40"></rect>',
  '<path d="M-83.8798828125 -75 C-34.11774317573377 -75, 15.644396461032457 -75" style="fill:none"></path>',
  '<text style="font-family: &quot;Segoe UI&quot;, Arial, sans-serif; font-size: 16px" class="label">A</text>',
  '<use href="#flowchart-A-0"></use>',
  '</g></svg>',
].join('')

function normalize(raw = RAW, key = 'k1', styles = new DiagramStyles()) {
  return { ...normalizeDiagram(raw, key, styles), styles }
}

describe('finding mermaid fences', () => {
  it('finds one, and says where it was written', () => {
    const found = findDiagrams(md, '# Title\n\n```mermaid\nflowchart LR\n  A --> B\n```\n')

    expect(found).toHaveLength(1)
    expect(found[0]!.source).toBe('flowchart LR\n  A --> B\n')
    // Lines into the body, so `slide.sourceLine + line` names the file's line.
    expect(found[0]!.line).toBe(2)
  })

  it('leaves every other language alone', () => {
    expect(findDiagrams(md, '```ts\nconst a = 1\n```\n')).toHaveLength(0)
    expect(findDiagrams(md, '```\nplain\n```\n')).toHaveLength(0)
    // An info string can carry more than the language.
    expect(findDiagrams(md, '```mermaid title=x\nflowchart LR\n```\n')).toHaveLength(1)
  })

  it('finds one inside a `::: right` region', () => {
    // A region keeps its content on the token rather than parsing it in place,
    // so the top-level token stream does not have the fence in it at all.
    const found = findDiagrams(md, 'left\n\n::: right\n\n```mermaid\nflowchart LR\n```\n\n:::\n')

    expect(found).toHaveLength(1)
    expect(found[0]!.source).toBe('flowchart LR\n')
  })
})

describe('the diagram key', () => {
  it('is the same for the same source and config', () => {
    expect(diagramKey('flowchart LR', 'cfg')).toBe(diagramKey('flowchart LR', 'cfg'))
  })

  it('changes when the source or the palette does', () => {
    expect(diagramKey('flowchart LR', 'cfg')).not.toBe(diagramKey('flowchart TB', 'cfg'))
    // A recoloured deck is a different diagram, and nothing in its source says so.
    expect(diagramKey('flowchart LR', 'cfg')).not.toBe(diagramKey('flowchart LR', 'other'))
  })
})

describe('normalising mermaid output', () => {
  it('leaves no inline style behind', () => {
    const { svg } = normalize()

    // Style *attributes* cannot be allowed by a hash at all, only by
    // 'unsafe-inline' — so the deck must not emit any.
    expect(svg).not.toMatch(/\sstyle="/)
    expect(svg).not.toContain('<style>')
  })

  it('moves the declarations to classes, shared across diagrams', () => {
    const styles = new DiagramStyles()
    const first = normalizeDiagram(RAW, 'k1', styles)
    const second = normalizeDiagram(RAW.replace(/m-abc/g, 'm-def'), 'k2', styles)

    // The same declaration in two diagrams is one rule.
    expect(styles.rules()).toContain('{stroke: none}')
    expect(styles.rules().match(/\{stroke: none\}/g)).toHaveLength(1)
    expect(first.svg).toMatch(/class="[^"]*sd/)
    expect(second.svg).toMatch(/class="[^"]*sd/)
  })

  it('keeps a font stack in one piece', () => {
    // The quotes arrive as `&quot;`, and splitting on `;` before decoding them
    // cuts the declaration at the semicolon inside the entity.
    const { styles } = normalize()

    expect(styles.rules()).toContain('{font-family: "Segoe UI", Arial, sans-serif}')
  })

  it('decodes the escaped selectors in the lifted stylesheet', () => {
    // `<style>` inside `<svg>` is foreign content, so it serialises escaped.
    // Written to a .css file as-is, `text.actor&gt;tspan` matches nothing.
    const { css } = normalize()

    expect(css).toContain('text.actor>tspan')
    expect(css).not.toContain('&gt;')
  })

  it('keeps `@keyframes` once for the whole build', () => {
    const styles = new DiagramStyles()
    normalizeDiagram(RAW, 'k1', styles)
    normalizeDiagram(RAW.replace(/m-abc/g, 'm-def'), 'k2', styles)

    expect(styles.rules().match(/@keyframes dash/g)).toHaveLength(1)
  })

  it('renumbers ids from the key, in the SVG and the stylesheet together', () => {
    const { svg, css } = normalize()

    expect(svg).toContain('id="sd-k1-0"')
    expect(svg).toContain('id="sd-k1-1"')
    // A reference to a renamed id has to move with it.
    expect(svg).toContain('href="#sd-k1-1"')
    expect(css).toContain('#sd-k1-0')
    expect(svg).not.toContain('m-abc')
    expect(svg).not.toContain('flowchart-A-0')
  })

  it('comes out identical whatever mermaid numbered its ids', () => {
    // Mermaid's counters climb as a page renders more diagrams, so the same
    // source renders differently depending on what came before it. A rebuild
    // that moved would move the deck stylesheet's hash with it.
    const later = RAW.replace(/flowchart-A-0/g, 'flowchart-A-7').replace(/m-abc/g, 'm-xyz')

    expect(normalize(later).svg).toBe(normalize().svg)
    expect(normalize(later).css).toBe(normalize().css)
  })

  it('gives the natural width in em, so a diagram rides the type scale', () => {
    const { css } = normalize()

    // 704.734375px measured at mermaid's 16px. Left in pixels it would be the
    // one thing on a slide that ignores the frame.
    expect(css).toContain('#sd-k1-0{max-width:44.05em}')
    expect(css).not.toContain('px}')
  })

  it('rounds lengths but never path data', () => {
    const { svg } = normalize()

    expect(svg).toContain('transform="translate(91.88, 83)"')
    expect(svg).toContain('width="120.52"')
    // Rounding inside `d` with a regex produces coordinates a browser rejects.
    expect(svg).toContain('d="M-83.8798828125 -75 C-34.11774317573377 -75, 15.644396461032457 -75"')
  })

  it('drops a declaration that would close the rule it lands in', () => {
    const styles = new DiagramStyles()
    normalizeDiagram('<svg id="a"><rect style="fill:red} .x{fill:blue"></rect></svg>', 'k', styles)

    expect(styles.rules()).not.toContain('fill:blue')
  })
})

describe('rendering a diagram into a slide', () => {
  const lookup = () => ({ svg: '<svg id="x"></svg>', css: '' })

  it('replaces the fence with the drawn picture', () => {
    const html = renderMarkdown(md, '```mermaid\nflowchart LR\n```\n', (ref) => ref, { diagram: lookup }).html

    expect(html).toContain('<figure class="slide-diagram"><svg id="x"></svg></figure>')
    expect(html).not.toContain('<pre')
  })

  it('falls back to the source where nothing drew it', () => {
    // Speaker notes and embed captions render without the pre-pass.
    const html = renderMarkdown(md, '```mermaid\nflowchart LR\n```\n', (ref) => ref).html

    expect(html).toContain('<pre')
    expect(html).toContain('flowchart LR')
  })

  it('still highlights every other language', () => {
    const html = renderMarkdown(md, '```ts\nconst a = 1\n```\n', (ref) => ref, { diagram: lookup }).html

    expect(html).toContain('<pre class="hljs" data-language="ts">')
  })
})
