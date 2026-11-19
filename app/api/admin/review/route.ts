import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireReviewer } from '@/lib/auth';

export async function GET(request:NextRequest){
  try{await requireReviewer(request)}catch{return NextResponse.json({error:'Reviewer authentication required'}, {status:401})}
  const rows=await prisma.product.findMany({where:{status:'PENDING_STAGE_2'},include:{seller:{select:{alias:true,kycStatus:true}}},orderBy:{createdAt:'asc'}});
  return NextResponse.json(rows);
}
