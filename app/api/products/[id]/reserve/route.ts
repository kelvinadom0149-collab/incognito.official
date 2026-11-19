import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const product=await prisma.product.findUnique({where:{id}});
  if(!product||product.status!=='LIVE')return NextResponse.json({error:'This listing is not available'}, {status:409});
  if(product.quantity<=0||product.reservedUntil&&product.reservedUntil>new Date())return NextResponse.json({error:'This item is reserved or sold out'}, {status:409});
  const updated=await prisma.product.update({where:{id},data:{reservedUntil:new Date(Date.now()+10*60*1000)}});
  return NextResponse.json({reservedUntil:updated.reservedUntil,status:'reserved'});
}
