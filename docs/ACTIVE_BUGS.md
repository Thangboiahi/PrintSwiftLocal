# Active Bugs & Resolution Log

[FIXED] | B-01 | DiscoveryWorkspace.tsx | Maximum update depth exceeded in setMarkerRef caused by inline component/unstable keys.
[FIXED] | B-02 | Supabase | Could not find the table 'public.listings' in schema cache. Generated SQL migration.
[FIXED] | B-03 | Supabase | Missing relation 'profiles' and sub-tables. Generated full schema migration.
[FIXED] | B-04 | Supabase | Updated public.listings columns to match full schema requirements.
[FIXED] | B-05 | Supabase | Added missing updated_at column to public.listings.
[FIXED] | B-07 | lib/store.tsx | The result of getSnapshot should be cached to avoid an infinite loop.
[FIXED] | B-08 | DiscoveryWorkspace.tsx | Cannot read properties of undefined (reading 'bg') on marker colors.
[FIXED] | B-09 | AppShell/Images | An empty string was passed to the src attribute causing render loops. Added null fallbacks.
[FIXED] | B-10 | Layout | Grouped search and filters into the smart sticky header to maximize mobile map real estate on scroll.
[FIXED] | B-11 | Layout | Resolved landscape sticky header glitches by migrating to a fixed Framer Motion header with map drag/list scroll syncing.
[FIXED] | B-12 | Layout | Resolved map UI overlaps, converted Sort to a backdrop popup, and wrapped category list.
[FIXED] | B-13 | Layout | Fixed map toolbar overlapping the listings panel by enforcing strict z-index stacking contexts.
[FIXED] | B-14 | Layout | Separated expanded category list into a distinct flex-wrapped block below the main filters, maintaining inline horizontal scrolling for the collapsed state.
[FIXED] | B-15 | Layout | Unified Filters, Sort, and collapsed categories into a single horizontally scrollable track.
[FIXED] | B-16 | Layout | Resolved Sort dropdown clipping via fixed popup. Fixed Search this Area overlaps.
[FIXED] | B-17 | Map | Excluded selected listing from cluster counts so the active pin is always visible. Dispersed stacked coordinates.
[FIXED] | B-18 | Layout & Data | Fixed DiscoveryWorkspace bleeding into other tabs by enforcing CSS hidden state. Restored accurate UI listing count while maintaining cluster exclusion.
[FIXED] | B-19 | Layout | Separated Status Pill and Search Area button vertical spacing to prevent overlap.
[FIXED] | B-21 | UI/UX | Reversed inverted scroll physics for sticky header and audited hardcoded dark theme classes.
[FIXED] | B-22 | Layout | Restored desktop/landscape flexbox grid and integrated vertical rail navigation clearances.
[FIXED] | B-23 | UI/UX | Replaced interactive MapStatusPill with non-interactive GlobalStatusPill. Restored Search Area button placement.
[FIXED] | B-24 | Layout | Shifted split-screen layout to 'lg' breakpoint making mobile landscape the default. Fixed chatbot mobile visibility.
[FIXED] | B-25 | UI/UX | Converted map overlay logo to icon-only and relocated GlobalStatusPill to bottom-center of map.
[FIXED] | B-26 | UI/UX | Decoupled map toolbox from page scroll physics. Hid Search Area button when header is scrolled away.
[FIXED] | B-22 | Layout | Shifted split-screen layout from md to lg breakpoint. Fixed chatbot mobile visibility.
[FIXED] | B-23 | UI/UX | Relocated GlobalStatusPill to bottom. Decoupled toolbox from scroll. Repositioned Search Area.
[FIXED] | B-27 | UI/UX | Fixed map logo overlap in landscape, synced toolbox/search motion with header, moved status pill to top, and enforced vertical nav on mobile landscape.
