const { uniqueSuffix } = require('../helpers/data.helper');

function userData() {
  const suffix = uniqueSuffix().toLowerCase();
  return {
    username: `pw_e2e_${suffix}`.slice(0, 35),
    usernameEdited: `pw_e2e_edit_${suffix}`.slice(0, 45),
    email: `pw.${suffix}@example.test`,
    emailEdited: `pw.edit.${suffix}@example.test`,
    password: `Pw!${suffix}1234`,
    newPassword: `Pw!Edit${suffix}5678`,
  };
}

module.exports = { userData };
