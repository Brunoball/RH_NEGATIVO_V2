const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('@playwright/test');

async function captureDownload(page, trigger, options = {}) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const suggested = download.suggestedFilename();
  if (options.extension) {
    expect(suggested.toLowerCase()).toMatch(
      new RegExp(`${String(options.extension).replace('.', '\\.')}$`, 'i'),
    );
  }

  const target = path.join(
    os.tmpdir(),
    `rh-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}-${suggested}`,
  );
  await download.saveAs(target);
  const content = fs.readFileSync(target);
  fs.unlinkSync(target);

  expect(content.length).toBeGreaterThan(options.minimumBytes || 20);
  if (options.signature) {
    expect(content.subarray(0, options.signature.length).toString('binary')).toBe(options.signature);
  }
  return { content, suggestedFilename: suggested };
}

async function exportFromGlobalModal(page, {
  openButton,
  format,
  scope = null,
  expectedExtension,
}) {
  const dialog = page.getByRole('dialog').filter({ hasText: /Elegí el formato|Alcance/i }).last();

  await expect(openButton).toBeVisible();
  await expect(openButton).toBeEnabled();
  await openButton.scrollIntoViewIfNeeded();
  await openButton.click();

  // En remoto la tabla puede terminar un refresh justo después del click y
  // React reemplaza el árbol del botón/modal. Esperamos primero una ventana
  // corta y, sólo si el modal nunca llegó a montarse, repetimos UNA vez la
  // acción real del usuario. No se ignora ningún error de API ni de exportación.
  try {
    await expect(dialog).toBeVisible({ timeout: 3000 });
  } catch (_firstOpenError) {
    await expect(openButton).toBeVisible();
    await expect(openButton).toBeEnabled();
    await openButton.click();
    await expect(dialog).toBeVisible();
  }

  if (scope) {
    const scopeRegex = new RegExp(scope, 'i');
    let scopeRadio = dialog.getByRole('radio', { name: scopeRegex });

    // Si el informe solo tiene un alcance posible, el modal muestra unicamente
    // `actual`. Validamos ese contrato en vez de consumir todo el timeout por copy.
    if (await scopeRadio.count() === 0) {
      const scopeRadios = dialog.locator('input[name="alcance_exportar_global"]');
      const scopeCount = await scopeRadios.count();
      if (scopeCount === 1) {
        scopeRadio = scopeRadios.first();
        await expect(scopeRadio).toHaveValue('actual');
      } else {
        await expect(
          dialog.getByRole('radio', { name: scopeRegex }),
          `No se encontro el alcance solicitado: ${scope}`,
        ).toBeVisible({ timeout: 3000 });
      }
    }

    await scopeRadio.locator('xpath=ancestor::label').click();
    await expect(scopeRadio).toBeChecked();
  }

  const formatRadio = dialog.getByRole('radio', { name: new RegExp(`^${format}\\b`, 'i') });
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
