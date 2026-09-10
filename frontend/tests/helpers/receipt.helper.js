const { expect } = require('@playwright/test');
const { captureDownload } = require('./download.helper');

async function receiptDownload(page, trigger, names) {
  const result = await captureDownload(page, trigger, {
    extension: '.pdf', signature: '%PDF', minimumBytes: 300,
  });
  expect(result.suggestedFilename).toMatch(/^Comprobante - .+ - (?:PAGO|COND)-.+\.pdf$/);
  for (const name of names) {
    expect(result.suggestedFilename).toContain(name);
  }
  expect(result.content.toString('latin1')).toContain('%%EOF');
  return result;
}

async function receiptPopupDownload(page, trigger, names) {
  // Conservamos la ventana real. Sólo evitamos el diálogo nativo de impresión,
  // que Playwright no puede controlar; el enlace y la descarga son reales.
  await page.evaluate(() => {
    window.__pwOriginalReceiptOpen = window.open;
    window.open = function (...args) {
      const popup = window.__pwOriginalReceiptOpen.apply(window, args);
      if (popup) popup.print = () => { popup.__pwPrintRequested = true; };
      return popup;
    };
  });
  let popup;
  try {
    [popup] = await Promise.all([page.waitForEvent('popup'), trigger()]);
    await expect.poll(() => popup.evaluate(() => Boolean(window.__pwPrintRequested))).toBe(true);
    const link = popup.getByRole('link', { name: 'Descargar PDF', exact: true });
    await expect(link).toBeVisible();
    const result = await receiptDownload(popup, () => link.click(), names);
    await expect(popup).toHaveTitle(result.suggestedFilename.slice(0, -4));
    return result;
  } finally {
    if (popup) await popup.close();
    await page.evaluate(() => {
      window.open = window.__pwOriginalReceiptOpen;
      delete window.__pwOriginalReceiptOpen;
    });
  }
}

module.exports = { receiptDownload, receiptPopupDownload };
