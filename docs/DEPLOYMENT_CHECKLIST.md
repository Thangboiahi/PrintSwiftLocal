# PrintSwift Local — Production Deployment Checklist

## 1. Environment Variables
Ensure the following environment variables are configured in your production hosting provider (e.g., Vercel, Cloud Run) and validated via `lib/env.ts`:
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. Google Maps Platform & API Key Security
- Restrict Google Maps API Key in Google Cloud Console via HTTP referrers (e.g., `https://your-production-domain.com/*`).
- Restrict the API key to only the required Google Maps Platform APIs (`Maps JavaScript API`, `Places API`, `Geolocation API`).
- Configure quota limits and billing alerts in Google Cloud Console to prevent unexpected usage spikes.

## 3. Supabase Database & Storage Security
- Verify Row-Level Security (RLS) policies are enabled on `users`, `listings`, `media`, and `categories`.
- Confirm the `media` storage bucket enforces the 5MB file size limit and restricts MIME types to `image/jpeg`, `image/png`, and `image/webp`.

## 4. Pre-Launch Verification
- Run `bun test`, `tsc --noEmit`, and `eslint .` to confirm zero build or lint regressions.
- Verify OpenGraph social sharing cards and SEO metadata on the production URL.
