import { redirect } from 'next/navigation';

export default function AdminRedirectPage() {
  redirect('/workspace?hat=master_control');
}
