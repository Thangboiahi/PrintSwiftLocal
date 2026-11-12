This document details the usage patterns for implementing dynamic marker
clustering within a React application using the `@vis.gl/react-google-maps` SDK
and the external `@googlemaps/markerclusterer` library. The core challenge
addressed is how to manage the lifecycle and state of native
`google.maps.Marker` objects when they are created declaratively within a React
component tree, but must be controlled externally by the clusterer.

--------------------------------------------------------------------------------

## I. Core Component Structure and Data Handling

The application uses the standard structure: `APIProvider` wraps the
application, and the `Map` component provides the context. Data loading and
filtering occur at the root level, ensuring the map children only receive the
final, filtered list of items (`Tree[]`).

### 1. Application Initialization (`app.tsx` pattern)

This structure demonstrates lazy data loading and dynamic filtering based on
user input, which triggers re-rendering of the clustered markers.

```tsx
import React, {useEffect, useState, useMemo} from 'react';
import {APIProvider, Map} from '@vis.gl/react-google-maps';

// --- STUBS for Context ---
// Assume these types and utilities exist
interface Tree {
  key: string;
  name: string;
  category: string;
  position: { lat: number; lng: number };
}
const loadTreeDataset = async (): Promise<Tree[]> => {/* returns data */ return [];};
const getCategories = (trees?: Tree[]) => trees ? Array.from(new Set(trees.map(t => t.category))) : [];
const ControlPanel = ({ categories, onCategoryChange }: any) => null;
// -------------------------

const App = () => {
  const [trees, setTrees] = useState<Tree[]>();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 1. Asynchronously load map data
  useEffect(() => {
    loadTreeDataset().then(data => setTrees(data));
  }, []);

  // 2. Filter data based on selected criteria
  const filteredTrees = useMemo(() => {
    if (!trees) return null;
    return trees.filter(
      t => !selectedCategory || t.category === selectedCategory
    );
  }, [trees, selectedCategory]);

  return (
    <APIProvider apiKey={'YOUR_API_KEY'}>
      <Map
        mapId={'bf51a910020fa25a'}
        defaultCenter={{lat: 43.64, lng: -79.41}}
        defaultZoom={10}
        gestureHandling={'greedy'}
        disableDefaultUI
        internalUsageAttributionIds={['gmp_git_agentskills_v1']}>
        {/* Pass filtered data to the clustering component */}
        {filteredTrees && <ClusteredTreeMarkers trees={filteredTrees} />}
      </Map>

      <ControlPanel
        categories={getCategories(trees)}
        onCategoryChange={setSelectedCategory}
      />
    </APIProvider>
  );
};
```

--------------------------------------------------------------------------------

## II. Implementing Dynamic Marker Clustering

The `ClusteredTreeMarkers` component is responsible for integrating the React
component lifecycle with the imperative logic of the `MarkerClusterer` utility.
This requires maintaining references to the native `google.maps.Marker` objects
created by the child components.

### 1. Marker Reference Management Pattern

Since `MarkerClusterer` operates by directly manipulating native
`google.maps.Marker` objects, the parent component (`ClusteredTreeMarkers`) must
collect these native instances from its children using a reference callback
pattern (`setMarkerRef`).

```tsx
// clustered-tree-markers.tsx

import {InfoWindow, useMap} from '@vis.gl/react-google-maps';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {type Marker, MarkerClusterer} from '@googlemaps/markerclusterer';

// --- STUBS for Context ---
// Assuming Tree is defined as above
// Assuming TreeMarker is the child component rendering the actual marker
interface Tree { key: string; /* ... */ }
type ClusteredTreeMarkersProps = { trees: Tree[]; };
const TreeMarker = ({ tree, onClick, setMarkerRef }: any) => null; // interface defined below
// -------------------------

export const ClusteredTreeMarkers = ({trees}: ClusteredTreeMarkersProps) => {
  // State to hold the native Marker instances, keyed by the tree ID
  const [markers, setMarkers] = useState<{[key: string]: Marker}>({});
  const [selectedTreeKey, setSelectedTreeKey] = useState<string | null>(null);

  const selectedTree = useMemo(
    () =>
      trees && selectedTreeKey
        ? trees.find(t => t.key === selectedTreeKey)!
        : null,
    [trees, selectedTreeKey]
  );

  // 1. Initialize MarkerClusterer
  const map = useMap();
  const clusterer = useMemo(() => {
    if (!map) return null;
    // Instantiate MarkerClusterer, linking it to the map
    return new MarkerClusterer({map});
  }, [map]);

  // 2. Callback function passed to children to manage native Marker refs
  const setMarkerRef = useCallback((marker: Marker | null, key: string) => {
    setMarkers(currentMarkers => {
      // Logic to add or remove the marker from the state map
      if ((marker && currentMarkers[key]) || (!marker && !currentMarkers[key]))
        return currentMarkers; // No change needed

      if (marker) {
        // Add new marker
        return {...currentMarkers, [key]: marker};
      } else {
        // Remove marker (component unmounting)
        const {[key]: _, ...newMarkers} = currentMarkers;
        return newMarkers;
      }
    });
  }, []);

  // 3. Effect to synchronize the Clusterer when the list of markers changes
  useEffect(() => {
    if (!clusterer) return;

    // CRITICAL: Clear all old markers and add all current markers
    // This handles component remounting and dynamic filtering efficiently.
    clusterer.clearMarkers();
    clusterer.addMarkers(Object.values(markers));
  }, [clusterer, markers]); // Reruns whenever map or marker state updates

  const handleInfoWindowClose = useCallback(() => {
    setSelectedTreeKey(null);
  }, []);

  const handleMarkerClick = useCallback((tree: Tree) => {
    setSelectedTreeKey(tree.key);
  }, []);

  return (
    <>
      {trees.map(tree => (
        <TreeMarker
          key={tree.key}
          tree={tree}
          onClick={handleMarkerClick}
          // Pass the reference callback down
          setMarkerRef={setMarkerRef}
        />
      ))}

      {/* InfoWindow anchored to the native Marker instance */}
      {selectedTreeKey && (
        <InfoWindow
          anchor={markers[selectedTreeKey]}
          onCloseClick={handleInfoWindowClose}>
          {selectedTree?.name}
        </InfoWindow>
      )}
    </>
  );
};
```

### 2. The Marker Wrapper Component (`TreeMarker` pattern)

For the reference management pattern to work, the component that actually
renders the Google Maps marker must expose the native `google.maps.Marker`
instance back to the parent `ClusteredTreeMarkers`.

This hypothetical `TreeMarker` component would look like this:

```tsx
// tree-marker.tsx (Conceptual Implementation)
import React, { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { Marker } from '@googlemaps/markerclusterer'; // using the type for consistency

interface TreeMarkerProps {
  tree: Tree;
  onClick: (tree: Tree) => void;
  // This is the required callback signature: (native Marker instance, key)
  setMarkerRef: (marker: Marker | null, key: string) => void;
}

const TreeMarker: React.FC<TreeMarkerProps> = ({ tree, onClick, setMarkerRef }) => {
  const map = useMap();
  const markerRef = useRef<Marker | null>(null);

  // Effect to create and manage the native Marker lifecycle
  useEffect(() => {
    if (!map) return;

    // 1. Create the native Marker object
    const marker = new google.maps.Marker({
      position: tree.position,
      map: map,
      title: tree.name,
      // NOTE: We MUST NOT set 'map: map' here if we intend for the clusterer
      // to manage visibility. The clusterer will handle setting the map property.
      // However, for reference capturing, setting map temporarily or initializing without map
    });

    // 2. Attach click listener
    marker.addListener('click', () => {
      onClick(tree);
    });

    // 3. Store the native instance reference locally and pass it back to the parent
    markerRef.current = marker;
    setMarkerRef(marker, tree.key);

    // 4. Cleanup function runs when component unmounts or dependencies change
    return () => {
      // Remove listeners
      google.maps.event.clearInstanceListeners(marker);

      // Pass null back to the parent to remove the reference
      setMarkerRef(null, tree.key);

      // Optionally remove the marker from the map/clusterer context
      // (The parent useEffect handles the clusterer sync, but detaching is good practice)
      marker.setMap(null);
    };
  }, [map, tree.key, tree.position.lat, tree.position.lng, onClick, setMarkerRef]);

  return null; // This component renders nothing itself, only manages the native marker object
};
```

## III. Best Practices and Gotchas

Feature                      | Best Practice / Gotcha          | Description
:--------------------------- | :------------------------------ | :----------
**Clusterer Initialization** | Use `useMap()` and `useMemo`    | The `MarkerClusterer` must be initialized only once when the `map` instance (from `useMap()`) is available.
**Marker Synchronization**   | `setMarkerRef` Callback Pattern | Due to the declarative nature of React, native objects must be explicitly passed back to the parent component using a custom reference callback (`setMarkerRef`) for external libraries (like the Clusterer) to manage them.
**Clusterer Updates**        | `useEffect` for Synchronization | The `useEffect` hook monitoring `[clusterer, markers]` is essential. Whenever the list of markers changes (due to filtering or mount/unmount), the clusterer must be explicitly cleared and re-populated using `clusterer.clearMarkers()` and `clusterer.addMarkers(Object.values(markers))`.
**InfoWindow Anchoring**     | Anchor to Native Instance       | The `InfoWindow` component must be anchored directly to the native `google.maps.Marker` object (retrieved from the `markers` state) via the `anchor` prop, not to React DOM elements or coordinates.
**`TreeMarker` Render**      | Render `null`                   | The component wrapping the native `google.maps.Marker` should usually return `null` as it only manages an object external to the React DOM tree.
