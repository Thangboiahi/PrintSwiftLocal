import { ListingCategory, PropertyType } from './types';

const CATEGORY_PALETTES: Record<
  ListingCategory,
  { bg1: string; bg2: string; accent: string; label: string }
> = {
  business: {
    bg1: '#0f172a',
    bg2: '#1e3a5f',
    accent: '#38bdf8',
    label: 'SAMPLE BUSINESS MEDIA',
  },
  service: {
    bg1: '#111827',
    bg2: '#1e293b',
    accent: '#a78bfa',
    label: 'SAMPLE SERVICE MEDIA',
  },
  real_estate: {
    bg1: '#062c21',
    bg2: '#0f4c3a',
    accent: '#34d399',
    label: 'SAMPLE REAL-ESTATE MEDIA',
  },
  sports: {
    bg1: '#2e1505',
    bg2: '#5c2b09',
    accent: '#fb923c',
    label: 'SAMPLE VENUE MEDIA',
  },
  public_place: {
    bg1: '#172554',
    bg2: '#1e3a8a',
    accent: '#60a5fa',
    label: 'SAMPLE COMMUNITY MEDIA',
  },
};

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function createListingCoverSvg(
  _title: string,
  category: ListingCategory,
  _locality: string,
  seedIndex: number = 0
): string {
  const palette = CATEGORY_PALETTES[category] || CATEGORY_PALETTES.business;
  const offset = (seedIndex * 37) % 160;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette.bg1}"/>
        <stop offset="100%" stop-color="${palette.bg2}"/>
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="800" height="500" fill="url(#bg)"/>
    <rect width="800" height="500" fill="url(#grid)"/>
    <!-- Topographic & Architectural Silhouette -->
    <path d="M0 370 Q ${200 + offset} 280 420 340 T 800 310 L 800 500 L 0 500 Z" fill="rgba(255,255,255,0.06)"/>
    <path d="M0 410 Q ${320 - offset} 330 560 390 T 800 370 L 800 500 L 0 500 Z" fill="rgba(0,0,0,0.32)"/>
    <g stroke="${palette.accent}" stroke-width="1.5" fill="none" opacity="0.42">
      <rect x="${480 + (offset % 60)}" y="95" width="220" height="200" rx="10"/>
      <line x1="${480 + (offset % 60)}" y1="155" x2="${700 + (offset % 60)}" y2="155"/>
      <line x1="${590 + (offset % 60)}" y1="95" x2="${590 + (offset % 60)}" y2="295"/>
      <circle cx="${590 + (offset % 60)}" cy="195" r="52"/>
      <circle cx="${210 + (offset % 80)}" cy="180" r="85" stroke-dasharray="6 6" opacity="0.5"/>
    </g>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createProductSvg(
  productName: string,
  categoryName: string,
  price: number,
  seed: number = 1
): string {
  const safeName = escapeXml(productName.slice(0, 30));
  const safeCat = escapeXml(categoryName.slice(0, 24));
  const hue = (seed * 47) % 360;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" width="480" height="360">
    <defs>
      <linearGradient id="pbg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${hue}, 35%, 16%)"/>
        <stop offset="100%" stop-color="hsl(${hue}, 45%, 26%)"/>
      </linearGradient>
    </defs>
    <rect width="480" height="360" fill="url(#pbg)"/>
    <circle cx="240" cy="145" r="64" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
    <rect x="195" y="105" width="90" height="80" rx="10" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"/>
    <text x="24" y="34" fill="rgba(255,255,255,0.7)" font-family="system-ui, sans-serif" font-size="11" font-weight="600" letter-spacing="0.8">SAMPLE CATALOGUE ITEM · ${safeCat.toUpperCase()}</text>
    <text x="24" y="295" fill="#ffffff" font-family="system-ui, sans-serif" font-size="20" font-weight="700">${safeName}</text>
    <text x="24" y="324" fill="#38bdf8" font-family="monospace, sans-serif" font-size="15" font-weight="600">Sample Price: ₹${price.toLocaleString('en-IN')}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Generates a valid 2:1 Equirectangular 360° synthetic panorama SVG data URI
 * (2048x1024) for real-estate listings, clearly labelled as demonstration media.
 */
export function createEquirectangularPanoramaSvg(
  propertyTitle: string,
  sceneName: string,
  propertyType: PropertyType,
  sceneVariant: number = 0
): string {
  const safeTitle = escapeXml(propertyTitle.slice(0, 28));
  const safeScene = escapeXml(sceneName.slice(0, 26));
  const isOutdoor =
    propertyType === 'plot_land' ||
    sceneVariant % 2 === 1;

  const skyTop = isOutdoor ? '#0c4a6e' : '#1e293b';
  const skyHorizon = isOutdoor ? '#bae6fd' : '#334155';
  const groundTop = isOutdoor ? '#14532d' : '#475569';
  const groundBottom = isOutdoor ? '#052e16' : '#0f172a';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 1024" width="2048" height="1024">
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${skyTop}"/>
        <stop offset="100%" stop-color="${skyHorizon}"/>
      </linearGradient>
      <linearGradient id="ground" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${groundTop}"/>
        <stop offset="100%" stop-color="${groundBottom}"/>
      </linearGradient>
      <pattern id="panoGrid" width="128" height="64" patternUnits="userSpaceOnUse">
        <path d="M 128 0 L 0 0 0 64" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
      </pattern>
    </defs>
    <!-- Upper hemisphere (Sky / Ceiling) -->
    <rect x="0" y="0" width="2048" height="512" fill="url(#sky)"/>
    <!-- Lower hemisphere (Ground / Floor) -->
    <rect x="0" y="512" width="2048" height="512" fill="url(#ground)"/>
    <!-- Spherical Equirectangular Grid -->
    <rect x="0" y="0" width="2048" height="1024" fill="url(#panoGrid)"/>
    <!-- Horizon Mountain / Architectural Profile across 360° -->
    <path d="M0 512 Q 256 380 512 470 T 1024 410 T 1536 460 T 2048 512 Z" fill="rgba(15,23,42,0.45)"/>
    <!-- Horizon Reference Line (y=512) -->
    <line x1="0" y1="512" x2="2048" y2="512" stroke="#38bdf8" stroke-width="2" stroke-dasharray="10,6"/>
    <!-- Symmetrically Centered Cardinal Survey Panels at N (256), E (768), S (1280), W (1792) -->
    <g stroke="rgba(255,255,255,0.45)" stroke-width="2" fill="rgba(15,23,42,0.78)">
      <rect x="96" y="340" width="320" height="145" rx="10"/>
      <rect x="608" y="340" width="320" height="145" rx="10"/>
      <rect x="1120" y="340" width="320" height="145" rx="10"/>
      <rect x="1632" y="340" width="320" height="145" rx="10"/>
    </g>
    <!-- Clean Non-Overlapping Cardinal & Scene Labels inside each 320px Panel -->
    <g font-family="system-ui, sans-serif" text-anchor="middle">
      <text x="256" y="382" font-size="16" font-weight="700" fill="#ffffff">${safeScene}</text>
      <text x="256" y="414" font-size="12" font-weight="600" fill="#bae6fd">SYNTHETIC 360° DEMO SCENE</text>
      <text x="256" y="458" font-size="22" font-weight="700" fill="#38bdf8">NORTH (0°)</text>

      <text x="768" y="382" font-size="16" font-weight="700" fill="#ffffff">${safeTitle}</text>
      <text x="768" y="414" font-size="12" font-weight="600" fill="#bae6fd">ILLUSTRATIVE SAMPLE MEDIA</text>
      <text x="768" y="458" font-size="22" font-weight="700" fill="#38bdf8">EAST (90°)</text>

      <text x="1280" y="382" font-size="16" font-weight="700" fill="#ffffff">${safeScene}</text>
      <text x="1280" y="414" font-size="12" font-weight="600" fill="#bae6fd">2:1 EQUIRECTANGULAR (2048×1024)</text>
      <text x="1280" y="458" font-size="22" font-weight="700" fill="#38bdf8">SOUTH (180°)</text>

      <text x="1792" y="382" font-size="16" font-weight="700" fill="#ffffff">${safeTitle}</text>
      <text x="1792" y="414" font-size="12" font-weight="600" fill="#bae6fd">360° HORIZONTAL &amp; VERTICAL</text>
      <text x="1792" y="458" font-size="22" font-weight="700" fill="#38bdf8">WEST (270°)</text>
    </g>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const generateCoverImageDataUri = createListingCoverSvg;
export const generateEquirectangularPanoramaDataUri = (
  propertyTitle: string,
  sceneName: string,
  _locality: string,
  sceneVariant: number = 0
) =>
  createEquirectangularPanoramaSvg(
    propertyTitle,
    sceneName,
    'house_with_plot',
    sceneVariant
  );
export const generateProductImageDataUri = (
  productName: string,
  categoryName: string,
  priceInr: number = 500
) => createProductSvg(productName, categoryName, priceInr, 1);

