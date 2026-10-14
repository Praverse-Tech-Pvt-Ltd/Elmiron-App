import { t } from '@fieldforce/ui/i18n';

/**
 * `FE-W195` — the link "Tell the help desk" opens, built from the build's help-desk settings
 * (`supportEmail`, `supportPhone` in `features.ts`) and what is stuck on the queue.
 *
 * Pure, so what reaches the help desk is tested without a phone. `null` when the build names no
 * help desk: the caller then passes no handler and the button is not drawn.
 */
export interface SupportReference {
  /** What the work is, in the rep's words — "Call report". */
  readonly what: string;
  /** The reference the queue row shows ("Reference: …"), or null when the server sent none. */
  readonly code: string | null;
  /** The queue item's id: the one key the help desk can look the work up by. */
  readonly id: string;
}

export const supportLink = (
  contact: { readonly email: string | null; readonly phone: string | null },
  references: readonly SupportReference[],
): string | null => {
  if (contact.email !== null) {
    const lines = references.map((reference) =>
      t('queue.supportLine', {
        what: reference.what,
        code: reference.code ?? t('queue.supportNoCode'),
        id: reference.id,
      }),
    );
    const body = [t('queue.supportBody'), '', ...lines].join('\n');
    // Encoded as a URI component, so a "&" or "?" in a translated line cannot cut the message short.
    return `mailto:${contact.email}?subject=${encodeURIComponent(t('queue.supportSubject'))}&body=${encodeURIComponent(body)}`;
  }
  if (contact.phone !== null) {
    // Spaces are dropped; a dialler reads the digits and a leading "+".
    return `tel:${contact.phone.replace(/\s+/gu, '')}`;
  }
  return null;
};
