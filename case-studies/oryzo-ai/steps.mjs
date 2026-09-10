// Site-specific interaction steps for the oryzo.ai case study.
//   node tools/interact.mjs <url> <out> --steps case-studies/oryzo-ai/steps.mjs
//
// Run against the source and the clone; the comparison of the two reports is
// the actual test. A step that fails on BOTH is a limit of the harness, not a
// clone defect — see docs/case-studies/oryzo-ai/07-interaction-matrix.md.
export default async ({ page, step, shot }) => {
  // Hero video overlay (Vimeo iframe)
  await step('video-overlay-open', async () => {
    await page.click('#hero-video-play', { timeout: 8000 });
    await page.waitForTimeout(3500);
    return page.evaluate(() => {
      const o = document.querySelector('#video-overlay');
      return { cls: o.className, opacity: getComputedStyle(o).opacity, iframe: !!o.querySelector('iframe') };
    });
  });
  await shot('video-overlay');

  await step('video-overlay-close', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.mouse.click(1400, 60);
    await page.waitForTimeout(1500);
    return page.evaluate(() => getComputedStyle(document.querySelector('#video-overlay')).opacity);
  });

  // WebGL product configurator: three variants
  await step('goto-product', async () => {
    await page.evaluate(() => document.querySelector('#product')?.scrollIntoView());
    await page.waitForTimeout(4000);
    return page.evaluate(() => Math.round(window.scrollY));
  });

  const variants = [
    ['0', '#product-hero-option-oryzo'],
    ['1', '#product-hero-option-oryzo-pro'],
    ['2', '#product-hero-option-oryzo-pro-max'],
  ];
  for (const [i, sel] of variants) {
    await step('product-variant-' + i, async () => {
      await page.click(sel, { timeout: 8000 });
      await page.waitForTimeout(2500);
      return page.$$eval('.product-hero-option-item',
        els => els.map(e => e.className.includes('is-active') ? 'ACTIVE' : '-'));
    });
    await shot('product-variant-' + i);
  }

  // Known to time out on the source too — kept so the parity holds.
  await step('encryption-flip', async () => {
    await page.evaluate(() => document.querySelector('#encryption')?.scrollIntoView());
    await page.waitForTimeout(3000);
    const before = await page.$eval('#encryption-field-input', e => e.textContent.trim().slice(0, 40));
    await page.click('#encryption-field-flip-btn', { timeout: 8000 });
    await page.waitForTimeout(2000);
    const after = await page.$eval('#encryption-field-input', e => e.textContent.trim().slice(0, 40));
    return { before, after, changed: before !== after };
  });

  await step('temperature-slider', async () => {
    await page.evaluate(() => document.querySelector('#features-item-temperature')?.scrollIntoView());
    await page.waitForTimeout(3000);
    const box = await page.locator('#features-temperature-slider__bar').boundingBox();
    if (!box) throw new Error('slider bar not found');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    return page.$eval('#features-temperature-slider__text-container', e => e.textContent.trim().slice(0, 60));
  });
  await shot('temperature-slider');

  await step('footer-copy-url', async () => {
    await page.evaluate(() => document.querySelector('#footer')?.scrollIntoView());
    await page.waitForTimeout(3000);
    const btn = page.locator('#footer-love button, #footer-love .is-flipper').first();
    await btn.click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    return btn.textContent();
  });

  // On the clone this must NOT reach Mailchimp — clone-fixes.js blocks it and
  // fakes the success callback, so the message differs from the source on purpose.
  await step('newsletter-submit', async () => {
    await page.fill('#footer-email-input', 'parity-test@example.com');
    await page.click('#footer-email-btn', { timeout: 8000 });
    await page.waitForTimeout(2500);
    return page.$eval('#footer-newsletter-message', e => e.textContent.trim().slice(0, 90));
  });
  await shot('footer');

  await step('mobile-menu-items', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(3500);
    await page.click('#site-header-mobile-btn', { timeout: 8000 });
    await page.waitForTimeout(1500);
    return page.evaluate(() => ({
      menu: getComputedStyle(document.querySelector('#site-header-mobile-menu')).opacity,
      items: [...document.querySelectorAll('#site-header-mobile-menu a')].map(a => a.textContent.trim()),
    }));
  });
};
