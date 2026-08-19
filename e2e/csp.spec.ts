import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * The policy in docs/deploying.md, enforced rather than asserted.
 *
 * `slide build --serve` sets no headers — nothing the build emits needs one —
 * so the claim that the output survives a strict policy can only be checked by
 * putting one in front of it. This serves the same `examples/dist` the other
 * specs use, with the documented header and nothing else changed.
 *
 * Embeds are the part worth guarding: an embed is its own document and
 * inherits the policy, so an inline <style> or <script> inside one is blocked
 * even though every page slide passes.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'inline-speculation-rules'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
].join('; ')

const ROOT = fileURLToPath(new URL('../examples/dist', import.meta.url))
const PORT = 4179
const ORIGIN = `http://localhost:${PORT}`

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

let server: Server

test.beforeAll(async () => {
  server = createServer((request, response) => {
    let path = decodeURI((request.url ?? '/').split('?')[0] ?? '/')
    if (path.endsWith('/')) path += 'index.html'

    // Nothing above the build directory, whatever the URL asks for.
    const file = join(ROOT, normalize(path))
    if (!file.startsWith(ROOT)) {
      response.statusCode = 403
      response.end()
      return
    }

    readFile(file).then(
      (body) => {
        response.statusCode = 200
        response.setHeader('Content-Security-Policy', CSP)
        response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        response.end(body)
      },
      () => {
        response.statusCode = 404
        response.end()
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(PORT, resolve))
})

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

/** Every page and frame reports its own violations; this collects the lot. */
function watchForViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
      violations.push(message.text())
    }
  })
  return violations
}

test('every page of a built deck survives the documented policy', async ({ page }) => {
  const violations = watchForViolations(page)

  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
  const total = Number(await page.locator('body').getAttribute('data-total'))
  expect(total).toBeGreaterThan(1)

  for (let slide = 1; slide <= total; slide++) {
    await page.goto(slide === 1 ? `${ORIGIN}/` : `${ORIGIN}/${slide}/`, { waitUntil: 'networkidle' })
    // The theme is a real stylesheet, so a blocked one is a transparent body.
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(background, `slide ${slide} lost its stylesheet`).not.toBe('rgba(0, 0, 0, 0)')
  }

  await page.goto(`${ORIGIN}/presenter/`, { waitUntil: 'networkidle' })

  expect(violations).toEqual([])
})

test('an embed runs inside the policy too', async ({ page }) => {
  const violations = watchForViolations(page)

  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
  const total = Number(await page.locator('body').getAttribute('data-total'))

  let framed: number | null = null
  for (let slide = 1; slide <= total && framed === null; slide++) {
    await page.goto(slide === 1 ? `${ORIGIN}/` : `${ORIGIN}/${slide}/`, { waitUntil: 'networkidle' })
    if ((await page.locator('iframe.slide-embed-frame').count()) > 0) framed = slide
  }

  expect(framed, 'the example deck has no embed to check').not.toBeNull()

  // The frame fills in on activation, so wait for the document behind it.
  const frame = page.frameLocator('iframe.slide-embed-frame').first()
  await expect(frame.locator('button#play')).toBeVisible()

  // Its stylesheet is a file, not an inline <style> a strict style-src drops.
  const styled = await frame.locator('button#play').evaluate((node) => getComputedStyle(node).borderRadius)
  expect(styled).toBe('999px')

  expect(violations).toEqual([])
})
