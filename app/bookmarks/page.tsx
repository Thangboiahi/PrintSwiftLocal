import { redirect } from 'next/navigation';

export default function BookmarksRedirectPage() {
  redirect('/saved');
}
