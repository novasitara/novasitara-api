import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from './password';

test('hash verifies only the right password', async () => {
  const stored = await hashPassword('correct horse');
  assert.notEqual(stored, await hashPassword('correct horse')); // salted
  assert.equal(await verifyPassword('correct horse', stored), true);
  assert.equal(await verifyPassword('wrong', stored), false);
  assert.equal(await verifyPassword('correct horse', 'garbage'), false);
});
