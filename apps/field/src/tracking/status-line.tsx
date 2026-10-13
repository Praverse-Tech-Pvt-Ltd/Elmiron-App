import type { ReactNode } from 'react';
import { Banner } from '@fieldforce/ui';
import { useLiveTracker } from './tracker';

/**
 * `FE-W71` — live location is never silent. Whatever state it is in, this line says so, on Today and
 * on Me, with the way to the notice and the controls. Renders nothing only when the build has live
 * tracking off or the user is not a rep — when there is nothing to be silent about.
 */
export const LiveTrackingStatusLine = ({ onOpen }: { readonly onOpen: () => void }): ReactNode => {
  const tracker = useLiveTracker();
  if (tracker === null) return null;
  const { line } = tracker;
  return (
    <Banner
      tone={line.tone}
      title={line.title}
      {...(line.detail === null ? {} : { detail: line.detail })}
      action={{ label: 'Live location', onPress: onOpen }}
    />
  );
};
