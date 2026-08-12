const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('@playwright/test');

async function captureDownload(page, trigger, options = {}) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    trigger(),
  ]);

  const suggested = download.suggestedFilename();
  if (options.extension) {
    expect(suggested.toLowerCase()).toMatch(
      new RegExp(`${String(options.extension).replace('.', '\\.')}$`, 'i'),
    );
  }

  const target = path.join(
    os.tmpdir(),
    `lalcec-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}-${suggested}`,
  );
  await download.saveAs(target);
  const content = fs.readFileSync(target);
  fs.unlinkSync(target);

  expect(content.length).toBeGreaterThan(options.minimumBytes || 20);
  if (options.signature) {
    expect(content.subarray(0, options.signature.length).toString('binary')).toBe(
      options.signature,
    );
  }

  return { content, suggestedFilename: suggested };
}

async function exportFromGlobalModal(page, {
  openButton,
  format,
  scope = null,
  expectedExtension,
}) {
  const dialog = page.getByRole('dialog').filter({ hasText: /Alcance/i });
  await expect(openButton).toBeVisible();
  await expect(openButton).toBeEnabled();
  await openButton.click();

  try {
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
  } catch (_error) {
    if (!(await dialog.isVisible().catch(() => false))) {
      await openButton.click();
    }
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
  }
  await expect(dialog).toBeVisible();

  if (scope) {
    const scopeRadio = dialog.getByRole('radio', { name: new RegExp(scope, 'i') });
    await scopeRadio.locator('xpath=ancestor::label').click();
    await expect(scopeRadio).toBeChecked();
  }

  const formatRadio = dialog.getByRole('radio', {
    name: new RegExp(`^${format}\\b`, 'i'),
  });
  await formatRadio.locator('xpath=ancestor::label').click();
  await expect(formatRadio).toBeChecked();

  const result = await captureDownload(
    page,
    () => dialog.getByRole('button', { name: /^Exportar$/ }).click(),
    {
      extension: expectedExtension,
      signature: expectedExtension === '.pdf' ? '%PDF' : 'PK',
      minimumBytes: expectedExtension === '.pdf' ? 300 : 500,
    },
  );
  await expect(dialog).toBeHidden();
  return result;
}

module.exports = { captureDownload, exportFromGlobalModal };
