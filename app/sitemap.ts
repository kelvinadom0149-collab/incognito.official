import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  const products=await prisma.product.findMany({where:{status:'LIVE'},select:{slug:true,updatedAt:true}});
  return products.map(product=>({url:`${process.env.NEXT_PUBLIC_APP_URL}/shop/${product.slug}`,lastModified:product.updatedAt,changeFrequency:'daily',priority:0.8}));
}
