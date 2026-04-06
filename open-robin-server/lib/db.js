/**
 * Database singleton — Knex + better-sqlite3
 *
 * One job: manage the lifecycle of robin.db (init, get, close).
 */

const knex = require('knex');
const path = require('path');
const fs = require('fs');

let instance = null;

/**
 * Initialize the database. Creates ai/system/ if needed, runs migrations.
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Promise<import('knex').Knex>}
 */
async function initDb(projectRoot) {
  if (instance) return instance;

  const systemDir = path.join(projectRoot, 'ai', 'system');
  fs.mkdirSync(systemDir, { recursive: true });

  instance = knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(systemDir, 'robin.db') },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, done) => {
        conn.pragma('foreign_keys = ON');
        done(null, conn);
      },
    },
    migrations: {
      directory: path.join(__dirname, 'db', 'migrations'),
    },
  });

  await instance.migrate.latest();
  return instance;
}

/**
 * Get the initialized Knex instance.
 * @returns {import('knex').Knex}
 */
function getDb() {
  if (!instance) throw new Error('DB not initialized — call initDb() first');
  return instance;
}

/**
 * Close the database connection.
 */
async function closeDb() {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

module.exports = { initDb, getDb, closeDb };
