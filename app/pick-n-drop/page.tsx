import { redirect } from 'next/navigation';

interface PickNDropRedirectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PickNDropRedirectPage({
  searchParams,
}: PickNDropRedirectPageProps) {
  const rawParams = await searchParams;
  const params = new URLSearchParams();

  if (rawParams && typeof rawParams === 'object') {
    for (const [key, value] of Object.entries(rawParams)) {
      if (key === 'mode') continue;
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string' && entry.length > 0) {
            params.append(key, entry);
          }
        }
      } else if (typeof value === 'string' && value.length > 0) {
        params.set(key, value);
      }
    }
  }

  params.set('mode', 'pick_n_drop');
  redirect(`/explore?${params.toString()}`);
}
