'use client';

import { BrandStatusLogo, type BrandStatusLogoProps, type BrandStatusType } from './BrandStatusLogo';

export { BrandStatusLogo };
export type { BrandStatusLogoProps, BrandStatusType };

export function BrandLogoStatus(props: BrandStatusLogoProps) {
  return <BrandStatusLogo {...props} />;
}

export default BrandStatusLogo;



