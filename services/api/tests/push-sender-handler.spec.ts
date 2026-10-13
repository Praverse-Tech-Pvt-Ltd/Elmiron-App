import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classify,
  parseServiceAccount,
  runPushSender,
  sameSecret,
  signedAssertion,
} from '../supabase/functions/_shared/push-sender.ts';
import type { Fetch, PushOutbox } from '../supabase/functions/_shared/push-sender.ts';

/**
 * `BE-W196` — the `push-sender` function's logic with FCM, Google's token endpoint and the outbox all
 * faked. The database half (what is claimed, what a result does) is `push-notifications.spec.ts`.
 *
 * The key pair is generated here, for this run; it signs nothing anywhere else.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'fieldforce-test',
  client_email: 'push@fieldforce-test.iam.gserviceaccount.com',
  private_key: PEM,
  token_uri: 'https://oauth2.googleapis.com/token',
});
const NOW = 1_800_000_000;

interface Sent {
  readonly url: string;
  readonly body: unknown;
}

/** A fetch fake: the token endpoint answers `oauth`, FCM answers by token from `fcm`. */
const fakeFetch = (
  fcm: Readonly<Record<string, { status: number; body?: unknown } | 'throw'>>,
  oauth: { status: number; body?: unknown } = { status: 200, body: { access_token: 'ya29.test' } },
) => {
  const sent: Sent[] = [];
  const fetchFn: Fetch = (url, init) => {
    if (url.startsWith('https://oauth2.googleapis.com/')) {
      sent.push({ url, body: typeof init.body === 'string' ? init.body : '' });
      return Promise.resolve(
        new Response(JSON.stringify(oauth.body ?? {}), { status: oauth.status }),
      );
    }
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      message: { token: string };
    };
    sent.push({ url, body });
    const answer = fcm[body.message.token] ?? {
      status: 200,
      body: { name: 'projects/x/messages/1' },
    };
    if (answer === 'throw') return Promise.reject(new Error('network down'));
    return Promise.resolve(
      new Response(JSON.stringify(answer.body ?? {}), { status: answer.status }),
    );
  };
  return { fetchFn, sent };
};

const notification = (id: string, tokens: string[]) => ({
  id,
  kind: 'day_plan',
  title: 'Your plan changed',
  body: 'Your manager updated your plan for tomorrow: 3 visits.',
  link: '/beat-plan',
  attempts: 1,
  tokens: tokens.map((token, i) => ({ id: `${id}-t${String(i)}`, token })),
});

const fakeOutbox = (batch: unknown[]) => {
  const recorded: unknown[][] = [];
  let claims = 0;
  const outbox: PushOutbox = {
    claim: () => {
      claims += 1;
      return Promise.resolve(batch);
    },
    record: (results) => {
      recorded.push([...results]);
      return Promise.resolve({ sent: 1, retry: 0, failed: 0, tokensRetired: 0 });
    },
  };
  return { outbox, recorded, claims: () => claims };
};

describe('BE-W196 — not configured is an answer, and nothing is claimed', () => {
  it('no FCM_SERVICE_ACCOUNT: "not configured", the outbox is not touched', async () => {
    const { outbox, claims } = fakeOutbox([notification('n1', ['tok-a'])]);
    const { fetchFn, sent } = fakeFetch({});
    const result = await runPushSender({
      serviceAccountJson: undefined,
      outbox,
      fetch: fetchFn,
      nowSeconds: NOW,
    });
    expect(result).toMatchObject({ configured: false, claimed: 0 });
    expect(result.message).toMatch(/not configured: FCM_SERVICE_ACCOUNT is not set/u);
    expect(claims()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('a malformed secret, or no outbox key: the same, naming what is wrong and never a value', async () => {
    for (const raw of [
      '{not json',
      JSON.stringify({ type: 'authorized_user', private_key: 'SECRET-VALUE' }),
    ]) {
      const result = await runPushSender({
        serviceAccountJson: raw,
        outbox: fakeOutbox([]).outbox,
        fetch: fakeFetch({}).fetchFn,
        nowSeconds: NOW,
      });
      expect(result.configured).toBe(false);
      expect(result.message).not.toContain('SECRET-VALUE');
    }
    const noOutbox = await runPushSender({
      serviceAccountJson: ACCOUNT,
      outbox: null,
      fetch: fakeFetch({}).fetchFn,
      nowSeconds: NOW,
    });
    expect(noOutbox).toMatchObject({ configured: false });
    expect(noOutbox.message).toMatch(/no secret key for the outbox/u);
  });

  it('Google refusing the service account claims nothing', async () => {
    const { outbox, claims } = fakeOutbox([notification('n1', ['tok-a'])]);
    const result = await runPushSender({
      serviceAccountJson: ACCOUNT,
      outbox,
      fetch: fakeFetch({}, { status: 400, body: { error: 'invalid_grant' } }).fetchFn,
      nowSeconds: NOW,
    });
    expect(result).toMatchObject({ configured: true, claimed: 0 });
    expect(result.message).toMatch(/HTTP 400/u);
    expect(claims()).toBe(0);
  });
});

describe('BE-W196 — sending', () => {
  it('the OAuth assertion is RS256, signed by the service account, for the FCM scope', async () => {
    const parsed = parseServiceAccount(ACCOUNT);
    if (!('account' in parsed)) throw new Error('fixture account did not parse');
    const jwt = await signedAssertion(parsed.account, NOW);
    const [header, claims, signature] = jwt.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header ?? ''}.${claims ?? ''}`);
    expect(verifier.verify(publicKey, Buffer.from(signature ?? '', 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      iss: 'push@fieldforce-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: NOW,
      exp: NOW + 3600,
    });
  });

  it('each token gets the fixed text and the in-app link; the outcome is recorded per notification', async () => {
    const { outbox, recorded } = fakeOutbox([notification('n1', ['tok-a', 'tok-b'])]);
    const { fetchFn, sent } = fakeFetch({});
    const result = await runPushSender({
      serviceAccountJson: ACCOUNT,
      outbox,
      fetch: fetchFn,
      nowSeconds: NOW,
    });
    expect(result).toMatchObject({ configured: true, claimed: 1, message: 'batch sent' });
    const fcm = sent.filter((s) => s.url.includes('fcm.googleapis.com'));
    expect(fcm.map((s) => s.url)).toEqual([
      'https://fcm.googleapis.com/v1/projects/fieldforce-test/messages:send',
      'https://fcm.googleapis.com/v1/projects/fieldforce-test/messages:send',
    ]);
    expect(fcm[0]?.body).toEqual({
      message: {
        token: 'tok-a',
        notification: {
          title: 'Your plan changed',
          body: 'Your manager updated your plan for tomorrow: 3 visits.',
        },
        data: { link: '/beat-plan', kind: 'day_plan', notificationId: 'n1' },
        android: { priority: 'NORMAL', notification: { channel_id: 'default' } },
      },
    });
    expect(recorded).toEqual([[{ id: 'n1', outcome: 'sent', error: null, retireTokenIds: [] }]]);
  });

  it('an unregistered token is retired; the notification is still sent through the live one', async () => {
    const { outbox, recorded } = fakeOutbox([notification('n1', ['dead', 'live'])]);
    const { fetchFn } = fakeFetch({
      dead: {
        status: 404,
        body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
      },
    });
    await runPushSender({ serviceAccountJson: ACCOUNT, outbox, fetch: fetchFn, nowSeconds: NOW });
    expect(recorded[0]).toEqual([
      { id: 'n1', outcome: 'sent', error: null, retireTokenIds: ['n1-t0'] },
    ]);
  });

  it('every token dead: failed "no valid device", all retired; busy or unreachable: retry', async () => {
    const { outbox, recorded } = fakeOutbox([
      notification('dead', ['x1']),
      notification('busy', ['x2']),
      notification('down', ['x3']),
    ]);
    const { fetchFn } = fakeFetch({
      x1: {
        status: 400,
        body: {
          error: {
            status: 'INVALID_ARGUMENT',
            message: 'The registration token is not a valid FCM registration token',
          },
        },
      },
      x2: { status: 503 },
      x3: 'throw',
    });
    await runPushSender({ serviceAccountJson: ACCOUNT, outbox, fetch: fetchFn, nowSeconds: NOW });
    expect(recorded[0]).toEqual([
      { id: 'dead', outcome: 'failed', error: 'no valid device', retireTokenIds: ['dead-t0'] },
      { id: 'busy', outcome: 'retry', error: 'FCM busy or unreachable', retireTokenIds: [] },
      { id: 'down', outcome: 'retry', error: 'FCM busy or unreachable', retireTokenIds: [] },
    ]);
  });

  it('FCM refusing OUR credentials stops the run; the rest of the batch goes back as retry', async () => {
    const { outbox, recorded } = fakeOutbox([notification('a', ['t1']), notification('b', ['t2'])]);
    const { fetchFn, sent } = fakeFetch({
      t1: { status: 403, body: { error: { status: 'PERMISSION_DENIED' } } },
    });
    const result = await runPushSender({
      serviceAccountJson: ACCOUNT,
      outbox,
      fetch: fetchFn,
      nowSeconds: NOW,
    });
    expect(result.message).toMatch(/refused our credentials/u);
    expect(sent.filter((s) => s.url.includes('fcm')).length).toBe(1);
    expect(recorded[0]?.map((r) => (r as { outcome: string }).outcome)).toEqual(['retry', 'retry']);
  });

  it('classify: the FCM answers that retire a token, and those that do not', () => {
    expect(classify(200, null)).toBe('delivered');
    expect(classify(404, null)).toBe('retire');
    expect(classify(403, { error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } })).toBe(
      'retire',
    );
    expect(classify(400, { error: { message: 'Invalid JSON payload' } })).toBe('failed');
    expect(classify(401, null)).toBe('credentials');
    expect(classify(429, null)).toBe('retry');
    expect(classify(500, null)).toBe('retry');
  });
});

describe('BE-W196 — the scheduled caller’s secret', () => {
  it('matches only the exact secret, and an unset or short secret matches nothing', () => {
    const secret = 'a'.repeat(40);
    expect(sameSecret(secret, secret)).toBe(true);
    expect(sameSecret(`${secret}x`, secret)).toBe(false);
    expect(sameSecret('a'.repeat(39), secret)).toBe(false);
    expect(sameSecret(null, secret)).toBe(false);
    expect(sameSecret('', undefined)).toBe(false);
    expect(sameSecret('short', 'short')).toBe(false);
  });
});
