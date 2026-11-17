import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { MailService } from '../mail.service';
import type { PrismaService } from '../prisma.service';
import { hashPortalToken, PortalController, portalOrigin, requirePortalOrigin } from './portal.controller';

const token = randomBytes(32).toString('base64url');
const member = { id: 'member', email: 'worker@example.test', name: 'Worker', role: 'employee', active: true };
const request = (cookie?: string) => ({
  cookies: { ns_portal: cookie }, get: () => portalOrigin(),
} as unknown as Request);
const makeController = (db: object, mail: object = {}) =>
  new PortalController(db as PrismaService, mail as MailService);

test('portal writes reject missing and unrelated origins', () => {
  assert.doesNotThrow(() => requirePortalOrigin(portalOrigin()));
  assert.throws(() => requirePortalOrigin(undefined), ForbiddenException);
  assert.throws(() => requirePortalOrigin('https://example.test'), ForbiddenException);
});

test('only active, unexpired company sessions can sign in; employees cannot list accounts', async () => {
  let active = true;
  let expires = Date.now() + 60_000;
  const controller = makeController({
    portalSession: { findUnique: async ({ where }: { where: { token_hash: string } }) => {
      assert.equal(where.token_hash, hashPortalToken(token));
      return { member: { ...member, active }, expires_at: new Date(expires) };
    } },
    portalMember: { findMany: async () => assert.fail('account list queried by an employee') },
  });
  await assert.rejects(controller.me(request()), UnauthorizedException);
  assert.deepEqual(await controller.me(request(token)), { email: member.email, name: member.name, role: member.role });
  await assert.rejects(controller.members(request(token)), ForbiddenException);
  active = false;
  await assert.rejects(controller.me(request(token)), UnauthorizedException);
  active = true;
  expires = Date.now() - 60_000;
  await assert.rejects(controller.me(request(token)), UnauthorizedException);
});

test('sign-in links are consumed once and generate a separate, HttpOnly session', async () => {
  let liveHash: string | null = hashPortalToken(token);
  let sessionHash: string | null = null;
  const db = {
    portalMember: {
      findUnique: async () => member,
      updateMany: async ({ where }: { where: { link_hash: string } }) => {
        if (liveHash !== where.link_hash) return { count: 0 };
        liveHash = null;
        return { count: 1 };
      },
    },
    portalSession: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: { token_hash: string } }) => { sessionHash = data.token_hash; },
    },
  };
  const controller = makeController({ $transaction: (work: (tx: typeof db) => unknown) => work(db) });
  const res = { cookie: (name: string, value: string, options: { httpOnly: boolean; sameSite: string }) => {
    assert.equal(name, 'ns_portal');
    assert.notEqual(value, token);
    assert.equal(hashPortalToken(value), sessionHash);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'strict');
  } } as unknown as Response;
  await controller.redeem(request(), res, { token });
  await assert.rejects(controller.redeem(request(), res, { token }), UnauthorizedException);
});

test('unknown addresses receive the same response without triggering an email', async () => {
  let count = 0;
  let sent = 0;
  const controller = makeController({
    portalMember: { updateMany: async () => ({ count }) },
  }, {
    canSendPortalMail: () => true,
    sendPortalLink: async () => { sent++; },
  });
  const absent = await controller.requestLink(request(), { email: member.email });
  assert.equal(sent, 0);
  count = 1;
  assert.deepEqual(await controller.requestLink(request(), { email: member.email }), absent);
  assert.equal(sent, 1);
});
