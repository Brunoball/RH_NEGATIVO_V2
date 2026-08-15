const { digitsFromSuffix, lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');

function socioData(label = 'SOCIO') {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 12);
  return {
    suffix,
    nombre: `PW EEE SOCIO ${label} ${text}`,
    nombreEditado: `PW EEE SOCIO ${label} ${text} EDITADO`,
    dni: `9${digitsFromSuffix(suffix, 7)}`.slice(0, 8),
    movil: `351${digitsFromSuffix(`${suffix}-movil`, 7)}`,
    fijo: `3564${digitsFromSuffix(`${suffix}-fijo`, 6)}`,
    observaciones: `PW EEE SOCIO ${label} CREADO POR PLAYWRIGHT ${text}`,
  };
}

function familyData() {
  const suffix = uniqueSuffix();
  const text = lettersFromSuffix(suffix, 12);
  return {
    nombre: `PW EEE FAM ${text}`,
    nombreEditado: `PW EEE FAM ${text} EDITADA`,
    descripcion: `PW EEE FAM OBSERVACION ${text}`,
  };
}

module.exports = { familyData, socioData };
