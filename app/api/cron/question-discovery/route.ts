import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';

function authorized(request:NextRequest){return request.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`}
export async function GET(request:NextRequest){
  if(!authorized(request))return NextResponse.json({error:'Unauthorized'}, {status:401});
  const subs=['BuyItForLife','gadgets','whatcar_shouldbuy','edc','giftideas'];
  const discovered:string[]=[];
  for(const sub of subs){
    try{
      const response=await fetch(`https://www.reddit.com/r/${sub}/search.json?q=what%20to%20buy%20OR%20best&restrict_sr=on&sort=relevance&t=month&limit=5`,{headers:{'User-Agent':process.env.REDDIT_USER_AGENT||'IncognitoMarketplace/1.0'}});
      if(!response.ok)continue;const data=await response.json() as {data?:{children?:Array<{data:{title:string;permalink:string}}>}};
      for(const child of data.data?.children||[])discovered.push(child.data.title);
    }catch{}
  }
  const unique=[...new Set(discovered)].slice(0,25);let created=0;
  if(unique.length&&process.env.OPENAI_API_KEY){
    const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    for(const query of unique){
      const response=await openai.responses.create({model:'gpt-4.1-mini',input:`Extract one concise buying question and catalog category for this Reddit title. Return JSON {query,category}. Title: ${JSON.stringify(query)}`});
      try{
        const parsed=JSON.parse(response.output_text.replace(/```json|```/g,'')) as {query:string};
        const live=await prisma.product.count({where:{status:'LIVE',category:{contains:parsed.query,mode:'insensitive'},quantity:{gt:0}}});
        if(live>0){await prisma.buyingQuestion.create({data:{query:parsed.query,source:'reddit',sourceUrl:'https://www.reddit.com',relevanceScore:50,status:'OPEN'}});created++;}
      }catch{}
    }
  }
  return NextResponse.json({discovered:unique.length,created});
}
