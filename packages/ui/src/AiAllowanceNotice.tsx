import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Label } from './Text';

/**
 * FE-D14 — the daily AI-limit warning.
 *
 * **Every figure is the server's.** `used` and `limit` are `requestsUsedToday` and `dailyLimit`
 * from `ai_begin_request`; `resetLabel` is the server's reset time, already formatted in the
 * territory zone, or null when the server did not send one. This component formats what it is
 * given and supplies no number of its own: with no reset time it says the server has not said,
 * and with no usage at all (`not_reported`) it renders nothing rather than a zero.
 *
 * No design exists for this in `docs/design/`; it is built from `Banner` and the existing tokens.
 */
export type AiAllowanceState =
  | { readonly kind: 'not_reported' }
  | {
      readonly kind: 'warning';
      readonly used: number;
      readonly limit: number;
      readonly resetLabel: string | null;
    }
  | { readonly kind: 'at_limit'; readonly resetLabel: string | null };

export interface AiAllowanceNoticeProps {
  readonly allowance: AiAllowanceState;
  /** True when the figures are sample data rather than the server's. Labelled on screen. */
  readonly sample: boolean;
}

export const SAMPLE_FIGURES_NOTE = 'Sample data, not from the server.';

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
});

export const AiAllowanceNotice = ({ allowance, sample }: AiAllowanceNoticeProps): ReactNode => {
  if (allowance.kind === 'not_reported') return null;

  const banner =
    allowance.kind === 'warning' ? (
      <Banner
        detail={
          allowance.resetLabel === null
            ? 'The server has not said when the allowance resets.'
            : `The allowance resets at ${allowance.resetLabel}.`
        }
        title={`You have used ${String(allowance.used)} of today's ${String(allowance.limit)} assistant requests.`}
        tone="attention"
      />
    ) : (
      <Banner
        detail={
          allowance.resetLabel === null
            ? 'The server has not said when it resets.'
            : `It resets at ${allowance.resetLabel}.`
        }
        title="You have reached today's limit. The assistant is unavailable until it resets."
        tone="critical"
      />
    );

  return (
    <View style={styles.group}>
      {banner}
      {sample ? <Label muted>{SAMPLE_FIGURES_NOTE}</Label> : null}
    </View>
  );
};
