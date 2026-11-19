import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';

export async function POST(request:NextRequest){
  if(!process.env.STRIPE_SECRET_KEY||!process.env.STRIPE_WEBHOOK_SECRET)return NextResponse.json({error:'Stripe is not configured'}, {status:503});
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);const body=await request.text();const signature=request.headers.get('stripe-signature');
  let event:Stripe.Event;
  try{event=await stripe.webhooks.constructEventAsync(body,signature||'',process.env.STRIPE_WEBHOOK_SECRET)}catch(error){return NextResponse.json({error:'Invalid webhook signature'}, {status:400})}

  if(event.type==='payment_intent.succeeded'){
    const intent=event.data.object as Stripe.PaymentIntent;
    if(intent.currency!=='ghs')return NextResponse.json({error:'Only Ghana cedi payments are accepted'}, {status:400});
    const productId=intent.metadata.productId;const quantity=Math.max(1,Number(intent.metadata.quantity||1));
    if(!productId)return NextResponse.json({received:true});
    const product=await prisma.product.findUnique({where:{id:productId},include:{seller:true}});if(!product)return NextResponse.json({received:true});

    await prisma.$transaction(async(tx)=>{
      const remaining=Math.max(0,product.quantity-quantity);
      await tx.product.update({where:{id:productId},data:{quantity:remaining,soldCount:{increment:quantity},status:remaining===0?'SOLD_OUT':product.status,reservedUntil:null,lastVerifiedAt:new Date()}});
    });

    if(product.seller.stripeAccountId&&intent.amount_received>0){
      const sellerAmount=Math.round(intent.amount_received*0.95);
      await stripe.transfers.create({amount:sellerAmount,currency:intent.currency,destination:product.seller.stripeAccountId,source_transaction:intent.latest_charge?.toString(),metadata:{productId,platformFeePercent:'5'}}).catch(error=>{console.error('Stripe transfer failed',error)});
    }
  }
  return NextResponse.json({received:true});
}
