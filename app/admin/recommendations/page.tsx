import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import RecommendationAnalytics from '@/components/RecommendationAnalytics';

export default async function RecommendationsPage(){const cookieStore=await cookies();const token=cookieStore.get('incognito_admin_token')?.value;if(!token||!process.env.ADMIN_JWT_SECRET)redirect('/admin/login');try{const {payload}=await jwtVerify(token,new TextEncoder().encode(process.env.ADMIN_JWT_SECRET));if(payload.role!=='REVIEWER'&&payload.role!=='ADMIN')redirect('/admin/login')}catch{redirect('/admin/login')};const questions=await prisma.buyingQuestion.findMany({where:{status:'OPEN'},orderBy:{capturedAt:'desc'},take:100});const recommendations=await prisma.recommendation.findMany({orderBy:{createdAt:'desc'},take:100});return <main className="shell"><h1>Buying recommendations</h1><section className="grid">{questions.map(q=><article className="card" key={q.id}><b>{q.query}</b><p>{q.source} · Score {q.relevanceScore}</p></article>)}</section><RecommendationAnalytics rows={recommendations.map(r=>({id:r.id,clicks:r.clicks,conversions:r.conversions,publishedUrl:r.publishedUrl}))}/></main>}
