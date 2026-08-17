import { expect, test } from '@playwright/test'

/**
 * The example deck, built and served as static files. Everything here is
 * something the unit tests cannot see: a key press that becomes a navigation,
 * a transition that fires, two windows agreeing on a slide.
 */

test.describe('moving through a deck', () => {
  test('the keys navigate, and the URL is the slide', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-slide', '1')

    await page.keyboard.press('ArrowRight')
    await page.waitForURL('/2/')
    await expect(page.locator('body')).toHaveAttribute('data-slide', '2')

    await page.keyboard.press('ArrowLeft')
    await page.waitForURL('/')

    await page.keyboard.press('End')
    await page.waitForURL(/\/\d+\/$/)
    const total = await page.locator('body').getAttribute('data-total')
    await expect(page.locator('body')).toHaveAttribute('data-slide', String(total))

    await page.keyboard.press('Home')
    await page.waitForURL('/')
  })

  test('a real navigation, not a router', async ({ page }) => {
    // Cross-document transitions only happen for real navigations, and the
    // whole design rests on that.
    await page.goto('/')
    const first = await page.evaluate(() => performance.getEntriesByType('navigation').length)

    await page.keyboard.press('ArrowRight')
    await page.waitForURL('/2/')

    expect(first).toBe(1)
    expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.entryType)).toBe(
      'navigation',
    )
  })

  test('back and forward work, because slides are pages', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('ArrowRight')
    await page.waitForURL('/2/')

    await page.goBack()
    await page.waitForURL('/')
    await page.goForward()
    await page.waitForURL('/2/')
  })

  test('a key press while typing is left alone', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'probe'
      document.body.append(input)
      input.focus()
    })

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    expect(new URL(page.url()).pathname).toBe('/')
  })
})

test.describe('the view transition', () => {
  test('fires, and knows which way it is going', async ({ page }) => {
    await page.goto('/3/')

    // pagereveal marks the direction before the first render of the new page,
    // so by the time the navigation settles the attribute is already there.
    await page.keyboard.press('ArrowRight')
    await page.waitForURL('/4/')
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'forward')

    await page.keyboard.press('ArrowLeft')
    await page.waitForURL('/3/')
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'back')
  })

  test('leaves no unhandled rejection behind when it is skipped', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto('/')
    // Two navigations in a row is one of the ways a transition gets skipped.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(800)

    expect(errors.filter((text) => /AbortError|transition was skipped/i.test(text))).toEqual([])
  })
})

test.describe('what the page asks the browser for', () => {
  test('prerenders its neighbours', async ({ page }) => {
    await page.goto('/5/')

    const rules = await page.locator('script[type="speculationrules"]').textContent()
    expect(JSON.parse(rules ?? '{}')).toEqual({
      prerender: [{ urls: ['/4/', '/6/'], eagerness: 'immediate' }],
    })
  })

  test('paints before the runtime has run', async ({ page }) => {
    await page.goto('/')

    // The theme is a render-blocking stylesheet, not something a module
    // injects — that difference is a white flash between slides.
    const styled = await page.evaluate(() => {
      const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((link) =>
        link.getAttribute('href'),
      )
      return { links, background: getComputedStyle(document.body).backgroundColor }
    })

    expect(styled.links.some((href) => href?.includes('runtime'))).toBe(true)
    expect(styled.background).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('says which colour to paint before any stylesheet arrives', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
  })
})

test.describe('embeds', () => {
  test('stay empty until the slide is reached, then load', async ({ page }) => {
    await page.goto('/13/')

    const frame = page.locator('iframe.slide-embed-frame').first()
    await expect(frame).toHaveAttribute('data-embed-src', /easing/)
    // The runtime fills in `src` on activation; the page ships without one.
    await expect(frame).toHaveAttribute('src', /easing/)
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  })
})
