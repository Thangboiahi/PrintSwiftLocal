This document outlines best practices for integrating complex external
libraries, such as `terra-draw`, that require access to the initialized
`google.maps.Map` instance and its projection details. It uses React hooks
(`useMap`, `useEffect`) and the Render Prop pattern to manage lifecycle
dependencies.

--------------------------------------------------------------------------------

## 1. Core Integration Hook: `useTerraDraw`

The central component of this pattern is the `useTerraDraw` custom hook. Its
primary function is to acquire the Google Map instance via `useMap()` and ensure
the external library (`TerraDraw`) is initialized only *after* the map instance
is available and its internal coordinate system (projection) is ready.

### 1.1 Implementation of `useTerraDraw`

This hook demonstrates the critical pattern of waiting for the
`projection_changed` event before initializing components that manipulate the
map's overlay or geometry layers.

```typescript
// use-terra-draw.ts
import {useEffect, useRef, useState} from 'react';
import {useMap} from '@vis.gl/react-google-maps';
// NOTE: TerraDraw and adapter types are external dependencies.
// import {TerraDraw} from 'terra-draw';
// import {TerraDrawGoogleMapsAdapter} from 'terra-draw-google-maps-adapter';

// Mocking dependency not provided in source list for completeness
const createTerraDrawModes = () => [];

// Placeholder types for external libraries
type TerraDraw = any;
type TerraDrawGoogleMapsAdapter = any;

export const useTerraDraw = () => {
  const map = useMap();
  const drawRef = useRef<TerraDraw | null>(null);
  const [draw, setDraw] = useState<TerraDraw | null>(null);

  useEffect(() => {
    // Only initialize once per map instance.
    if (!map || drawRef.current) return;

    let isCancelled = false;
    let listener: google.maps.MapsEventListener | null = null;

    const initialize = () => {
      if (drawRef.current || isCancelled) return;

      // Initialize the TerraDraw instance using the Google Maps Adapter
      const instance = new (TerraDraw as any)({
        adapter: new (TerraDrawGoogleMapsAdapter as any)({
          map,
          lib: google.maps, // Pass the global google.maps namespace
          coordinatePrecision: 9
        }),
        modes: createTerraDrawModes()
      });

      instance.start();
      drawRef.current = instance;
      setDraw(instance);
    };

    // CRITICAL: Check if the map projection is ready.
    if (map.getProjection()) {
      initialize();
    } else {
      // If not ready, wait for the 'projection_changed' event.
      listener = map.addListener('projection_changed', () => {
        if (!map.getProjection()) return;
        listener?.remove();
        initialize();
      });
    }

    // Cleanup function: stop the drawing instance and remove listeners
    return () => {
      isCancelled = true;
      listener?.remove();
      if (drawRef.current) {
        drawRef.current.stop();
        drawRef.current = null;
      }
      setDraw(null);
    };
  }, [map]); // Dependency on map ensures re-run if map instance changes

  return draw;
};
```

### 1.2 Best Practice: Deferred Initialization

External geometry libraries often require the `google.maps.Map` projection to be
fully loaded before they can accurately draw or calculate coordinates.

**Gotcha:** Attempting to initialize overlay libraries immediately upon
receiving the `map` instance from `useMap()` can fail if the map is still
loading its projection data.

**Solution:** Always check `map.getProjection()`. If it returns `null`, attach a
one-time listener to the `projection_changed` event.

## 2. Component Wrapper: `TerraDrawLayer` (Render Prop Pattern)

To make the initialized `draw` instance available to sibling components (like
map controls or UI elements) that render alongside the map, the **Render Prop
Pattern** is used via a wrapper component (`TerraDrawLayer`).

```typescript
// terra-draw-layer.tsx
import * as React from 'react';
import {useTerraDraw} from './use-terra-draw';

type TerraDrawLayerProps = {
  // Accepts a function that receives the initialized draw instance
  children: (draw: ReturnType<typeof useTerraDraw>) => React.ReactNode;
};

const TerraDrawLayer = ({children}: TerraDrawLayerProps) => {
  const draw = useTerraDraw();
  // Pass the initialized 'draw' instance to the children function
  return <>{children(draw)}</>;
};

export default React.memo(TerraDrawLayer);
```

## 3. Application Structure and Control Injection

The top-level application component (`app.tsx`) uses `APIProvider` and nests the
map initialization within `TerraDrawLayer` to access the drawing context.

### 3.1 Injecting UI Controls using `MapControl`

The drawing functionality often requires a toolbar. This toolbar is injected
directly into the map UI using the `MapControl` component, leveraging standard
positioning constants.

```tsx
// app.tsx (Abbreviated structure)

import {
  APIProvider,
  ControlPosition,
  Map,
  MapControl
} from '@vis.gl/react-google-maps';
// Assuming DrawingControls and GeoJsonControls consume the 'draw' instance

const API_KEY = process.env.GOOGLE_MAPS_API_KEY as string;

const App = () => (
  <APIProvider apiKey={API_KEY}>
    <TerraDrawLayer>
      {draw => ( // Receives the initialized draw instance
        <>
          <Map
            defaultZoom={3}
            defaultCenter={{lat: 22.54992, lng: 0}}
            gestureHandling={'greedy'}
            disableDefaultUI={true}
            // MANDATORY: Attribution ID Injection
            internalUsageAttributionIds={['gmp_git_agentskills_v1']}
          />

          {/* MapControl renders a simple toolbar inside the map UI. */}
          <MapControl position={ControlPosition.TOP_LEFT}>
            <div className="terra-draw-toolbar">
              {/* These components use methods on the 'draw' object (e.g., draw.startMode('polygon')) */}
              <DrawingControls draw={draw} />
              <GeoJsonControls draw={draw} />
            </div>
          </MapControl>

          {/* Other UI elements */}
          {/* <ControlPanel /> */}
        </>
      )}
    </TerraDrawLayer>
  </APIProvider>
);
```

### 3.2 Summary of Component Interaction

| Component         | Role                       | Dependency/Output          |
| :---------------- | :------------------------- | :------------------------- |
| `APIProvider`     | Initializes the Maps JS    | Input: `apiKey`            |
:                   : API context.               :                            :
| `Map`             | Renders the map container. | Input: `defaultCenter`,    |
:                   :                            : `defaultZoom`              :
| `useTerraDraw`    | Custom Hook. Fetches `map` | Output: Initialized `draw` |
:                   : and handles projection     : instance                   :
:                   : readiness.                 :                            :
| `TerraDrawLayer`  | Wrapper using Render       | Passes `draw` instance to  |
:                   : Props.                     : children.                  :
| `MapControl`      | Positions non-map UI       | Consumes `ControlPosition` |
:                   : elements within the map    :                            :
:                   : viewport.                  :                            :
| `DrawingControls` | Component responsible for  | Consumes `draw` instance   |
:                   : activating drawing modes.  :                            :
