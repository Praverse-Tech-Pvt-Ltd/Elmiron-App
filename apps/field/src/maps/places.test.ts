import { describe, expect, it } from 'vitest';
import type { ClinicAddress, Doctor, Visit } from '@fieldforce/core';
import { doctorPlaces, placeLink, regionFor, todayPlaces } from './places';
import type { RouteStop } from '../today/route';

/** `FE-W85` — what the map places, and what it lists as having no location. Nothing is guessed. */

const address = (id: string, over: Partial<ClinicAddress> = {}): ClinicAddress => ({
  id,
  doctorId: 'd',
  label: `Clinic ${id}`,
  line1: '1 Road',
  line2: null,
  city: 'Pune',
  state: 'MH',
  postalCode: '411001',
  coordinates: { latitude: 18.52, longitude: 73.85 },
  geofenceRadiusMetres: 150,
  ...over,
});

const doctor = (id: string, clinics: ClinicAddress[], over: Partial<Doctor> = {}): Doctor => ({
  id,
  fullName: `Dr ${id}`,
  registrationNumber: null,
  specialty: null,
  qualification: null,
  territoryId: '00000000-0000-4000-8000-000000000001',
  assignedMrId: null,
  clinicAddresses: clinics,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const stop = (doctorId: string, visitId: string | null): RouteStop => ({
  doctorId,
  visitId,
  doctorName: `Dr ${doctorId}`,
  clinic: null,
  state: 'upcoming',
  startedAt: null,
  minutes: null,
  consent: null,
});

describe('doctorPlaces', () => {
  it('one pin per clinic with coordinates, with its geofence radius', () => {
    const plan = doctorPlaces([
      doctor('a', [
        address('a1'),
        address('a2', { coordinates: { latitude: 18.6, longitude: 73.9 } }),
      ]),
    ]);
    expect(plan.pins.map((p) => [p.key, p.detail, p.radiusMetres])).toEqual([
      ['a:a1', 'Clinic a1, Pune', 150],
      ['a:a2', 'Clinic a2, Pune', 150],
    ]);
    expect(plan.missing).toEqual([]);
  });

  it('a doctor with no coordinates anywhere is LISTED, never placed — and impossible ones count as none', () => {
    const plan = doctorPlaces([
      doctor('none', [address('n1', { coordinates: null })]),
      doctor('bad', [address('b1', { coordinates: { latitude: 95, longitude: 0 } })]),
      doctor('empty', []),
      doctor('gone', [address('g1')], { isActive: false }),
    ]);
    expect(plan.pins).toEqual([]);
    expect(plan.region).toBeNull();
    expect(plan.missing.map((m) => [m.title, m.detail])).toEqual([
      ['Dr none', 'Clinic n1, Pune'],
      ['Dr bad', 'Clinic b1, Pune'],
      ['Dr empty', 'No clinic on file'],
    ]);
  });
});

describe('todayPlaces', () => {
  it('each stop at the clinic its visit names, else the first; numbered in route order', () => {
    const doctors = [
      doctor('a', [address('a1'), address('a2', { coordinates: { latitude: 19, longitude: 74 } })]),
      doctor('b', [address('b1', { coordinates: null })]),
    ];
    const visits = [{ id: 'v1', clinicAddressId: 'a2' } as unknown as Visit];
    const plan = todayPlaces([stop('a', 'v1'), stop('b', null)], doctors, visits);
    expect(plan.pins).toEqual([
      expect.objectContaining({ title: '1. Dr a', visitId: 'v1', latitude: 19, longitude: 74 }),
    ]);
    expect(plan.missing).toEqual([
      expect.objectContaining({ title: '2. Dr b', detail: 'Clinic b1, Pune', visitId: null }),
    ]);
  });
});

describe('links and region', () => {
  it('a pin opens its visit, else its doctor', () => {
    expect(placeLink({ doctorId: 'd1', visitId: 'v1' })).toBe('/visit/v1');
    expect(placeLink({ doctorId: 'd1', visitId: null })).toBe('/doctor/d1');
  });

  it('the region holds every pin; one pin gets a minimum span', () => {
    const one = doctorPlaces([doctor('a', [address('a1')])]);
    expect(one.region).toEqual({
      latitude: 18.52,
      longitude: 73.85,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
    expect(regionFor([])).toBeNull();
  });
});
