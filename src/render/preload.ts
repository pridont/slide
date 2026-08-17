import { scanLines } from '../parse/scan.js'

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/
const RAW_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/**
 * The first image a slide shows, used to warm it before the viewer navigates.
 * Code fences are skipped so a sample in a snippet is not mistaken for one.
 */
export function firstImageRef(body: string): string | null {
  for (const line of scanLines(body)) {
    if (line.inFence) continue

    const markdown = MARKDOWN_IMAGE_RE.exec(line.text)
    if (markdown) return markdown[1]!

    const raw = RAW_IMAGE_RE.exec(line.text)
    if (raw) return raw[1] ?? raw[2]!
  }
  return null
}
