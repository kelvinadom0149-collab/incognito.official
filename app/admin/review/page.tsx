import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import AdminReviewQueue from '@/components/AdminReviewQueue';

export default async function AdminReviewPage(){
  const cookieStore=await cookies();const token=cookieStore.get('incognito_admin_token')?.value;
  if(!token||!process.env.ADMIN_JWT_SECRET)redirect('/admin/login');
  try{const {payload}=await jwtVerify(token,new TextEncoder().encode(process.env.ADMIN_JWT_SECRET));if(payload.role!=='REVIEWER'&&payload.role!=='ADMIN')redirect('/admin/login')}catch{redirect('/admin/login')}
  return <main className="shell"><h1>Review queue</h1><AdminReviewQueue /></main>;
}
