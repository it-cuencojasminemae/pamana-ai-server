'use strict';
// Explicitly targets a self-registered disposable localhost acceptance account.
// It cannot edit an existing operational user or any transport data.
const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const [username, action] = process.argv.slice(2);
assert.match(username || '', /^phase24-browser-[0-9-]+$/);
assert.ok(['Passenger', 'Driver', 'LGU', 'Administrator', 'cleanup'].includes(action));
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  try {
    const query = app.db.query('plugin::users-permissions.user');
    const user = await query.findOne({ where: { username } });
    assert.ok(user && user.email === `${username}@example.test` && user.provider === 'local');
    const manager = app.sessionManager('users-permissions');
    await manager.invalidateRefreshToken(String(user.id));
    if (action === 'cleanup') {
      await app.db.query('api::passenger-profile.passenger-profile').deleteMany({ where: { user: { id: user.id } } });
      await query.delete({ where: { id: user.id } });
    } else {
      const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { name: action } });
      assert.ok(role);
      await query.update({ where: { id: user.id }, data: { role: role.id } });
    }
    console.log(`ok - disposable acceptance account ${action === 'cleanup' ? 'removed' : `set to ${action}`}; no transport records changed`);
  } finally { await app.destroy(); }
})().catch(() => { console.error('FAIL - disposable browser fixture operation failed'); process.exitCode = 1; });
