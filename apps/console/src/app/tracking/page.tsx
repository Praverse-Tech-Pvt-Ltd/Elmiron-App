import type { ReactNode } from 'react';
import {
  LIVE_TRACKING_RPC,
  TrackingOverviewSchema,
  TrackingTrailSchema,
  googleMapsUrl,
} from '@fieldforce/core';
import type { TeamRep, TrackingTrail } from '@fieldforce/core';
import { signedIn } from '../../lib/session';
import { Body, Card, Heading, MissingNote, Pill, Title } from '../../lib/ui';
import { TrackingSwitch } from '../../lib/tracking-switch';
import {
  accuracyLabel,
  ageLabel,
  clockIn,
  embedMapUrl,
  trackingRefusal,
} from '../../lib/tracking-text';

/**
 * `FE-W72` / `BE-W180` — live location, for a field manager or an admin.
 *
 * **Nothing here decides who may see whom.** `live_tracking_overview` lists the reps the caller may
 * see — a manager's territory subtree and reporting line, an admin's company — and the trail is a
 * second RPC that checks again. A rep who opens this page is refused by the first call, and the page
 * says so in words.
 *
 * **A list, not a map.** Each position links to Google Maps (`https://www.google.com/maps?q=lat,lng`,
 * no key and nothing but the coordinates in the URL); drawing a map in the console needs the Maps SDK,
 * which is a separate, later item.
 *
 * `FE-W87`: when `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` is set, the chosen rep's newest position is also
 * shown in a Google Maps Embed frame (no library, no new dependency). Unset, nothing changes.
 */
export const dynamic = 'force-dynamic';

const MapLink = ({ latitude, longitude }: { latitude: number; longitude: number }): ReactNode => (
  <a href={googleMapsUrl(latitude, longitude)} rel="noopener noreferrer" target="_blank">
    Open in Google Maps
  </a>
);

const LatestCell = ({ rep }: { rep: TeamRep }): ReactNode =>
  rep.latest === null ? (
    <span className="ff-muted">No position yet</span>
  ) : (
    <span>
      {clockIn(rep.latest.receivedAt, rep.timeZone)} ({ageLabel(rep.latest.ageSeconds)}),{' '}
      {accuracyLabel(rep.latest.accuracyM)} ·{' '}
      <MapLink latitude={rep.latest.latitude} longitude={rep.latest.longitude} />
    </span>
  );

const EmbeddedMap = ({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): ReactNode => {
  const src = embedMapUrl(process.env['NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY'], latitude, longitude);
  return src === null ? null : (
    <iframe
      title="Newest position on a map"
      src={src}
      width="100%"
      height={320}
      className="ff-map"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
};

const Trail = ({ trail }: { trail: TrackingTrail }): ReactNode => {
  const newest = trail.points.at(-1);
  return (
    <Card>
      <Heading>
        {trail.fullName} — {trail.day}
      </Heading>
      {newest === undefined ? null : (
        <EmbeddedMap latitude={newest.latitude} longitude={newest.longitude} />
      )}
      <Body muted>
        Every position kept for this rep on {trail.day}, oldest first, on the rep’s clock (
        {trail.timeZone}). Positions are deleted 90 days after the server received them.
      </Body>
      {trail.points.length === 0 ? (
        <MissingNote tone="info">No position was kept for this rep on this day.</MissingNote>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Phone said</th>
              <th>Accuracy</th>
              <th>Where</th>
            </tr>
          </thead>
          <tbody>
            {trail.points.map((point) => (
              <tr key={point.id}>
                <td>{clockIn(point.receivedAt, trail.timeZone)}</td>
                <td>{clockIn(point.recordedAt, trail.timeZone)}</td>
                <td>{accuracyLabel(point.accuracyM)}</td>
                <td>
                  {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} ·{' '}
                  <MapLink latitude={point.latitude} longitude={point.longitude} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

export default async function Tracking({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly rep?: string }>;
}): Promise<ReactNode> {
  const session = await signedIn();
  if (session === null) {
    return (
      <MissingNote>
        No session reached the server. Signing in again is the first thing to try.
      </MissingNote>
    );
  }

  const header = (
    <div className="ff-page-header-text">
      <Title>Live location</Title>
      <Body muted>
        Where your reps were, during their working hours, after each accepted the live location
        notice and started sharing for the day. The newest position of each rep you may see, and
        today’s positions for the rep you choose.
      </Body>
    </div>
  );
  const page = (children: ReactNode): ReactNode => (
    <div className="ff-page ff-page-medium">
      {header}
      {children}
    </div>
  );

  const overviewResult = await session.db.rpc(LIVE_TRACKING_RPC.overview);
  if (overviewResult.error !== null) {
    return page(<MissingNote tone="critical">{trackingRefusal(overviewResult.error)}</MissingNote>);
  }
  const overview = TrackingOverviewSchema.parse(overviewResult.data);

  const params = await searchParams;
  const selected = overview.reps.find((rep) => rep.mrId === params.rep) ?? null;
  let trail: TrackingTrail | null = null;
  let trailRefusal: string | null = null;
  if (selected !== null) {
    const trailResult = await session.db.rpc(LIVE_TRACKING_RPC.trail, { p_mr_id: selected.mrId });
    if (trailResult.error !== null) trailRefusal = trackingRefusal(trailResult.error);
    else trail = TrackingTrailSchema.parse(trailResult.data);
  }

  return page(
    <>
      {overview.canChangeSwitch ? (
        <TrackingSwitch
          enabled={overview.companyEnabled}
          noticeIsDraft={overview.notice?.isDraft ?? true}
        />
      ) : (
        <MissingNote tone={overview.companyEnabled ? 'info' : 'attention'}>
          Live location is {overview.companyEnabled ? 'ON' : 'OFF'} for your company. Only an admin
          changes it.
        </MissingNote>
      )}

      {overview.notice?.isDraft === true ? (
        <MissingNote>
          The notice your reps accept is the engineering DRAFT (“{overview.notice.versionLabel}”),
          shown to them labelled as a draft. Your company has not loaded and approved its own.
        </MissingNote>
      ) : null}

      {/* `FE-W91`: where an admin loads and approves the company's own notice. */}
      {overview.canChangeSwitch ? (
        <Body>
          <a href="/tracking/notice">
            The notice reps accept — load and approve your company’s own
          </a>
        </Body>
      ) : null}

      <Card>
        <Heading>Your reps</Heading>
        <Body muted>
          A position is taken about every {Math.round(overview.intervalSeconds / 60)} minute(s)
          while a rep shares. “No position yet” is also what a rep who has not agreed, or has not
          started today, looks like.
        </Body>
        {overview.reps.length === 0 ? (
          <MissingNote tone="info">
            There is no rep in your territory or reporting line.
          </MissingNote>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th>Territory</th>
                <th>Notice</th>
                <th>Latest position</th>
                <th>Today</th>
              </tr>
            </thead>
            <tbody>
              {overview.reps.map((rep) => (
                <tr key={rep.mrId}>
                  <td>
                    <a href={`/tracking?rep=${rep.mrId}`}>{rep.fullName}</a>
                  </td>
                  <td>{rep.territoryName ?? '—'}</td>
                  <td>
                    <Pill tone={rep.accepted ? 'success' : 'neutral'}>
                      {rep.accepted ? 'Accepted' : 'Not accepted'}
                    </Pill>
                  </td>
                  <td>
                    <LatestCell rep={rep} />
                  </td>
                  <td>
                    <a href={`/tracking?rep=${rep.mrId}`}>
                      {rep.pingsToday} position(s) — see the list
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {trailRefusal === null ? null : <MissingNote tone="critical">{trailRefusal}</MissingNote>}
      {trail === null ? null : <Trail trail={trail} />}
    </>,
  );
}
