import { expect, test, type Page } from '@playwright/test'

/**
 * Two windows on one channel. This is the part of the deck that cannot be
 * tested any other way: the audience is a new document on every slide, and
 * everything interesting is about what the two of them say to each other
 * across that.
 */

/** Both pages share an origin, so one context, two pages. */
async function windows(page: Page): Promise<{ presenter: Page; audience: Page }> {
  const audience = page
  const presenter = await page.context().newPage()

  await presenter.goto('/presenter/')
  await audience.goto('/')
  await expect(presenter.locator('[data-role="index"]')).toHaveText('1')

  return { presenter, audience }
}

test('the presenter window shows the slide, the next one, and the notes', async ({ page }) => {
  const { presenter } = await windows(page)

  await expect(presenter.locator('iframe[data-role="current"]')).toHaveAttribute('src', '/?preview=current')
  await expect(presenter.locator('iframe[data-role="next"]')).toHaveAttribute('src', '/2/?preview=next')
  await expect(presenter.locator('[data-role="notes"]')).toContainText('frontmatter')
  await expect(presenter.locator('[data-role="clock"]')).not.toHaveText('--:--')
})

test('the presenter drives the audience', async ({ page }) => {
  const { presenter, audience } = await windows(page)

  await presenter.locator('[data-action="next"]').click()
  await audience.waitForURL('/2/')
  await expect(presenter.locator('[data-role="index"]')).toHaveText('2')

  await presenter.keyboard.press('ArrowRight')
  await audience.waitForURL('/3/')
})

test('a key on the audience window pulls the presenter along', async ({ page }) => {
  const { presenter, audience } = await windows(page)

  await audience.keyboard.press('ArrowRight')
  await audience.waitForURL('/2/')

  // The audience announced the move before navigating, because the document
  // that made it is about to be replaced.
  await expect(presenter.locator('[data-role="index"]')).toHaveText('2')
})

test('a window that joins late catches up', async ({ page }) => {
  const { presenter, audience } = await windows(page)

  await presenter.locator('[data-action="next"]').click()
  await presenter.locator('[data-action="next"]').click()
  await audience.waitForURL('/3/')

  // Back to the start, as a fresh document with no idea where the talk is.
  await audience.goto('/')
  await audience.waitForURL('/3/')
  // And the presenter is not dragged back by the tab that just loaded.
  await expect(presenter.locator('[data-role="index"]')).toHaveText('3')
})

test('the preview frames keep to themselves', async ({ page }) => {
  const { presenter, audience } = await windows(page)

  const frame = presenter.frameLocator('iframe[data-role="current"]')
  await frame.locator('body').waitFor()
  await presenter.locator('iframe[data-role="current"]').press('ArrowRight')
  await presenter.waitForTimeout(400)

  // A slide inside the presenter's own window does not navigate, and does not
  // announce anything to the audience.
  await expect(presenter.locator('[data-role="index"]')).toHaveText('1')
  expect(new URL(audience.url()).pathname).toBe('/')
})

test('the timer runs, pauses and resets', async ({ page }) => {
  const { presenter } = await windows(page)
  const timer = presenter.locator('[data-action="timer"]')

  await expect(timer).toHaveText('0:00')
  await timer.click()
  await expect(timer).toHaveClass(/is-running/)
  await expect(timer).toHaveText('0:01', { timeout: 3000 })

  await timer.click()
  await expect(timer).not.toHaveClass(/is-running/)
  const held = await timer.textContent()
  await presenter.waitForTimeout(1200)
  await expect(timer).toHaveText(held ?? '')

  await presenter.locator('[data-action="reset"]').click()
  await expect(timer).toHaveText('0:00')
})

test('p opens the presenter window from a slide', async ({ page }) => {
  await page.goto('/')

  const opened = page.waitForEvent('popup')
  await page.keyboard.press('p')
  const presenter = await opened

  await expect(presenter).toHaveURL(/\/presenter\/$/)
})
