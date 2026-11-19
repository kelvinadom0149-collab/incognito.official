import { PrismaClient, Condition, FulfillmentMethod, ProductStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.recommendation.deleteMany();
  await prisma.buyingQuestion.deleteMany();
  await prisma.verificationLog.deleteMany();
  await prisma.product.deleteMany();
  await prisma.seller.deleteMany();

  const sellers = await Promise.all([
    prisma.seller.create({ data: { alias: 'Maker-Kofi', emailHash: 'seed-kofi-email-hash', kycStatus: 'VERIFIED', stripeAccountStatus: 'ACTIVE', accountAgeAtReview: 47, totalPreviousSales: 12, reputationScore: 4.9, previousDisputes: 0 } }),
    prisma.seller.create({ data: { alias: 'Atelier-Ama', emailHash: 'seed-ama-email-hash', kycStatus: 'VERIFIED', stripeAccountStatus: 'ACTIVE', accountAgeAtReview: 33, totalPreviousSales: 8, reputationScore: 4.7, previousDisputes: 1 } }),
    prisma.seller.create({ data: { alias: 'Weaver-Yaw', emailHash: 'seed-yaw-email-hash', kycStatus: 'VERIFIED', stripeAccountStatus: 'ACTIVE', accountAgeAtReview: 61, totalPreviousSales: 21, reputationScore: 4.8, previousDisputes: 0 } }),
  ]);

  const products = [
    ['Woven Market Tote', 'Fashion', 'NEW', 18500, 6, 'LIVE', 'kente market tote woven natural fibres'],
    ['Kente Accent Cushion', 'Fashion', 'NEW', 26000, 5, 'LIVE', 'handmade kente accent cushion'],
    ['Cocoa Candle', 'Home', 'NEW', 9500, 10, 'LIVE', 'small batch cocoa scented candle'],
    ['Shea Body Butter', 'Beauty', 'NEW', 12000, 15, 'LIVE', 'unrefined Ghanaian shea body butter'],
    ['Ceramic Cup Set', 'Home', 'NEW', 17500, 0, 'SOLD_OUT', 'hand thrown ceramic cups'],
    ['Ghana Cocoa Nibs', 'General', 'NEW', 6800, 20, 'LIVE', 'fermented Ghana cocoa nibs'],
    ['Everyday Linen Shirt', 'Fashion', 'NEW', 31000, 3, 'LIVE', 'relaxed linen shirt made in Accra'],
    ['Vintage Camera', 'Electronics', 'USED', 52000, 1, 'PENDING_STAGE_2', 'verified vintage film camera'],
    ['African Black Soap', 'Beauty', 'NEW', 4200, 25, 'LIVE', 'plantain ash and shea black soap'],
    ['Antique Brass Bell', 'Collectibles', 'USED', 84000, 1, 'PENDING_STAGE_2', 'antique brass ceremonial bell'],
  ] as const;

  const createdProducts = [];
  for (let index = 0; index < products.length; index++) {
    const [title, category, condition, priceUsdCents, quantity, status, description] = products[index];
    const seller = sellers[index % sellers.length];
    const slugTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const listingId = `INC-LST-${String(index + 1001).padStart(4, '0')}`;
    createdProducts.push(await prisma.product.create({
      data: {
        listingId,
        sellerId: seller.id,
        title,
        slug: `${slugTitle}-${seller.alias.toLowerCase()}`,
        category,
        condition: condition as Condition,
        priceUsdCents,
        quantity,
        soldCount: status === 'SOLD_OUT' ? quantity + 1 : 0,
        description,
        imageUrls: [`https://placehold.co/800x800/png?text=${encodeURIComponent(title)}`],
        fulfillment: 'BLIND_SHIPPING' as FulfillmentMethod,
        status: status as ProductStatus,
        aiRiskScore: status === 'PENDING_STAGE_2' ? 12 : 8,
        lastVerifiedAt: new Date(),
      },
    }));
  }

  const questions = [
    ['best budget diving watch', 'reddit', 'https://www.reddit.com/r/Watches/search?q=budget%20diving%20watch'],
    ['gift for Ghanaian home', 'google', 'https://www.google.com/search?q=gift+for+ghanaian+home'],
    ['durable market tote', 'reddit', 'https://www.reddit.com/r/BuyItForLife/search?q=market+tote'],
    ['natural skincare gift set', 'google', 'https://www.google.com/search?q=natural+skincare+gift+set'],
    ['handmade ceramic cups', 'reddit', 'https://www.reddit.com/r/BuyItForLife/search?q=ceramic+cups'],
  ] as const;

  for (let index = 0; index < questions.length; index++) {
    const [query, source, sourceUrl] = questions[index];
    const question = await prisma.buyingQuestion.create({
      data: { query, source, sourceUrl, relevanceScore: 72 + index, status: index < 3 ? 'OPEN' : 'DRAFTED', googleResult: 'Example ranked source capture', redditResult: 'Example Reddit thread capture' },
    });
    await prisma.recommendation.create({
      data: {
        questionId: question.id,
        productId: createdProducts[index % createdProducts.length].id,
        draftBody: `Reason to choose: ${createdProducts[index % createdProducts.length].title} is a relevant, privacy-friendly option with a verified seller alias and transparent availability.`,
        googleResult: 'Example Google top-3 capture',
        redditResult: 'Example Reddit top-3 capture',
        status: index < 2 ? 'PUBLISHED' : 'DRAFTED',
        publishedUrl: index < 2 ? `https://example.com/recommendations/${question.id}` : null,
        publishedAt: index < 2 ? new Date() : null,
        clicks: index * 12,
        conversions: index,
      },
    });
  }

  console.log('Seeded 3 sellers, 10 products, 5 buying questions, and 5 recommendations.');
}

main().finally(() => prisma.$disconnect()).catch((error) => { console.error(error); process.exit(1); });
