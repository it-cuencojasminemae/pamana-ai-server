'use strict';

const assert = require('node:assert/strict');
const { Client } = require('pg');
const { ROLE_PERMISSION_MATRIX, permissionIsManaged } = require('../src/services/security/access-control');

function config() {
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, ssl } : {
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME, user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD, ssl,
  };
}

(async () => {
  const client = new Client(config());
  await client.connect();
  try {
    const { rows } = await client.query(`select r.name, p.action
      from up_roles r
      left join up_permissions_role_lnk link on link.role_id = r.id
      left join up_permissions p on p.id = link.permission_id
      order by r.name, p.action`);
    for (const roleName of ['Public', 'Authenticated', 'Passenger', 'Driver', 'LGU', 'Administrator']) {
      const actual = rows.filter((row) => row.name === roleName && row.action && permissionIsManaged(row.action))
        .map((row) => row.action).sort();
      const expected = [...new Set(ROLE_PERMISSION_MATRIX[roleName] || [])].sort();
      assert.deepEqual(actual, expected, `${roleName} managed permissions do not match Phase 22 matrix`);
    }
    console.log('ok - live Strapi role permissions exactly match the Phase 22 managed matrix');
  } finally { await client.end(); }
})().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
