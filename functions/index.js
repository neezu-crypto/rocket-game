const { initializeApp } = require('firebase-admin/app');
initializeApp();

module.exports = {
  ...require('./src/rocket'),
};
