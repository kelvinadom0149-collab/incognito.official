import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Stripe from 'stripe';
import { requireReviewer } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const decisionSchema=z.object({action:z.enum(['APPROVE','REQUEST_CHANGES','REJECT','BAN_SELLER']),reason:z.string().trim().max(1000).optional()});

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const reviewer=await requireReviewer(request);
    const {id}=await params;const body=decisionSchema.parse(await request.json());
    const product=await prisma.product.findUnique({where:{id},include:{seller:true}});if(!product)return NextResponse.json({error:'Listing not found'},{status:404});

    if(body.action==='APPROVE'){
      await prisma.product.update({where:{id},data:{status:'LIVE',slug:product.slug.startsWith('draft-')?`${product.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}-${product.seller.alias.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`:product.slug,lastVerifiedAt:new Date()}});
      await prisma.verificationLog.create({data:{productId:id,sellerId:product.sellerId,stage:'MANUAL',decision:'APPROVED',reviewerId:reviewer.sub,reason:'Approved by reviewer'}});
    } else if(body.action==='REQUEST_CHANGES'){
      await prisma.product.update({where:{id},data:{status:'AWAITING_SELLER_EDIT',sellerEditNote:body.reason||'Please update this listing and resubmit.'}});
      await prisma.verificationLog.create({data:{productId:id,sellerId:product.sellerId,stage:'MANUAL',decision:'CHANGES_REQUESTED',reviewerId:reviewer.sub,reason:body.reason||null}});
    } else if(body.action==='REJECT'){
      await prisma.product.update({where:{id},data:{status:'REJECTED_STAGE_2',rejectionReason:body.reason||'Listing rejected after manual review'}});
      await prisma.verificationLog.create({data:{productId:id,sellerId:product.sellerId,stage:'MANUAL',decision:'REJECTED',reviewerId:reviewer.sub,reason:body.reason||null}});
    } else {
      await prisma.seller.update({where:{id:product.sellerId},data:{blocked:true,payoutFrozen:true}});
      await prisma.product.updateMany({where:{sellerId:product.sellerId},data:{status:'ARCHIVED'}});
      await prisma.verificationLog.create({data:{productId:id,sellerId:product.sellerId,stage:'MANUAL',decision:'SELLER_BANNED',reviewerId:reviewer.sub,reason:'Seller banned and listings archived'}});
      if(process.env.STRIPE_SECRET_KEY&&product.seller.stripeAccountId){const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);await stripe.accounts.update(product.seller.stripeAccountId,{capabilities:{transfers:{requested:false}}}).catch(()=>{})}
    }
    return NextResponse.json({ok:true,status:body.action==='APPROVE'?'LIVE':body.action==='REQUEST_CHANGES'?'AWAITING_SELLER_EDIT':body.action==='REJECT'?'REJECTED_STAGE_2':'ARCHIVED'});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:'Invalid decision'}, {status:400});
    if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Authentication required'}, {status:401});
    return NextResponse.json({error:'Decision could not be saved'}, {status:500});
  }
}
