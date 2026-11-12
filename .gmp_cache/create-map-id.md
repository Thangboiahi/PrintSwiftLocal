# Create a Reusable Map Identifier to Store Map Configuration and Styling Settings

## Overview

A **Map ID** is a unique identifier stored in Google Cloud that represents
Google Map styling and configuration settings. Map IDs are required to enable
certain Maps JavaScript API features—such as Cloud-based maps styling, Vector
Maps, Advanced Markers (`AdvancedMarkerElement`), and 3D Maps
(`Map3DElement`)—and allow you to update map styles centrally without modifying
your application code.

> **Billing Notice:** Features accessed by adding a Map ID may trigger map loads
> charged against specific Dynamic Maps SKUs. Refer to
> [Google Maps Billing](https://developers.google.com/maps/billing-and-pricing/sku-details#dynamic-maps-ess-sku)
> for details.

--------------------------------------------------------------------------------

## Step 1: Required Permissions

To create or manage Map IDs in your Google Cloud project, your user account or
principal must have the **Editor** or **Owner** IAM role on the Cloud Console
IAM page for the project. For details, see the
[IAM basic and predefined roles reference](https://cloud.google.com/iam/docs/roles-overview#role-types).

--------------------------------------------------------------------------------

## Step 2: Create a Map ID in Google Cloud Console

1.  Sign in to the [Google Cloud Console](https://console.cloud.google.com/) and
    open your project.
2.  Navigate to the
    [**Map Management** page](https://console.cloud.google.com/google/maps-apis/studio/maps).
3.  Click **Create map ID**.
4.  On the **Create new map ID** form, configure the following:
    -   **Name**: Enter a descriptive name for the Map ID.
    -   **Description** *(Optional)*: Describe what the Map ID is used for.
    -   **Map type**: Select **JavaScript**.
    -   **JavaScript Options**: Choose between **Raster** (default) or
        **Vector** map rendering. (Select **Vector** if you need 3D buildings,
        tilt, heading rotation, or WebGL features).
5.  Click **Save** to generate and display your new Map ID string.
6.  *(Optional)* If you are using cloud-based map styling, associate a map style
    with your new Map ID on the
    [Map Styles](https://developers.google.com/maps/documentation/javascript/cloud-customization/map-styles-leg#associate-style-with-map-id)
    page.

--------------------------------------------------------------------------------

## Step 3: Add the Map ID to Your JavaScript Application

Before adding a `mapId` to your `MapOptions` configuration:

-   **Remove embedded JSON styles**: If you are currently customizing your map
    using the local `styles` property in `MapOptions`, remove the `styles`
    property when switching to a cloud-styled `mapId`.

### 1. Standard 2D Map (Vanilla TypeScript / JavaScript)

Use `google.maps.importLibrary("maps")` and pass the `mapId` property inside
`google.maps.MapOptions`:

```typescript
let map: google.maps.Map;

async function initMap(): Promise<void> {
  const position = { lat: 48.85, lng: 2.35 };

  // Request needed libraries
  const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

  // Initialize the map with the mapId
  map = new Map(
    document.getElementById("map") as HTMLElement,
    {
      zoom: 12,
      center: position,
      mapId: "YOUR_MAP_ID", // Replace with your Cloud Console Map ID (or 'DEMO_MAP_ID' for testing)
      internalUsageAttributionIds: ["gmp_git_agentskills_v1"],
    } as google.maps.MapOptions
  );

  // Features like AdvancedMarkerElement require a mapId
  const marker = new AdvancedMarkerElement({
    map: map,
    position: position,
    title: "Paris",
  });
}

initMap();
```

*Sources:*

-   [https://github.com/googlemaps/js-samples/blob/HEAD/samples/add-map/index.ts?utm_campaign=gmp_git_agentskills_v1](https://github.com/googlemaps/js-samples/blob/HEAD/samples/add-map/index.ts?utm_campaign=gmp_git_agentskills_v1)
-   [https://github.com/googlemaps/js-samples/blob/HEAD/samples/map-id-style/index.ts?utm_campaign=gmp_git_agentskills_v1](https://github.com/googlemaps/js-samples/blob/HEAD/samples/map-id-style/index.ts?utm_campaign=gmp_git_agentskills_v1)

--------------------------------------------------------------------------------

### 2. 3D Map (`Map3DElement`)

When initializing a 3D map with the `maps3d` library, pass `mapId` to the
`Map3DElement` options:

```javascript
async function init() {
  const { Map3DElement } = await google.maps.importLibrary("maps3d");

  const map = new Map3DElement({
    center: {
      lat: 37.75183154601466,
      lng: -119.52369070507672,
      altitude: 2200,
    },
    tilt: 67.5,
    heading: 108.94057782079429,
    range: 6605.57279990986,
    mapId: "YOUR_MAP_ID", // Styles and configurations are associated with map IDs
    mode: "HYBRID",
  });

  map.setAttribute("internal-usage-attribution-ids", "gmp_git_agentskills_v1");
  document.body.append(map);
}

void init();
```

--------------------------------------------------------------------------------

### 3. React (`@vis.gl/react-google-maps`)

In React applications using `@vis.gl/react-google-maps`, pass the `mapId` prop
directly to the `<Map>` component.

> **Lifecycle & Billing Note:** Due to how the Maps JavaScript API works,
> changing the `mapId` at runtime requires creating a new `google.maps.Map`
> instance under the hood, which counts toward paid map views.

```tsx
import React, { useState } from 'react';
import { APIProvider, Map } from '@vis.gl/react-google-maps';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY as string;

export type MapConfig = {
  id: string;
  label: string;
  mapId?: string;
  mapTypeId?: string;
};

const MAP_CONFIGS: MapConfig[] = [
  {
    id: 'light',
    label: 'Light Theme',
    mapId: '49ae42fed52588c3',
    mapTypeId: 'roadmap',
  },
  {
    id: 'dark',
    label: 'Dark Theme',
    mapId: '739af084373f96fe',
    mapTypeId: 'roadmap',
  },
];

const App = () => {
  const [mapConfig, setMapConfig] = useState<MapConfig>(MAP_CONFIGS[0]);

  return (
    <APIProvider apiKey={API_KEY}>
      <Map
        defaultCenter={{ lat: 22, lng: 0 }}
        defaultZoom={3}
        mapId={mapConfig.mapId || null}
        mapTypeId={mapConfig.mapTypeId}
        gestureHandling={'greedy'}
        disableDefaultUI={true}
        internalUsageAttributionIds={['gmp_git_agentskills_v1']}
      />
    </APIProvider>
  );
};

export default App;
```

*Sources:*

-   [https://github.com/visgl/react-google-maps/blob/HEAD/examples/change-map-styles/src/app.tsx?utm_campaign=gmp_git_agentskills_v1](https://github.com/visgl/react-google-maps/blob/HEAD/examples/change-map-styles/src/app.tsx?utm_campaign=gmp_git_agentskills_v1)
-   [https://github.com/visgl/react-google-maps/blob/HEAD/examples/change-map-styles/src/control-panel.tsx?utm_campaign=gmp_git_agentskills_v1](https://github.com/visgl/react-google-maps/blob/HEAD/examples/change-map-styles/src/control-panel.tsx?utm_campaign=gmp_git_agentskills_v1)
