const { lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');

function categoryData() {
  const suffix = uniqueSuffix();
  const textSuffix = lettersFromSuffix(suffix);
  return {
    suffix,
    textSuffix,
    prefix: 'PW EE CAT ',
    nombre: `PW EE CAT ${textSuffix}`,
    nombreEditado: `PW EE CAT ${textSuffix} EDITADA`,
    descripcion: 'CATEGORÍA CREADA POR PLAYWRIGHT',
    descripcionEditada: 'CATEGORÍA EDITADA Y AUDITADA POR PLAYWRIGHT',
    montoInicial: '1234.56',
    montoEditado: '1789.45',
  };
}

function discountData(thresholds = [49, 50]) {
  const [firstThreshold, secondThreshold] = [...thresholds]
    .map(Number)
    .sort((a, b) => a - b);

  return {
    thresholds: [firstThreshold, secondThreshold],
    vigenciaDesde: '2000-01-01',
    vigenciaHasta: '2000-12-31',
    first: {
      desde: firstThreshold,
      hasta: firstThreshold,
      porcentaje: '91.37',
      porcentajeEditado: '93.59',
      descripcion: 'PW E2E DESCUENTO GLOBAL UNO',
    },
    second: {
      desde: secondThreshold,
      hasta: null,
      porcentaje: '92.48',
      descripcion: 'PW E2E DESCUENTO GLOBAL DOS',
    },
  };
}

module.exports = { categoryData, discountData };
