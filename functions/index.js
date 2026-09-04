const { initializeApp } = require('firebase-admin/app');
initializeApp();

module.exports = {
  ...require('./src/rocket'),
  ...require('./src/whoami'),
  ...require('./src/profile'),
  ...require('./src/admin'),
};
