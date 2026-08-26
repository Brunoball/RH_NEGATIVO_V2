# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 09-contable.spec.js >> Contabilidad · UI completa >> Ingresos de socios muestra cuotas e inscripciones por fecha y cubre búsqueda, paginación, exportación y Balance anual
- Location: tests\09-contable.spec.js:568:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Totales de cobranza del período' }).getByText('Faltante', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('region', { name: 'Totales de cobranza del período' }).getByText('Faltante', { exact: true })

```

```yaml
- banner:
  - strong: RH Negativo
  - text: Sistema de Gestión Ingresos
  - button "Abrir configuración"
  - button "Abrir perfil"
  - button "Cerrar sesión"
- complementary:
  - button "RH Negativo Sistema de Gestión"
  - navigation "Navegación principal":
    - link "Administración":
      - /url: /panel
    - button "Socios"
    - link "Cuotas":
      - /url: /cuotas
    - button "Categorías"
    - button "Contabilidad" [expanded]
- main:
  - article:
    - heading "Ingresos" [level=1]
    - tablist "Tipo de ingreso":
      - tab "Socios" [selected]
      - tab "Otros ingresos"
    - text: Vista
    - tablist "Vista":
      - tab "Detalle"
      - tab "Detalle de socios"
      - tab "Detalle de cobranza" [selected]
    - combobox "Año":
      - option "2026" [selected]
      - option "2025"
    - text: Año
    - combobox "Período":
      - option "1 Y 2"
      - option "3 Y 4"
      - option "5 Y 6"
      - option "7 Y 8" [selected]
      - option "9 Y 10"
      - option "11 Y 12"
      - option "CONTADO ANUAL"
    - text: Período
    - region "Totales de cobranza del período":
      - article:
        - text: Cuotas recaudadas
        - strong: $ 2.326.006,25
        - text: Solo pagos de cuotas
      - article:
        - text: Inscripciones recaudadas
        - strong: $ 60.690
        - text: "8 socios · Total ingresado: $ 2.386.696,25"
      - article:
        - text: Cuotas esperadas
        - strong: $ 9.781.022,52
        - text: Año 2026
      - article:
        - text: Faltante / Superávit de cuotas
        - strong: $ 7.455.016,27
        - text: Cuotas esperadas menos cuotas recaudadas
    - table "Detalle de cobranza":
      - row "Período Esperado Recaudado Socios Dif. (Esp-Rec)":
        - columnheader "Período"
        - columnheader "Esperado"
        - columnheader "Recaudado"
        - columnheader "Socios"
        - columnheader "Dif. (Esp-Rec)"
      - rowgroup:
        - row "PERÍODO 7 Y 8 $ 9.781.022,52 $ 2.326.006,25 1.648 $ 7.455.016,27"
        - row "COBRADOR $ 8.767.022,52 $ 1.926.006,25 1.478 $ 6.841.016,27"
        - row "ACTIVO $ 3.799.200 $ 845.000 633 $ 2.954.200"
        - row "PASIVO $ 4.955.822,52 $ 1.081.006,25 843 $ 3.874.816,27"
        - row "SIN ESTADO $ 12.000 $ 0 2 $ 12.000"
        - row "OFICINA $ 1.014.000 $ 400.000 169 $ 614.000"
        - row "ACTIVO $ 408.000 $ 206.000 68 $ 202.000"
        - row "TRANSFERENCIA — $ 194.000 20 —"
        - row "EFECTIVO — $ 12.000 2 —"
        - row "PASIVO $ 606.000 $ 194.000 101 $ 412.000"
        - row "TRANSFERENCIA — $ 131.000 19 —"
        - row "EFECTIVO — $ 63.000 6 —"
        - row "PW E2E COB HDKSZJSJ $ 0 $ 0 1 $ 0"
        - row "SIN ESTADO $ 0 $ 0 1 $ 0"
        - row "Inscripciones — $ 60.690 8 —"
        - row "TOTAL CUOTAS $ 9.781.022,52 $ 2.326.006,25 1.648 $ 7.455.016,27"
        - row "TOTAL INSCRIPCIONES — $ 60.690 8 —"
        - row "TOTAL INGRESADO — $ 2.386.696,25 — —"
    - region "Categorías de monto":
      - article: "A Anual: $ 25.000 · Monto por período $ 6.000"
      - article: "B Anual: $ 50.000 · Monto por período $ 8.000"
      - article: "PW EE CAT BBMKLFEDNF Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT DZUNLBBDSU Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT EVSIGRKJNA Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT FGOTWEFPJM Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT FLKOICULXL Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT GCMBFJWXRR Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT HDKSZJSJ Anual: $ 18.000,75 · Monto por período $ 2.100,25"
      - article: "PW EE CAT HYBKULUPCZ Anual: $ 42.000 · Monto por período $ 7.654,75"
      - article: "PW EE CAT IDBCZCOUSG Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT IFBJOKLUIF Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT IJDMEVMQVY Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT IQYXMAKTKHKW EDITADA Anual: $ 17.000,25 · Monto por período $ 1.789,45"
      - article: "PW EE CAT JDBJCJVD Anual: $ 0 · Monto por período $ 0"
      - article: "PW EE CAT JGASGQGYPQ Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT JMNKHZKIRN Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT JOMQIVBBTB Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT KAVZUQHCML Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT KTYVZFNKLY Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT LWRMJNVFRH Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT MBCFVDWOBH Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT MBRKVDGJYI Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT MLGFWXNIJL Anual: $ 24.000,5 · Monto por período $ 5.099,02"
      - article: "PW EE CAT MVBYEHNWJR Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT MXSCMFZEBW Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT NQOGBYCMYS Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT NRDSFNPNOC Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT OERJDMEVVA Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT PCCUYFAHIM Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT PKPJPDIQKP Anual: $ 51.000 · Monto por período $ 8.765,5"
      - article: "PW EE CAT QLNAUHDRFD Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT QLUHBTARRE Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT QRQOJPHXAN Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT RJSUNMUMPW Anual: $ 25.000 · Monto por período $ 4.321,25"
      - article: "PW EE CAT SHDGYDGCOT Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT SSEPXLYMJA Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT TDZNELEMWJ Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT TIBURGONPQ Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT TUIZLZOCCM Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT UKSTUVRCFZ Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT UQJLIVFKWB Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT VKICZTWPBY Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT WARAVIMQNJ Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT WPSCSMSVPT Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT WQDOYXCCFA Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT WVNHBJOWMJ Anual: $ 48.000 · Monto por período $ 8.123,45"
      - article: "PW EE CAT XBWYGJLYHI Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT XEFQMIQEVL Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT XYBOYPFERFEW Anual: $ 12.000 · Monto por período $ 1.234,56"
      - article: "PW EE CAT ZGNJNLNLBZ Anual: $ 24.000,5 · Monto por período $ 4.321,25"
      - article: "PW EE CAT ZRUHDPEAPK Anual: $ 24.000,5 · Monto por período $ 4.321,25"
    - button "Exportar"
    - button "Balance anual"
```

# Test source

```ts
  657 |       exactIdReport.detalle.items.every((item) => Number(item.id_socio) === Number(quotaSocio.item.id_socio)),
  658 |       'El filtro ID de Contabilidad debe ser igualdad exacta y no una coincidencia textual',
  659 |     ).toBe(true);
  660 |     const missingIdReport = await apiCall(request, 'contable_ingresos_socios', {
  661 |       params: { anio: year, periodo: period, pagina: 1, id_socio: 2147483647 },
  662 |     });
  663 |     expect(missingIdReport.detalle.items).toHaveLength(0);
  664 |     const wrongFeeCategory = await apiCall(request, 'contable_ingresos_socios', {
  665 |       params: { anio: year, periodo: period, pagina: 1, buscar: quotaSocio.data.dni, categoria: 2147483647 },
  666 |     });
  667 |     expect(wrongFeeCategory.detalle.items).toHaveLength(0);
  668 |     const wrongFeeMedium = await apiCall(request, 'contable_ingresos_socios', {
  669 |       params: { anio: year, periodo: period, pagina: 1, buscar: quotaSocio.data.dni, medio: 2147483647 },
  670 |     });
  671 |     expect(wrongFeeMedium.detalle.items).toHaveLength(0);
  672 | 
  673 |     await page.goto('/contable/ingresos');
  674 |     await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
  675 |     await page.getByLabel('Año').selectOption(String(year));
  676 |     await page.getByLabel('Período', { exact: true }).selectOption(String(period));
  677 | 
  678 |     const segmented = page.getByRole('tablist', { name: 'Vista' });
  679 |     await segmented.getByRole('tab', { name: 'Detalle', exact: true }).click();
  680 |     const incomeTable = page.getByRole('table', { name: 'Detalle de cobros recibidos' });
  681 |     await expect(incomeTable).toBeVisible();
  682 |     await expect(incomeTable.getByRole('columnheader', { name: 'Tipo', exact: true })).toBeVisible();
  683 | 
  684 |     const e2eSearch = page.getByRole('textbox', { name: 'Socio', exact: true });
  685 |     await Promise.all([
  686 |       page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('buscar=')),
  687 |       e2eSearch.fill(quotaSocio.data.dni),
  688 |     ]);
  689 |     const customQuotaRow = incomeTable.getByRole('row')
  690 |       .filter({ hasText: quotaSocio.data.nombre })
  691 |       .filter({ has: page.locator('.mov-gridCell:nth-child(2) .mov-categoryChip').filter({ hasText: /^CUOTA$/ }) });
  692 |     await expect(customQuotaRow).toBeVisible();
  693 |     await expect(customQuotaRow).toContainText('Descuento personalizado');
  694 |     await expect(incomeTable.getByRole('row').filter({ hasText: quotaSocio.data.nombre }).filter({ has: page.locator('.mov-gridCell:nth-child(2) .mov-categoryChip').filter({ hasText: /^INSCRIPCIÓN$/ }) })).toBeVisible();
  695 |     await Promise.all([
  696 |       page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && !response.url().includes('buscar=')),
  697 |       e2eSearch.fill(''),
  698 |     ]);
  699 | 
  700 |     const e2eIdSearch = page.getByRole('textbox', { name: 'ID', exact: true });
  701 |     await Promise.all([
  702 |       page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes(`id_socio=${quotaSocio.item.id_socio}`)),
  703 |       e2eIdSearch.fill(String(quotaSocio.item.id_socio)),
  704 |     ]);
  705 |     await expect(incomeTable.getByRole('row').filter({ hasText: quotaSocio.data.nombre }).filter({ has: page.locator('.mov-gridCell:nth-child(2) .mov-categoryChip').filter({ hasText: /^CUOTA$/ }) })).toBeVisible();
  706 |     await expect(incomeTable.getByRole('row').filter({ hasText: quotaSocio.data.nombre }).filter({ has: page.locator('.mov-gridCell:nth-child(2) .mov-categoryChip').filter({ hasText: /^INSCRIPCIÓN$/ }) })).toBeVisible();
  707 |     const unrelatedIncome = (apiReport.detalle.items || []).find(
  708 |       (item) => Number(item.id_socio) !== Number(quotaSocio.item.id_socio) && item.socio,
  709 |     );
  710 |     if (unrelatedIncome) {
  711 |       await expect(incomeTable.getByRole('row').filter({ hasText: unrelatedIncome.socio })).toHaveCount(0);
  712 |     }
  713 |     await Promise.all([
  714 |       page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && !response.url().includes('id_socio=')),
  715 |       e2eIdSearch.fill(''),
  716 |     ]);
  717 | 
  718 |     if (apiReport.detalle.items[0]?.socio) {
  719 |       const search = page.getByRole('textbox', { name: 'Socio', exact: true });
  720 |       await expect(search).toBeVisible();
  721 |       await Promise.all([
  722 |         page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('buscar=')),
  723 |         search.fill(apiReport.detalle.items[0].socio),
  724 |       ]);
  725 |       await Promise.all([
  726 |         page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && !response.url().includes('buscar=')),
  727 |         search.fill(''),
  728 |       ]);
  729 |     }
  730 | 
  731 |     if (Number(apiReport.detalle.paginacion.total_paginas) > 1) {
  732 |       await Promise.all([
  733 |         page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('pagina=2')),
  734 |         page.getByRole('button', { name: 'Siguiente', exact: true }).click(),
  735 |       ]);
  736 |       await expect(page.getByText(/101/).first()).toBeVisible();
  737 |       await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  738 |     }
  739 | 
  740 |     await segmented.getByRole('tab', { name: /Detalle de socios/i }).click();
  741 |     await expect(page.getByRole('columnheader', { name: 'Estado' })).toBeVisible();
  742 |     const partnerTotals = page.getByRole('region', { name: 'Totales de socios por estado' });
  743 |     await expect(partnerTotals).toBeVisible();
  744 |     await expect(partnerTotals.getByText('Total activos', { exact: true })).toBeVisible();
  745 |     await expect(partnerTotals.getByText('Total pasivos', { exact: true })).toBeVisible();
  746 |     await expect(partnerTotals.getByText('Total general', { exact: true })).toBeVisible();
  747 | 
  748 |     await segmented.getByRole('tab', { name: /Detalle de cobranza/i }).click();
  749 |     const collectionTotals = page.getByRole('region', { name: 'Totales de cobranza del período' });
  750 |     await expect(collectionTotals).toBeVisible();
  751 |     await expect(collectionTotals.getByText('Cuotas recaudadas', { exact: true })).toBeVisible();
  752 |     await expect(collectionTotals.getByText('Inscripciones recaudadas', { exact: true })).toBeVisible();
  753 |     await expect(collectionTotals.getByText('Cuotas esperadas', { exact: true })).toBeVisible();
  754 |     const expectedDifferenceLabel = Number(apiReport.cobranza?.resumen?.diferencia_cuotas || 0) >= 0
  755 |       ? 'Faltante'
  756 |       : 'Superávit';
> 757 |     await expect(collectionTotals.getByText(expectedDifferenceLabel, { exact: true })).toBeVisible();
      |                                                                                        ^ Error: expect(locator).toBeVisible() failed
  758 | 
  759 |     await segmented.getByRole('tab', { name: 'Detalle', exact: true }).click();
  760 |     await exportFromGlobalModal(page, {
  761 |       openButton: page.getByRole('button', { name: 'Exportar', exact: true }),
  762 |       format: 'Excel',
  763 |       scope: 'registros visibles|esta página',
  764 |       expectedExtension: '.xlsx',
  765 |     });
  766 |     await exportFromGlobalModal(page, {
  767 |       openButton: page.getByRole('button', { name: 'Exportar', exact: true }),
  768 |       format: 'PDF',
  769 |       scope: 'registros visibles|esta página',
  770 |       expectedExtension: '.pdf',
  771 |     });
  772 | 
  773 |     await Promise.all([
  774 |       page.waitForResponse((response) => response.url().includes('action=contable_ingresos_socios') && response.url().includes('periodo=7')),
  775 |       page.getByLabel('Período', { exact: true }).selectOption('7'),
  776 |     ]);
  777 |     await expect(page.getByLabel('Período', { exact: true })).toHaveValue('7');
  778 |     await expect(page.getByLabel('Período', { exact: true }).locator('option:checked')).toHaveText('CONTADO ANUAL');
  779 |     await segmented.getByRole('tab', { name: 'Detalle', exact: true }).click();
  780 | 
  781 |     const annualApi = await apiCall(request, 'contable_ingresos_socios', {
  782 |       params: { anio: year, periodo: 7, pagina: 1 },
  783 |     });
  784 |     expect(Number(annualApi.periodo.id_periodo)).toBe(7);
  785 | 
  786 |     await page.getByRole('button', { name: 'Balance anual' }).click();
  787 |     const balance = page.locator('[role="dialog"].ct-balance-modal');
  788 |     await expect(balance).toBeVisible();
  789 |     await Promise.all([
  790 |       page.waitForResponse((response) => response.url().includes('action=contable_balance')),
  791 |       balance.getByRole('button', { name: 'Generar balance' }).click(),
  792 |     ]);
  793 |     await expect(balance.getByRole('button', { name: 'Actualizar balance' })).toBeVisible();
  794 | 
  795 |     // El buscador interno del Balance también es un filtro funcional: usamos el
  796 |     // socio E2E garantizado, que adeuda otros períodos del año, para probar
  797 |     // inclusión, exclusión y reset sin depender de datos reales preexistentes.
  798 |     await balance.getByRole('tab', { name: 'Deudores por período', exact: true }).click();
  799 |     const balanceSearch = balance.getByRole('searchbox', { name: 'Buscar', exact: true });
  800 |     await balanceSearch.fill(quotaSocio.data.dni);
  801 |     await expect(balance.getByRole('row').filter({ hasText: quotaSocio.data.nombre }).first()).toBeVisible();
  802 |     await balanceSearch.fill('PW E2E SIN COINCIDENCIA BALANCE');
  803 |     await expect(balance.getByRole('row').filter({ hasText: quotaSocio.data.nombre })).toHaveCount(0);
  804 |     await balanceSearch.fill('');
  805 |     await expect(balanceSearch).toHaveValue('');
  806 |     // Con el filtro vacío el balance vuelve a la colección completa, pero la UI
  807 |     // pagina visualmente los primeros 100 deudores. El socio E2E puede quedar
  808 |     // fuera de ese primer bloque aunque el reset haya funcionado correctamente.
  809 |     // Validamos el reset por la reaparición de resultados y, si existe el botón,
  810 |     // cargamos el resto antes de volver a exigir la fila E2E concreta.
  811 |     await expect.poll(async () => balance.getByRole('row').count()).toBeGreaterThan(1);
  812 |     const loadAllDebts = balance.getByRole('button', { name: 'Cargar todos', exact: true });
  813 |     if (await loadAllDebts.isVisible().catch(() => false)) {
  814 |       await loadAllDebts.click();
  815 |       await expect(balance.getByRole('row').filter({ hasText: quotaSocio.data.nombre }).first()).toBeVisible();
  816 |     }
  817 | 
  818 |     for (const format of ['Excel', 'PDF']) {
  819 |       await exportFromGlobalModal(page, {
  820 |         openButton: balance.getByRole('button', { name: 'Exportar pestaña actual', exact: true }),
  821 |         format,
  822 |         expectedExtension: format === 'Excel' ? '.xlsx' : '.pdf',
  823 |       });
  824 |       await exportFromGlobalModal(page, {
  825 |         openButton: balance.getByRole('button', { name: 'Exportar todas las pestañas', exact: true }),
  826 |         format,
  827 |         expectedExtension: format === 'Excel' ? '.xlsx' : '.pdf',
  828 |       });
  829 |     }
  830 | 
  831 |     await balance.getByRole('button', { name: 'Cerrar' }).click();
  832 |     await deletePayment(request, guaranteedPayment.items[0].id_pago);
  833 |   });
  834 | 
  835 |   test('Otros ingresos UI registra, edita, filtra, exporta y elimina un movimiento real E2E', async ({ page, request }) => {
  836 |     const names = contableNames('UIINCOME');
  837 |     const options = await createIncomeOptions(request, names);
  838 |     options.wrongCategory = await createOption(request, 'CATEGORIA_INGRESO', `${names.incomeCategory} OTRO`);
  839 |     const { medium } = await baseCatalogs(request);
  840 |     const wrongMediumDefinition = configValues().medios_pago;
  841 |     const wrongMediumResponse = await apiCall(request, 'configuracion_lista_guardar', {
  842 |       method: 'POST', data: { lista: 'medios_pago', nombre: wrongMediumDefinition.nombre },
  843 |     });
  844 |     const wrongMediumId = Number(wrongMediumResponse.item.id_medio_pago);
  845 |     const { year, month } = dateParts();
  846 |     let incomeId = null;
  847 | 
  848 |     try {
  849 |       await page.goto('/contable/ingresos');
  850 |       await page.getByRole('tab', { name: 'Otros ingresos', exact: true }).click();
  851 |       await page.getByLabel('Año').selectOption(String(year));
  852 |       await page.getByLabel('Mes').selectOption(String(month));
  853 |       await page.getByRole('button', { name: 'Registrar ingreso' }).click();
  854 | 
  855 |       let dialog = page.getByRole('dialog', { name: 'Registrar ingreso' });
  856 |       await dialog.getByLabel('Medio de pago *').selectOption(String(medium.id_medio_pago));
  857 |       await dialog.getByLabel('Persona / proveedor *').selectOption(String(options.provider.id_opcion));
```