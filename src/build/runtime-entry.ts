import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Path to the browser runtime entry: `dist/runtime/index.js` in a built
 * install, the TypeScript file when running from source. Vite takes either.
 */
export function resolveRuntimeEntry(): string {
  return locate(['../runtime/index.js', '../runtime/index.ts'], 'the browser runtime entry')
}

/**
 * The theme stylesheet, for dev to link directly.
 *
 * In a build it arrives as an extracted, render-blocking stylesheet, because
 * the runtime imports it. Dev has no extraction step, so the same import
 * injects it from script — and every navigation painted an unstyled page until
 * that ran. Linking the file as well is what removes the flash; the import
 * stays, because it is what hot-reloads the theme while an author edits it.
 */
export function resolveThemeStylesheet(): string {
  return locate(['../theme/base.css'], 'the theme stylesheet')
}

/**
 * The token stylesheet. Read rather than mirrored into TypeScript: a diagram
 * has to be handed concrete colours, and a second copy of the palette would be
 * a second thing to keep in step with the first.
 */
export function resolveTokensStylesheet(): string {
  return locate(['../theme/tokens.css'], 'the token stylesheet')
}

function locate(candidates: readonly string[], what: string): string {
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url))
    if (existsSync(path)) return path
  }
  throw new Error(`slide: could not locate ${what}.`)
}
