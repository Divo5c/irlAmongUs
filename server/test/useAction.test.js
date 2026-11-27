const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('Use prefers either table over tasks only for impostors', async () => {
  const source = readFileSync(path.join(__dirname, '../public/js/useAction.js'), 'utf8');
  const { chooseUseAction } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const task = { kind: 'TASK' };
  const admin = { kind: 'ADMIN_TABLE' };
  const emergency = { kind: 'EMERGENCY' };
  assert.equal(chooseUseAction('IMPOSTOR', task, admin, emergency), admin);
  assert.equal(chooseUseAction('IMPOSTOR', task, null, emergency), emergency);
  assert.equal(chooseUseAction('IMPOSTOR', task, null, null), task);
  assert.equal(chooseUseAction('CREWMATE', task, admin, emergency), task);
  assert.equal(chooseUseAction('CREWMATE', null, admin, emergency), admin);
  assert.equal(chooseUseAction('CREWMATE', null, null, emergency), emergency);
  assert.equal(chooseUseAction('CREWMATE', null, null, null), null);
});
