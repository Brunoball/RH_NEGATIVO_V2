const { lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');

function categoryData() {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 12);
  return {
    nombre: `PW EE CAT ${text}`,
    nombreEditado: `PW EE CAT ${text} EDITADA`,
    mensual: '1234.56',
    anual: '12000.00',
    mensualEditado: '1789.45',
    anualEditado: '17000.25',
  };
}

function discountData() {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 10);
  return {
    descripcion: `PW E2E DESC ${text}`,
    descripcionEditada: `PW E2E DESC ${text} EDITADO`,
    porcentaje: '17.35',
    porcentajeEditado: '19.25',
  };
}

module.exports = { categoryData, discountData };
