# Create a Reusable, Cross-Platform Map Style

A map style is a set of visual customizations to map features that you associate
with a Map ID in the Google Cloud console. By referencing the Map ID in your
Maps JavaScript API code, you can display customized maps across platforms and
update map styles dynamically without modifying or redeploying your application
code.

## Prerequisites

Before implementing a reusable map style, ensure you have completed the
following:

-   **Add a customizable, interactive map to a web page or mobile app** (or
    **Return a URL of a configurable, static map image**).
-   Access to a Google Cloud project with the Maps JavaScript API enabled.

--------------------------------------------------------------------------------

## End-to-End Workflow

To create and display a cloud-based map style, complete these four steps:

1.  **Create and publish a map style** in the Google Cloud console.
2.  **Create a Map ID** for your target platform (JavaScript).
3.  **Associate the map style with the Map ID**.
4.  **Add the Map ID to your application code** to render the styled map.

--------------------------------------------------------------------------------

## Step 1: Create and Publish a Map Style

You can create a map style from the default Google map style, duplicate an
existing custom style, or import a JSON style definition.

### Option A: Create a New Style

1.  In the Google Cloud console, go to
    [**Map Styles**](https://console.cloud.google.com/google/maps-apis/studio/styles)
    and select your project.
2.  Click **Create style**.
3.  Under the **Google styles** tab, select a base mode:
    -   **Light**: Ideal for bright or outdoor environments.
    -   **Dark**: Ideal for low-light environments.
4.  *(Optional)* Under **Optional theme**, select a variation:
    -   **Monochrome**: Creates a grayscale version of the style.
    -   **Ambient**: Creates a muted version of the style (requires the
        Navigation SDK to be enabled on your project).
    -   *Alternative*: Click the **JSON** tab to import an existing JSON map
        style array.
5.  Click **Customize** to open the style editor.
6.  Select map features and modify their visual properties (colors, visibility,
    weights).
    -   Customized features display a solid blue dot.
    -   Parent categories of customized child features display a blue circle.
    -   *Note*: Not all map features appear at all zoom levels.
7.  Click **Save**.
8.  In the **Save and publish map style** dialog, enter a style name and
    optional description, then click **Save**. The initial version of your new
    style is automatically published.

> **Caution:** Making style changes in the editor without explicitly clicking
> **Save** creates **Unsaved Changes** in your version history, which are lost
> when you close the browser tab or your session ends.

### Option B: Copy an Existing Style

To test style updates in a staging environment or create a complementary mode
without affecting live maps:

1.  Go to
    [**Map Styles**](https://console.cloud.google.com/google/maps-apis/studio/styles)
    and select an existing style.
2.  Click **Make a copy**.
3.  Enter a new name and optional description.
4.  *(Optional)* Select the checkbox in **Style mode options** to generate the
    complementary Light or Dark mode version of the style.
5.  Click **Save** (this automatically publishes the copied style).
6.  Click **Customize** to make changes, **Save** as a draft, and **Publish**
    when ready.

--------------------------------------------------------------------------------

## Step 2: Manage Drafts, Publishing, and Data-Driven Layers

### Published vs. Draft Styles

-   **First Creation**: Automatically published upon saving.
-   **Subsequent Edits**: Clicking **Save** stores your changes as a **Draft**
    (not visible on live maps). To make changes live for all Map IDs associated
    with the style, you must click **Publish**.
-   **Propagation Delay**: Published style updates can take a few hours to
    propagate to web and mobile applications.

### Data-Driven Styling and Datasets (Light & Dark Mode)

You can enable layers for **Data-driven styling for boundaries** and
**Data-driven styling for datasets** on the style details page of **Light mode**
styles. To use these layers with a **Dark mode** style:

1.  Select or create a **Light mode** style in **Map Styles**.
2.  Enable your desired boundary or dataset layers on the Light mode style
    details page.
3.  Associate both the **Light mode** style and your **Dark mode** style with
    the **same Map ID**. The enabled layers will automatically become available
    to the Dark mode style.

--------------------------------------------------------------------------------

## Step 3: Associate Your Style with a Map ID

A single Map ID can have one Light mode style and one Dark mode style associated
with it.

1.  In the Google Cloud console, go to **Map Management** and select your target
    **Map ID** (or create a new JavaScript Map ID).
2.  In the **Map styles** section, click **Edit** (pencil icon) for either
    **Light** or **Dark** mode.
3.  Select your published style from the side panel (only Light styles appear
    for Light mode; only Dark styles appear for Dark mode) and click **Done**.
4.  *(Optional)* Configure specific map types:
    -   By default, your custom style applies to all supported map types
        (`roadmap`, `navigation`, `terrain`, `hybrid`, `3D roadmap`,
        `3D hybrid`).
    -   To restrict your style to specific map types, click **Show more** and
        select or clear the checkboxes for each map type under Light and Dark
        modes. Unchecked map types revert to the default Google map style.
5.  Click **Save** to apply the association.

--------------------------------------------------------------------------------

## Step 4: Add the Map ID to Your Application

Reference your Map ID in the `mapId` property when instantiating the map.

### Vanilla TypeScript / JavaScript (Dynamic Library Import)

Use `google.maps.importLibrary("maps")` and pass the `mapId` and
`internalUsageAttributionIds` in `MapOptions`.

```typescript
let map: google.maps.Map;

async function initMap(): Promise<void> {
  const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;

  map = new Map(document.getElementById("map") as HTMLElement, {
    center: { lat: 48.85, lng: 2.35 },
    zoom: 12,
    mapId: "YOUR_MAP_ID", // Replace with your associated Map ID (e.g., "8e0a97af9386fef")
    internalUsageAttributionIds: ["gmp_git_agentskills_v1"],
  });
}

initMap();
```

*Adapted from
[`samples/map-id-style/index.ts`](https://github.com/googlemaps/js-samples/blob/HEAD/samples/map-id-style/index.ts?utm_campaign=gmp_git_agentskills_v1)
and
[`samples/add-map/index.ts`](https://github.com/googlemaps/js-samples/blob/HEAD/samples/add-map/index.ts?utm_campaign=gmp_git_agentskills_v1).*

### Web Components (`<gmp-map>`)

If using Google Maps Web Components in HTML, set the `map-id` and
`internal-usage-attribution-ids` attributes directly on the element:

```html
<gmp-map
  center="48.85,2.35"
  zoom="12"
  map-id="YOUR_MAP_ID"
  internal-usage-attribution-ids="gmp_git_agentskills_v1"
></gmp-map>
```

### React (`@vis.gl/react-google-maps`)

When using `@vis.gl/react-google-maps`, pass the `mapId` and
`internalUsageAttributionIds` props to the `<Map>` component. You can also
switch between cloud-based Map IDs and local JSON `styles` dynamically.

> **Important Billing & Lifecycle Note:** Due to how the Maps JavaScript API
> works, changing the `mapId` prop at runtime requires creating a new
> `google.maps.Map` instance under the hood, which counts toward paid map loads.

```tsx
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { APIProvider, Map } from '@vis.gl/react-google-maps';

export type MapConfig = {
  id: string;
  label: string;
  mapId?: string;
  mapTypeId?: string;
  styles?: google.maps.MapTypeStyle[];
};

const MAP_CONFIGS: MapConfig[] = [
  {
    id: 'light',
    label: 'Cloud Style - Light',
    mapId: '49ae42fed52588c3',
    mapTypeId: 'roadmap',
  },
  {
    id: 'dark',
    label: 'Cloud Style - Dark',
    mapId: '739af084373f96fe',
    mapTypeId: 'roadmap',
  },
  {
    id: 'hybrid-styled',
    label: 'Hybrid ("light" mapId)',
    mapId: '49ae42fed52588c3',
    mapTypeId: 'hybrid',
  },
];

const API_KEY = process.env.GOOGLE_MAPS_API_KEY as string;

const App = () => {
  const [mapConfig, setMapConfig] = useState<MapConfig>(MAP_CONFIGS[0]);

  return (
    <APIProvider apiKey={API_KEY}>
      <div style={{ marginBottom: '8px' }}>
        <label htmlFor="style-select">Map Configuration: </label>
        <select
          id="style-select"
          value={mapConfig.id}
          onChange={(ev) =>
            setMapConfig(MAP_CONFIGS.find((s) => s.id === ev.target.value)!)
          }
        >
          {MAP_CONFIGS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ width: '100%', height: '500px' }}>
        <Map
          defaultCenter={{ lat: 22, lng: 0 }}
          defaultZoom={3}
          mapId={mapConfig.mapId || null}
          mapTypeId={mapConfig.mapTypeId}
          styles={mapConfig.styles}
          gestureHandling="greedy"
          disableDefaultUI={true}
          internalUsageAttributionIds={['gmp_git_agentskills_v1']}
        />
      </div>
    </APIProvider>
  );
};

export default App;
```

*Adapted from
[`examples/change-map-styles/src/app.tsx`](https://github.com/visgl/react-google-maps/blob/HEAD/examples/change-map-styles/src/app.tsx?utm_campaign=gmp_git_agentskills_v1)
and
[`examples/change-map-styles/src/control-panel.tsx`](https://github.com/visgl/react-google-maps/blob/HEAD/examples/change-map-styles/src/control-panel.tsx?utm_campaign=gmp_git_agentskills_v1).*

--------------------------------------------------------------------------------

## Alternative: Local Client-Side JSON Styling (Legacy / Import Source)

While cloud-based styling via `mapId` is recommended for cross-platform
reusability and dynamic updates, you can also define a
`google.maps.MapTypeStyle[]` array in code (or export this JSON structure to
import into the Cloud Console **JSON** tab when creating a cloud style).

```typescript
const nightModeStyles: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#263c3f" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
];

async function initStyledMap(): Promise<void> {
  const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;

  const map = new Map(document.getElementById("map") as HTMLElement, {
    center: { lat: 40.674, lng: -73.945 },
    zoom: 12,
    styles: nightModeStyles,
    internalUsageAttributionIds: ["gmp_git_agentskills_v1"],
  });
}

initStyledMap();
```

*Adapted from
[`samples/style-array/index.ts`](https://github.com/googlemaps/js-samples/blob/HEAD/samples/style-array/index.ts?utm_campaign=gmp_git_agentskills_v1).*
