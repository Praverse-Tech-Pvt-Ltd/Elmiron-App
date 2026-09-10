import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { DoctorListScreen } from './DoctorListScreen';
import type { DoctorListRow } from './DoctorListScreen';
import { DoctorProfileScreen } from './DoctorProfileScreen';

const rows: readonly DoctorListRow[] = [
  {
    id: 'a',
    name: 'Dr V. Kulkarni',
    detail: 'Urology · Dadar West',
    lastSeenLabel: '6 weeks ago',
    overdue: true,
  },
  {
    id: 'b',
    name: 'Dr S. Iyer',
    detail: 'Cardiology · Prabhadevi',
    lastSeenLabel: 'today',
    overdue: false,
  },
];

describe('the doctor list', () => {
  it('badges only the row that changes what the MR does next', async () => {
    // B8: "Overdue" is the only coloured badge on the screen. Badging everything
    // spends the one signal that matters on facts the MR merely reads.
    await render(
      <DoctorListScreen onQueryChange={() => undefined} query="" rows={rows} total={2} />,
    );
    expect(screen.getAllByText('Overdue').length).toBe(1);
  });

  it('opens the doctor that was pressed, not the first in the list', async () => {
    // The wiring a tap would prove on a device. Asserting the id makes an
    // off-by-one in the row mapping fail here rather than in someone's hands.
    const onOpen = jest.fn();
    await render(
      <DoctorListScreen
        onOpenDoctor={onOpen}
        onQueryChange={() => undefined}
        query=""
        rows={rows}
        total={2}
      />,
    );
    await fireEvent.press(screen.getByText('Dr S. Iyer'));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('says how many of the territory it is showing once a search narrows it', async () => {
    await render(
      <DoctorListScreen
        onQueryChange={() => undefined}
        query="iyer"
        rows={[rows[1] as DoctorListRow]}
        total={2}
      />,
    );
    expect(screen.getByText('1 of 2 doctors in your territory.')).toBeTruthy();
  });

  it('distinguishes "nothing matches" from "your territory is empty"', async () => {
    // The two are different facts and only one of them means the MR should stop
    // searching.
    await render(
      <DoctorListScreen onQueryChange={() => undefined} query="zzz" rows={[]} total={2} />,
    );
    expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy();

    await render(<DoctorListScreen onQueryChange={() => undefined} query="" rows={[]} total={0} />);
    expect(screen.getByText('No doctors in your territory yet.')).toBeTruthy();
  });

  it('blames the filter when a filter is what emptied the list', async () => {
    // Otherwise an MR who taps "Not seen 30d" in a well-covered territory is told
    // their territory is empty, and goes looking for a problem that is not there.
    await render(
      <DoctorListScreen
        activeFilter="overdue"
        filters={[
          { id: 'all', label: 'All' },
          { id: 'overdue', label: 'Not seen 30d' },
        ]}
        onQueryChange={() => undefined}
        query=""
        rows={[]}
        total={2}
      />,
    );
    expect(screen.getByText('No doctors under “Not seen 30d”.')).toBeTruthy();
  });

  it('names both when a search and a filter are on together', async () => {
    await render(
      <DoctorListScreen
        activeFilter="overdue"
        filters={[
          { id: 'all', label: 'All' },
          { id: 'overdue', label: 'Not seen 30d' },
        ]}
        onQueryChange={() => undefined}
        query="iyer"
        rows={[]}
        total={2}
      />,
    );
    expect(screen.getByText('Nothing under “Not seen 30d” matches “iyer”.')).toBeTruthy();
  });

  it('does not blame "All", which narrows nothing', async () => {
    await render(
      <DoctorListScreen
        activeFilter="all"
        filters={[{ id: 'all', label: 'All' }]}
        onQueryChange={() => undefined}
        query=""
        rows={[]}
        total={2}
      />,
    );
    expect(screen.getByText('No doctors in your territory yet.')).toBeTruthy();
  });

  it('changes the filter when a chip is pressed', async () => {
    const onFilterChange = jest.fn();
    await render(
      <DoctorListScreen
        activeFilter="all"
        filters={[
          { id: 'all', label: 'All' },
          { id: 'overdue', label: 'Not seen 30d' },
        ]}
        onFilterChange={onFilterChange}
        onQueryChange={() => undefined}
        query=""
        rows={rows}
        total={2}
      />,
    );
    await fireEvent.press(screen.getByText('Not seen 30d'));
    expect(onFilterChange).toHaveBeenCalledWith('overdue');
  });

  it('shows a denial as a denial rather than as an empty territory', async () => {
    await render(
      <DoctorListScreen
        failure={{
          title: 'You do not have access to this list',
          detail: 'This record belongs to another medical representative.',
        }}
        onQueryChange={() => undefined}
        query=""
        rows={[]}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No doctors in your territory yet.')).toBeNull();
  });
});

describe('the doctor profile', () => {
  const boundary =
    'Nothing here about what they prescribe, and nothing about their patients. Neither is recorded anywhere in this app.';

  const profile = (over = {}) => ({
    name: 'Dr V. Kulkarni',
    detail: 'Urology · Kulkarni Clinic, Dadar West',
    sinceLabel: '6 weeks ago',
    recentVisits: [
      { id: 'v1', dateLabel: '3 Jul', durationLabel: '9 min', consentLabel: 'declined recording' },
    ],
    boundary,
    ...over,
  });

  it('prints C14 on the screen rather than leaving it to a comment', async () => {
    // The design's note: a profile screen is exactly where prescriber profiling
    // would creep in, so the absence is stated. This test is what makes deleting
    // the sentence a failing build rather than a quiet edit.
    await render(<DoctorProfileScreen {...profile()} />);
    expect(screen.getByText(boundary)).toBeTruthy();
  });

  it('shows the visit history as the MR’s own record of going', async () => {
    await render(<DoctorProfileScreen {...profile()} />);
    expect(screen.getByText('3 Jul')).toBeTruthy();
    expect(screen.getByText('9 min · declined recording')).toBeTruthy();
  });

  it('does not dress a declined recording as a problem', async () => {
    // §02 again: a doctor who said no is a normal outcome, and the row carries the
    // same state as any other visit that happened.
    await render(<DoctorProfileScreen {...profile()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says plainly when this doctor has never been visited', async () => {
    await render(<DoctorProfileScreen {...profile({ sinceLabel: null, recentVisits: [] })} />);
    expect(screen.getByText('You have not visited this doctor yet.')).toBeTruthy();
    // And the boundary still stands on a profile with no history at all.
    expect(screen.getByText(boundary)).toBeTruthy();
  });

  it('shows a denial instead of a profile', async () => {
    await render(
      <DoctorProfileScreen
        {...profile()}
        failure={{ title: 'You do not have access to this doctor', detail: 'Not your territory.' }}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('3 Jul')).toBeNull();
  });
});
