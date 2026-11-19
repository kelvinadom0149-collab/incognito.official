import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';

function authorized(request:NextRequest){return request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`}
export async function GET(request:NextRequest){
  if(!authorized(request))return NextResponse.json({error:'Unauthorized'}, {status:401});
  const now=new Date();const urgentAt=new Date(now.getTime()-22*60*60*1000);const autoApproveAt=new Date(now.getTime()-48*60*60*1000);
  const urgent=await prisma.product.findMany({where:{status:'PENDING_STAGE_2',createdAt:{lte:urgentAt,gt:autoApproveAt}},include:{seller:true},orderBy:{createdAt:'asc'}});
  const expired=await prisma.product.findMany({where:{status:'PENDING_STAGE_2',createdAt:{lte:autoApproveAt}},include:{seller:true}});

  if(process.env.RESEND_API_KEY&&process.env.REVIEW_TEAM_EMAIL&&urgent.length){const resend=new Resend(process.env.RESEND_API_KEY);await Promise.all(urgent.map(product=>resend.emails.send({from:'noreply@incognito.com',to:process.env.REVIEW_TEAM_EMAIL,subject:`[URGENT] 🚨 New Product Verification — ${product.seller.alias} — ${product.listingId}`,text:`The listing ${product.listingId} (${product.title}) is still awaiting manual review.`,html:`<p><b>[URGENT]</b> Listing ${product.listingId} requires review.</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL}/admin/review">Open review queue</a></p>`}))).catch(()=>{})}
  await Promise.all(expired.map(product=>prisma.$transaction([prisma.product.update({where:{id:product.id},data:{status:'LIVE',auditFlag:true,autoApprovedAt:new Date()} }),prisma.verificationLog.create({data:{productId:product.id,sellerId:product.sellerId,stage:'MANUAL',decision:'AUTO_APPROVED',reason:'48-hour SLA elapsed; post-review audit required',metadata:{auditFlag:true}}})])));
  return NextResponse.json({urgentEmails:urgent.length,autoApproved:expired.length});
}
