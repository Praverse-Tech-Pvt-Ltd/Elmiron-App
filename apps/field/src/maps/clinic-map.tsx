import type { ReactNode } from 'react';
import MapView, { Circle, Marker } from 'react-native-maps';
import { tokens } from '@fieldforce/ui-tokens';
import type { MapPin, MapRegion } from './places';

/**
 * `FE-W85` — the map itself: one marker per placed clinic, its geofence drawn around it, the rep's own
 * dot. Rendered ONLY by `app/map.tsx`, and only when the build has `EXPO_PUBLIC_MAPS=true` -- which a
 * build cannot have without a Maps key in its manifest (`plugins/maps-push.cjs`). The Maps SDK
 * without a key crashes on first draw, which is why nothing else may render this.
 *
 * `showsUserLocation` uses the foreground location permission check-in already holds; it asks for
 * nothing new, and background location stays blocked in the manifest.
 */
const MAP_STYLE = { height: 360, borderRadius: tokens.radius.card } as const;

export const ClinicMap = ({
  pins,
  region,
  onOpen,
}: {
  readonly pins: readonly MapPin[];
  readonly region: MapRegion;
  readonly onOpen: (pin: MapPin) => void;
}): ReactNode => (
  <MapView style={MAP_STYLE} initialRegion={region} showsUserLocation toolbarEnabled={false}>
    {pins.map((pin) => (
      <Marker
        key={pin.key}
        coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
        title={pin.title}
        description={pin.detail}
        onCalloutPress={() => {
          onOpen(pin);
        }}
      />
    ))}
    {pins.map((pin) => (
      <Circle
        key={`${pin.key}:fence`}
        center={{ latitude: pin.latitude, longitude: pin.longitude }}
        radius={pin.radiusMetres}
        strokeColor={tokens.color.accent}
        fillColor="rgba(0,0,0,0.05)"
      />
    ))}
  </MapView>
);
