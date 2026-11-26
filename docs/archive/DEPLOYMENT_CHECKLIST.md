# PrintSwift Local — Production Deployment Checklist

## Launch Protocol (Vercel, Google Cloud, Supabase)

1. **Add Custom Domain to Vercel**
   - Connect the repository to Vercel and assign your custom production domain under **Project Settings → Domains**.
   - Configure required environment variables (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) in **Project Settings → Environment Variables**. Builds fail fatally via `lib/env.ts` / `next.config.ts` if any required variable is missing.

2. **Google Cloud Console: Restrict Maps API Key Referrers**
   - Restrict the Maps API Key HTTP referrers strictly to the Vercel production domain (e.g., `https://your-vercel-production-domain.com/*`) and `http://localhost:3000/*`.
   - Restrict API access strictly to `Maps JavaScript API`, `Places API`, `Directions API`, and `Geolocation API`.
   - Configure quota limits and billing alerts in Google Cloud Console to prevent unexpected usage spikes.

3. **Supabase Dashboard: Update Auth Redirect URLs & RLS**
   - Update **Authentication → URL Configuration → Site URL** and **Redirect URLs** in the Supabase Dashboard to match the Vercel production domain (e.g., `https://your-vercel-production-domain.com/**`).
   - Run `supabase/migrations/00014_production_rls.sql` and verify Row-Level Security (RLS) is enabled on `listings`, `profiles`, `categories`, `enquiries`, `notifications`, and `activity_logs` (public `SELECT` allowed only for published `listings` and `categories`; all mutations require `auth.uid()`).
   - Confirm the `media` storage bucket enforces the 5MB file size limit and restricts MIME types to `image/jpeg`, `image/png`, and `image/webp`.

## Pre-Launch Verification
- Run `npm run build`, `npm run lint`, and `node --test lib/rules.test.ts` to confirm zero build, lint, or domain rule regressions.
- Verify OpenGraph social sharing cards and SEO metadata on the production URL.
