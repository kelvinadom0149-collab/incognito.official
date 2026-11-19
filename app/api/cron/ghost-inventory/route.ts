import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function authorized(request:NextRequest){return request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`}
export async function GET(request:NextRequest){
  if(!authorized(request))return NextResponse.json({error:'Unauthorized'}, {status:401});
  const cutoff=new Date(Date.now()-90*24*60*60*1000);const archiveCutoff=new Date(Date.now()-7*24*60*60*1000);
  const stale=await prisma.product.findMany({where:{status:'LIVE',lastVerifiedAt:{lt:cutoff},views:{lt:5},soldCount:0}});
  await prisma.product.updateMany({where:{status:'LIVE',lastVerifiedAt:{lt:archiveCutoff}},data:{status:'ARCHIVED'}});
  // Masked seller notifications are intentionally provider-neutral; wire this batch to Resend or masked chat.
  return NextResponse.json({stillAvailablePrompts:stale.length,autoArchived:archiveCutoff.toISOString()});
}
