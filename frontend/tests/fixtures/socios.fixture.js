const { digitsFromSuffix, lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');

function socioData(label = 'SOCIO') {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 12);
  return {
    suffix,
    nombre: `PW E2E SOCIO ${label} ${text}`,
    nombreEditado: `PW E2E SOCIO ${label} ${text} EDITADO`,
    dni: `9${digitsFromSuffix(suffix, 7)}`.slice(0, 8),
    movil: `351${digitsFromSuffix(`${suffix}-movil`, 7)}`,
    fijo: `3564${digitsFromSuffix(`${suffix}-fijo`, 6)}`,
    observaciones: `PW E2E SOCIO ${label} CREADO POR PLAYWRIGHT ${text}`,
  };
}

function familyData() {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 12);
  return {
    nombre: `PW E2E FAM ${text}`,
    nombreEditado: `PW E2E FAM ${text} EDITADA`,
    descripcion: `PW E2E FAM OBSERVACION ${text}`,
  };
}

module.exports = { familyData, socioData };
