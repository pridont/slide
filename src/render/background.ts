import { isExternalUrl, isResolvableRef } from './html.js'

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

/**
 * Characters that would end the declaration or its rule. Not a trust boundary
 * — a deck is the author's own file — just a stray brace breaking one slide
 * rather than the stylesheet.
 */
const UNSAFE_IN_DECLARATION = /[{};<>]/g

/**
 * `background:` frontmatter takes either a CSS colour or an image reference.
 * Both become custom properties, so the stylesheet decides how they apply.
 */
export function backgroundDeclaration(value: string, resolveAsset: (ref: string) => string): string {
  const isImage = IMAGE_EXTENSION_RE.test(value) || isExternalUrl(value) || value.startsWith('/')

  if (!isImage) return `--slide-background: ${sanitize(value)}`

  const url = isResolvableRef(value) ? resolveAsset(value) : value
  return `--slide-background-image: url("${sanitize(url)}")`
}

function sanitize(value: string): string {
  return value.replace(UNSAFE_IN_DECLARATION, '').trim()
}
