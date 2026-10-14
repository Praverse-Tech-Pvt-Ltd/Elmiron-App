import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Label } from './Text';
import { t, useLanguage } from './i18n';

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

/** The label under sample figures — a function, so it is read in the current language. */
export const sampleFiguresNote = (): string => t('ai.sampleFigures');

const styles = StyleSheet.create({
  group: { gap: tokens.space.xs },
});

export const AiAllowanceNotice = ({ allowance, sample }: AiAllowanceNoticeProps): ReactNode => {
  useLanguage();
  if (allowance.kind === 'not_reported') return null;

  const banner =
    allowance.kind === 'warning' ? (
      <Banner
        detail={
          allowance.resetLabel === null
            ? t('ai.warningResetUnknown')
            : t('ai.warningResetsAt', { time: allowance.resetLabel })
        }
        title={t('ai.warningTitle', { used: allowance.used, limit: allowance.limit })}
        tone="attention"
      />
    ) : (
      <Banner
        detail={
          allowance.resetLabel === null
            ? t('ai.limitResetUnknown')
            : t('ai.limitResetsAt', { time: allowance.resetLabel })
        }
        title={t('ai.limitTitle')}
        tone="critical"
      />
    );

  return (
    <View style={styles.group}>
      {banner}
      {sample ? <Label muted>{sampleFiguresNote()}</Label> : null}
    </View>
  );
};
