const { lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');
const { socioData, familyData } = require('./socios.fixture');

function cuotaSocioData(label = 'CUOTA') {
  return socioData(`CUOTA ${label}`);
}

function cuotaFamilyData() {
  return familyData();
}

function cuotaCategoryData() {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 10);
  return {
    nombre: `PW EE CAT ${text}`,
    mensual: '4321.25',
    anual: '24000.50',
  };
}

module.exports = { cuotaCategoryData, cuotaFamilyData, cuotaSocioData };
