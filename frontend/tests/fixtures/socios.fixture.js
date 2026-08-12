const { digitsFromSuffix, lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');

function personData() {
  const suffix = uniqueSuffix();
  const textSuffix = lettersFromSuffix(suffix);
  return {
    suffix,
    textSuffix,
    apellido: `PW EE APELLIDO ${textSuffix}`,
    nombre: `NOMBRE ${textSuffix}`,
    nombreEditado: `NOMBRE EDITADO ${textSuffix}`,
    dni: `9${digitsFromSuffix(suffix, 7)}`.slice(0, 8),
    email: `pw.socio.${suffix.toLowerCase()}@example.test`,
    telefono: `351${digitsFromSuffix(suffix, 7)}`,
  };
}

function companyData() {
  const suffix = uniqueSuffix();
  return {
    suffix,
    razonSocial: `PW E2E EMPRESA ${suffix}`,
    razonSocialEditada: `PW E2E EMPRESA EDITADA ${suffix}`,
    cuit: `30${digitsFromSuffix(suffix, 8)}1`.slice(0, 11),
    email: `pw.empresa.${suffix.toLowerCase()}@example.test`,
    telefono: `354${digitsFromSuffix(suffix, 7)}`,
  };
}

function familyData() {
  const suffix = uniqueSuffix();
  const textSuffix = lettersFromSuffix(suffix);
  return {
    suffix,
    textSuffix,
    prefix: `PW EE FAM ${textSuffix}`,
    nombre: `PW EE FAM ${textSuffix}`,
    nombreEditado: `PW EE FAM ${textSuffix} EDITADA`,
    descripcion: `FAMILIA CREADA POR PLAYWRIGHT ${textSuffix}`,
  };
}

module.exports = { companyData, familyData, personData };
