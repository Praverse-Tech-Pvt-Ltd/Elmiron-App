import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Pressable } from 'react-native';
import { Banner } from './Banner';
import { Heading, Label } from './Text';
import { ListItem } from './ListItem';
import { Spinner } from './Spinner';
import { SurfaceContext } from './surface';
import { TextField } from './TextField';

/**
 * B8 — the doctor list.
 *
 * **"Overdue" is the only coloured badge on the screen**, because it is the only
 * one that changes what the MR does next. Everything else — specialty, area, when
 * they were last seen — is a fact they read, not a call to act, and colouring it
 * would spend the one signal that matters on things that do not.
 *
 * Rows carry their state in words as well as in the glyph, so `ListItem`'s
 * mandatory `status` is doing real work here: an overdue doctor reads as overdue to
 * someone who cannot see the colour.
 */
export interface DoctorListRow {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly lastSeenLabel: string;
  readonly overdue: boolean;
}

export interface DoctorListFilter {
  readonly id: string;
  readonly label: string;
}

export interface DoctorListScreenProps {
  readonly rows: readonly DoctorListRow[];
  /** B8's chips. Empty means none are offered. */
  readonly filters?: readonly DoctorListFilter[];
  readonly activeFilter?: string;
  readonly onFilterChange?: (id: string) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onOpenDoctor?: (id: string) => void;
  readonly loading?: boolean;
  readonly failure?: { readonly title: string; readonly detail: string } | null;
  /**
   * Total held for this territory, before the search filtered it. Rendered as a
   * count of what is on screen against what exists — an MR who searches and sees
   * three rows should be able to tell that from a territory that has three doctors.
   */
  readonly total?: number;
}

const styles = StyleSheet.create({
  count: { paddingTop: tokens.space.xs },
  rows: { gap: tokens.space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  // A chip is a control, so it gets the touch floor rather than the size its text
  // happens to be — §04's rule applies to small things most.
  chip: {
    minHeight: tokens.target.floor,
    justifyContent: 'center',
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.wash,
  },
  chipOn: { backgroundColor: tokens.color.accent },
  chipPressed: { backgroundColor: tokens.color.washPressed },
});

const emptyMessage = (
  query: string,
  filterLabel: string | null,
  total: number | undefined,
): string => {
  const searched = query.trim();
  if (total === 0) return 'No doctors in your territory yet.';
  if (searched !== '' && filterLabel !== null) {
    return `Nothing under “${filterLabel}” matches “${searched}”.`;
  }
  if (searched !== '') return `Nothing matches “${searched}”.`;
  if (filterLabel !== null) return `No doctors under “${filterLabel}”.`;
  return 'No doctors in your territory yet.';
};

export const DoctorListScreen = ({
  rows,
  filters = [],
  activeFilter,
  onFilterChange,
  query,
  onQueryChange,
  onOpenDoctor,
  loading = false,
  failure = null,
  total,
}: DoctorListScreenProps): ReactNode => {
  // The chip an MR can see is on. "All" is not a narrowing, so it never explains an
  // empty list.
  const active = filters.find((candidate) => candidate.id === activeFilter);
  const filterLabel = active === undefined || active.id === 'all' ? null : active.label;

  if (failure !== null) {
    return (
      <>
        <Heading>Doctors</Heading>
        <Banner detail={failure.detail} title={failure.title} tone="critical" />
      </>
    );
  }

  return (
    <>
      <Heading>Doctors</Heading>

      <TextField
        autoCapitalize="none"
        label="Name, clinic or area"
        onChangeText={onQueryChange}
        onClear={() => {
          onQueryChange('');
        }}
        value={query}
      />

      {filters.length === 0 ? null : (
        <View style={styles.chips}>
          {filters.map((filter) => {
            const on = filter.id === activeFilter;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                key={filter.id}
                onPress={() => {
                  onFilterChange?.(filter.id);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  on ? styles.chipOn : null,
                  pressed && !on ? styles.chipPressed : null,
                ]}
              >
                {/*
                  The selected chip is an accent fill, so its label takes the accent
                  ink rather than the page's. Declaring the surface is what keeps
                  that automatic — the alternative is a hardcoded white that the
                  next palette change silently breaks.
                */}
                {on ? (
                  <SurfaceContext.Provider value="accent">
                    <Label>{filter.label}</Label>
                  </SurfaceContext.Provider>
                ) : (
                  <Label muted>{filter.label}</Label>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {loading ? <Spinner label="Getting your doctor list" /> : null}

      {!loading && rows.length === 0 ? (
        <View style={styles.count}>
          {/*
            Three different emptinesses, and telling an MR the wrong one sends them
            to the wrong place: a filter that matched nothing is a chip to turn off,
            a search that matched nothing is a word to change, and an empty
            territory is somebody else's job to fix.
          */}
          <Label muted>{emptyMessage(query, filterLabel, total)}</Label>
        </View>
      ) : null}

      <View style={styles.rows}>
        {rows.map((row) => (
          <ListItem
            detail={`${row.detail} · ${row.lastSeenLabel}`}
            key={row.id}
            status={row.overdue ? 'attention' : 'success'}
            title={row.name}
            // Spread rather than `meta={... : undefined}`: `exactOptionalPropertyTypes`
            // treats an explicit undefined as a value, not as an absent prop.
            {...(row.overdue ? { meta: 'Overdue' } : {})}
            {...(onOpenDoctor === undefined
              ? {}
              : {
                  onPress: () => {
                    onOpenDoctor(row.id);
                  },
                })}
          />
        ))}
      </View>

      {total === undefined || loading ? null : (
        <View style={styles.count}>
          <Label muted>
            {rows.length === total
              ? `${String(total)} doctors in your territory.`
              : `${String(rows.length)} of ${String(total)} doctors in your territory.`}
          </Label>
        </View>
      )}
    </>
  );
};
