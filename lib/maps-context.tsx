'use client';

import React, { createContext, useContext } from 'react';

const MapsAvailabilityContext = createContext<{ apiKeyAvailable: boolean }>({
  apiKeyAvailable: false,
});

export function MapsAvailabilityProvider({
  apiKeyAvailable,
  children,
}: {
  apiKeyAvailable: boolean;
  children: React.ReactNode;
}) {
  return (
    <MapsAvailabilityContext.Provider value={{ apiKeyAvailable }}>
      {children}
    </MapsAvailabilityContext.Provider>
  );
}

export function useMapsAvailability(): { apiKeyAvailable: boolean } {
  return useContext(MapsAvailabilityContext);
}
