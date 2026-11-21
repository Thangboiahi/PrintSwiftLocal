import { redirect } from 'next/navigation';

export default function DriverRedirectPage() {
  redirect('/workspace?hat=driver');
}
