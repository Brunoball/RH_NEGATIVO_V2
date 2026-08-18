const { lettersFromSuffix, uniqueSuffix } = require('../helpers/data.helper');

function configValues() {
  const suffix = uniqueSuffix();
  const letters = lettersFromSuffix(suffix, 8);
  const short = letters.slice(0, 4);
  return {
    categoria: {
      nombre: `PW EE CAT ${letters}`,
      editado: `PW EE CAT ${letters} EDITADA`,
      payload: { monto_mensual: '2100.25', monto_anual: '18000.75' },
      editPayload: { monto_mensual: '2200.50', monto_anual: '19000.25' },
      idField: 'id_categoria',
    },
    cobrador: {
      nombre: `PW E2E COB ${letters}`,
      editado: `PW E2E COB ${letters} EDITADO`,
      payload: {}, editPayload: {}, idField: 'id_cobrador',
    },
    estado: {
      nombre: `PW E2E EST ${letters.slice(0, 6)}`,
      editado: `PW E2E EST ${letters.slice(0, 4)} X`,
      payload: {}, editPayload: {}, idField: 'id_estado',
    },
    grupo_sanguineo: {
      nombre: `PWE2E-${short}`.slice(0, 10),
      editado: `PWE2E+${short}`.slice(0, 10),
      payload: {}, editPayload: {}, idField: 'id_grupo_sanguineo',
    },
    medios_pago: {
      nombre: `PW E2E MED ${letters}`,
      editado: `PW E2E MED ${letters} EDITADO`,
      payload: {}, editPayload: {}, idField: 'id_medio_pago',
    },
    periodo: {
      nombre: `PW E2E PER ${letters}`,
      editado: `PW E2E PER ${letters} EDITADO`,
      payload: { meses: `PW E2E MESES ${letters}` },
      editPayload: { meses: `PW E2E MESES EDITADO ${letters}` },
      idField: 'id_periodo',
    },
  };
}

function userData(role = 'vista') {
  const suffix = uniqueSuffix().toLowerCase();
  const username = `pw_e2e_user_${suffix}`;
  const password = `PwE2E!${suffix.slice(-10)}A9`;
  return {
    usuario: username,
    usuarioEditado: `${username}_edit`,
    email: `${username}@example.test`,
    emailEditado: `${username}_edit@example.test`,
    rol: role,
    contrasena: password,
    confirmar_contrasena: password,
  };
}

module.exports = { configValues, userData };
