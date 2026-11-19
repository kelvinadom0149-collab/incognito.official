import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireReviewer } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{await requireReviewer(request);const {id}=await params;const body=z.object({draftBody:z.string().min(80).max(10000),publishedUrl:z.string().url().optional(),publishedAt:z.coerce.date().optional(),status:z.enum(['DRAFTED','PUBLISHED','SKIPPED']).optional()}).parse(await request.json());if(!body.draftBody.toLowerCase().includes('reason to choose'))return NextResponse.json({error:'A clear reason to choose is required'}, {status:400});const updated=await prisma.recommendation.update({where:{id},data:{draftBody:body.draftBody,publishedUrl:body.publishedUrl,publishedAt:body.publishedAt,status:body.status||'DRAFTED'}});return NextResponse.json(updated)}catch(error){if(error instanceof z.ZodError)return NextResponse.json({error:'Invalid recommendation'}, {status:400});return NextResponse.json({error:'Update failed'}, {status:500})}}
