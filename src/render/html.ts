const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

/** URLs that already point somewhere absolute and must not be touched. */
export function isExternalUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
}

/** A reference the build can resolve to a hashed asset. */
export function isResolvableRef(url: string): boolean {
  if (url === '') return false
  if (isExternalUrl(url)) return false
  if (url.startsWith('#') || url.startsWith('/')) return false
  return true
}
