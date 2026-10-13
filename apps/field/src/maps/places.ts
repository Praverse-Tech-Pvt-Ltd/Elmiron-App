import type { ClinicAddress, Doctor, Visit } from '@fieldforce/core';
import type { RouteStop } from '../today/route';

/**
 * `FE-W85` — what the map shows, decided without a map.
 *
 * **A clinic with no coordinates is never placed.** It is listed under "No location on file" with
 * the clinic's name, so the rep knows it exists and that the map does not know where it is. No
 * position is guessed: not the city's centre, not a geocode, not another clinic of the same doctor.
 * Coordinates come only from `clinic_addresses` (the geofence centre check-in is measured against),
 * and a value outside the globe counts as none.
 *
 * Pure, so it runs under vitest; `src/maps/clinic-map.tsx` draws it.
 */
export interface MapPin {
  /** Unique per pin: a doctor can have several clinics. */
  readonly key: string;
  readonly doctorId: string;
  /** The visit this pin stands for (Today's map), or null (the doctors map). */
  readonly visitId: string | null;
  readonly title: string;
  readonly detail: string;
  readonly latitude: number;
  readonly longitude: number;
  /** The clinic's geofence radius, drawn around the pin. */
  readonly radiusMetres: number;
}

export interface MissingPlace {
  readonly key: string;
  readonly doctorId: string;
  readonly visitId: string | null;
  readonly title: string;
  readonly detail: string;
}

export interface MapRegion {
  readonly latitude: number;
  readonly longitude: number;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

export interface MapPlan {
  readonly pins: readonly MapPin[];
  readonly missing: readonly MissingPlace[];
  /** The view that fits every pin, or null when there is none. */
  readonly region: MapRegion | null;
}

export const NO_LOCATION = 'No location on file';

const usable = (address: ClinicAddress): { latitude: number; longitude: number } | null => {
  const c = address.coordinates;
  if (c === null) return null;
  const { latitude, longitude } = c;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
};

const clinicLine = (address: ClinicAddress): string => `${address.label}, ${address.city}`;

/** The smallest view holding every pin, with a margin; one pin gets a street-level view. */
export const regionFor = (pins: readonly MapPin[]): MapRegion | null => {
  if (pins.length === 0) return null;
  const lats = pins.map((p) => p.latitude);
  const lngs = pins.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.4),
  };
};

const plan = (pins: MapPin[], missing: MissingPlace[]): MapPlan => ({
  pins,
  missing,
  region: regionFor(pins),
});

/** Every active doctor's clinics. A doctor none of whose clinics has coordinates is listed once. */
export const doctorPlaces = (doctors: readonly Doctor[]): MapPlan => {
  const pins: MapPin[] = [];
  const missing: MissingPlace[] = [];
  for (const doctor of doctors) {
    if (!doctor.isActive) continue;
    const placed = doctor.clinicAddresses.flatMap((address) => {
      const at = usable(address);
      return at === null
        ? []
        : [
            {
              key: `${doctor.id}:${address.id}`,
              doctorId: doctor.id,
              visitId: null,
              title: doctor.fullName,
              detail: clinicLine(address),
              ...at,
              radiusMetres: address.geofenceRadiusMetres,
            },
          ];
    });
    if (placed.length > 0) pins.push(...placed);
    else
      missing.push({
        key: doctor.id,
        doctorId: doctor.id,
        visitId: null,
        title: doctor.fullName,
        detail:
          doctor.clinicAddresses.length === 0
            ? 'No clinic on file'
            : doctor.clinicAddresses.map(clinicLine).join(' · '),
      });
  }
  return plan(pins, missing);
};

/**
 * Today's stops. Each stop is placed at the clinic its VISIT names, else the doctor's first clinic
 * (the same choice the visit screen and the route make); without coordinates it is listed.
 */
export const todayPlaces = (
  stops: readonly RouteStop[],
  doctors: readonly Doctor[],
  visits: readonly Visit[],
): MapPlan => {
  const byDoctor = new Map(doctors.map((d) => [d.id, d]));
  const byVisit = new Map(visits.map((v) => [v.id, v]));
  const pins: MapPin[] = [];
  const missing: MissingPlace[] = [];
  stops.forEach((stop, index) => {
    const doctor = byDoctor.get(stop.doctorId);
    const visit = stop.visitId === null ? undefined : byVisit.get(stop.visitId);
    const address =
      (visit?.clinicAddressId == null
        ? undefined
        : doctor?.clinicAddresses.find((a) => a.id === visit.clinicAddressId)) ??
      doctor?.clinicAddresses[0];
    const key = `${String(index)}:${stop.doctorId}`;
    const title = `${String(index + 1)}. ${stop.doctorName}`;
    const at = address === undefined ? null : usable(address);
    if (address !== undefined && at !== null) {
      pins.push({
        key,
        doctorId: stop.doctorId,
        visitId: stop.visitId,
        title,
        detail: clinicLine(address),
        ...at,
        radiusMetres: address.geofenceRadiusMetres,
      });
    } else {
      missing.push({
        key,
        doctorId: stop.doctorId,
        visitId: stop.visitId,
        title,
        detail: address === undefined ? 'No clinic on file' : clinicLine(address),
      });
    }
  });
  return plan(pins, missing);
};

/** Where tapping a pin or a listed place opens: the visit when there is one, else the doctor. */
export const placeLink = (place: {
  readonly doctorId: string;
  readonly visitId: string | null;
}): string => (place.visitId === null ? `/doctor/${place.doctorId}` : `/visit/${place.visitId}`);
