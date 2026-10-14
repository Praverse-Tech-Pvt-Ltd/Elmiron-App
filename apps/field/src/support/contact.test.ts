import { describe, expect, it } from 'vitest';
import { supportLink } from './contact';

/** `FE-W195`. What "Tell the help desk" opens — or that it opens nothing when there is no desk. */
describe('supportLink', () => {
  const stuck = [
    { what: 'Call report', code: 'validation_failed', id: 'aaaa-1' },
    { what: 'Samples left', code: null, id: 'bbbb-2' },
  ];

  it('is null when the build names no help desk, so no button is drawn', () => {
    expect(supportLink({ email: null, phone: null }, stuck)).toBeNull();
  });

  it('opens a message to the help desk carrying every reference, encoded', () => {
    const link = supportLink({ email: 'help@example.com', phone: null }, stuck);
    expect(link).toMatch(/^mailto:help@example\.com\?subject=/u);
    const body = decodeURIComponent(new URL(link ?? '').searchParams.get('body') ?? '');
    expect(body).toContain('Call report');
    expect(body).toContain('validation_failed');
    expect(body).toContain('aaaa-1');
    expect(body).toContain('bbbb-2');
    // Nothing in the body is left raw to break the link.
    expect(link).not.toMatch(/\s/u);
  });

  it('prefers the address over the number: a call cannot carry the codes', () => {
    expect(supportLink({ email: 'help@example.com', phone: '+91 20 1234' }, stuck)).toMatch(
      /^mailto:/u,
    );
  });

  it('dials the number when only a number is set', () => {
    expect(supportLink({ email: null, phone: '+91 20 1234 5678' }, stuck)).toBe(
      'tel:+912012345678',
    );
  });
});
