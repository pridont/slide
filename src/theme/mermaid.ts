import { createHash } from 'node:crypto'
import type { Palette } from './palette.js'

/**
 * The deck's tokens, as the handful of variables mermaid derives the rest from.
 *
 * Mermaid exposes 269 theme variables, but only about fifteen are roots — the
 * others are lightened and darkened out of those by its `base` theme. Setting
 * the roots is what makes a diagram look like the rest of the deck; the ones
 * listed past them are the cases where a diagram type reads its own variable
 * and would otherwise keep a default that belongs to no palette here.
 */
export function mermaidThemeVariables(palette: Palette): Record<string, string> {
  const token = (name: string, fallback = ''): string => palette[name] ?? fallback

  const bg = token('color-bg', '#17131c')
  const panel = token('color-panel', bg)
  const fg = token('color-fg', '#ece6f1')
  const muted = token('color-muted', fg)
  const accent = token('color-accent', fg)
  const onAccent = token('color-accent-contrast', bg)

  return {
    // The slide paints the background; a diagram sitting on top of it must not
    // paint its own, or every diagram becomes a panel with hard edges.
    background: 'transparent',

    primaryColor: panel,
    primaryBorderColor: accent,
    primaryTextColor: fg,
    secondaryColor: bg,
    secondaryBorderColor: muted,
    secondaryTextColor: fg,
    tertiaryColor: bg,
    tertiaryBorderColor: muted,
    tertiaryTextColor: muted,

    lineColor: muted,
    textColor: fg,
    mainBkg: panel,
    nodeBorder: accent,
    nodeTextColor: fg,
    titleColor: fg,
    arrowheadColor: muted,
    defaultLinkColor: muted,
    edgeLabelBackground: bg,
    clusterBkg: bg,
    clusterBorder: muted,

    // Sequence — its labels read their own variables, and the defaults are a
    // grey that disappears against ink.
    actorBkg: panel,
    actorBorder: accent,
    actorTextColor: fg,
    actorLineColor: muted,
    signalColor: fg,
    signalTextColor: fg,
    labelBoxBkgColor: panel,
    labelBoxBorderColor: accent,
    labelTextColor: fg,
    loopTextColor: fg,
    noteBkgColor: panel,
    noteTextColor: fg,
    noteBorderColor: accent,
    activationBkgColor: panel,
    activationBorderColor: accent,
    sequenceNumberColor: onAccent,

    // State and class
    labelColor: fg,
    altBackground: bg,
    classText: fg,

    // The accent trio is the categorical series, cycled — the same three
    // colours a deck switches between with `class: theme-…`.
    ...series(palette, bg, fg, onAccent),
  }
}

/** `pie1`…`pie12`, plus the labels around them. */
function series(palette: Palette, bg: string, fg: string, onAccent: string): Record<string, string> {
  const trio = [
    palette['color-apricot'] ?? '#e6a878',
    palette['color-lilac'] ?? '#c39fe0',
    palette['color-cyan'] ?? '#79c6cf',
  ]

  const out: Record<string, string> = {
    pieTitleTextColor: fg,
    pieSectionTextColor: onAccent,
    pieLegendTextColor: fg,
    pieStrokeColor: bg,
    pieOuterStrokeColor: bg,
    // Mermaid washes its slices out to 0.7 by default. The accents are already
    // tuned for contrast against the deck's background; fading them undoes it.
    pieOpacity: '1',
  }
  for (let i = 1; i <= 12; i++) out[`pie${i}`] = trio[(i - 1) % trio.length]!

  return out
}

/**
 * What mermaid measures in, and what the normalise pass divides the diagram's
 * one pixel measurement by to express it in `em`. Everything inside the SVG is
 * scaled by the `viewBox` and does not care; the root's width is the exception,
 * so these two have to be the same number — hence one of them.
 */
export const DIAGRAM_FONT_SIZE = 16

export interface MermaidConfigOptions {
  readonly palette: Palette
  /** The family diagram text is measured in — see `fontFamily` below. */
  readonly fontFamily: string
}

/**
 * `deterministicIds` and `handDrawnSeed` are not tuning: without them mermaid's
 * output moves between builds — the first through per-diagram-type counters,
 * the second because roughjs jitters bezier control points off `Math.random`.
 * A moving diagram is a moving deck stylesheet hash, and a stylesheet that
 * cannot be cached as immutable.
 *
 * `htmlLabels: false` keeps labels as SVG `<text>` rather than a `foreignObject`
 * full of HTML, which would carry inline styles into the page and depend on the
 * page's own CSS to lay out.
 */
export function mermaidConfig(options: MermaidConfigOptions): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
    deterministicIds: true,
    deterministicIDSeed: 'slide',
    handDrawnSeed: 1,
    fontFamily: options.fontFamily,
    fontSize: DIAGRAM_FONT_SIZE,
    themeVariables: mermaidThemeVariables(options.palette),
  }
}

/**
 * Identifies a rendering environment: everything that would change a diagram
 * without its source changing. Part of the cache key, so a recoloured deck
 * re-renders and an untouched one does not.
 */
export function configHash(config: Record<string, unknown>, mermaidVersion: string): string {
  return createHash('sha256')
    .update(mermaidVersion)
    .update(JSON.stringify(config))
    .digest('base64url')
    .slice(0, 12)
}
