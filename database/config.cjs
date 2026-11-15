const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function required(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function configuration() {
  const port = Number(process.env.POSTGRES_PORT ?? 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT must be an integer between 1 and 65535');
  }

  return {
    username: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD'),
    database: required('POSTGRES_DB'),
    host: process.env.POSTGRES_HOST?.trim() || 'localhost',
    port,
    dialect: 'postgres',
    logging: false,
    migrationStorage: 'sequelize',
    migrationStorageTableName: 'sequelize_meta',
    pool: {
      max: 1,
      min: 0,
      acquire: 30_000,
      idle: 10_000,
    },
  };
}

module.exports = {
  development: configuration(),
  test: configuration(),
  production: configuration(),
};
