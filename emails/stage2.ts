export function stage2EmailTemplate(params: {
  listingId: string; title: string; category: string; priceGhs: string; condition: string;
  quantity: number; fulfillment: string; imageCount: number; videoUrl?: string; sellerAlias: string;
  kycStatus: string; stripeStatus: string; accountAge: number; previousSales: number;
  reputation: number; disputes: number; riskScore: number; submittedAt: string; timezone: string;
}) {
  const text = `PRODUCT VERIFICATION REQUEST

Listing ID: ${params.listingId}
Title: ${params.title}
Category: ${params.category}
Price: ${params.priceGhs}
Condition: ${params.condition}
Quantity: ${params.quantity}
Fulfillment: ${params.fulfillment}
Images Uploaded: ${params.imageCount}
Proof-of-Life Video: ${params.videoUrl ? params.videoUrl : 'Not applicable'}

Seller Alias: ${params.sellerAlias}
KYC: ${params.kycStatus}
Stripe Account: ${params.stripeStatus}
Account Age: ${params.accountAge} days
Previous Sales: ${params.previousSales}
Reputation: ${params.reputation}/5.0
Previous Disputes: ${params.disputes}

AI Risk Score: ${params.riskScore}/100
Submitted: ${params.submittedAt} UTC
Seller timezone: ${params.timezone}

Review: ${process.env.NEXT_PUBLIC_APP_URL}/admin/review
`;
  const html = `<main style="font-family:Arial,sans-serif;color:#1a211d"><h1>🚨 [ACTION REQUIRED] New Product Verification — ${params.sellerAlias}</h1><h2>Product details</h2><table><tr><td>Listing ID</td><td>${params.listingId}</td></tr><tr><td>Title</td><td>${params.title}</td></tr><tr><td>Category</td><td>${params.category}</td></tr><tr><td>Price</td><td>${params.priceGhs}</td></tr><tr><td>Condition</td><td>${params.condition}</td></tr><tr><td>Quantity</td><td>${params.quantity}</td></tr><tr><td>Fulfillment</td><td>${params.fulfillment}</td></tr><tr><td>Images</td><td>${params.imageCount}</td></tr><tr><td>Proof-of-Life</td><td>${params.videoUrl ? `<a href="${params.videoUrl}">View signed video</a>` : 'Not applicable'}</td></tr></table><h2>Seller details</h2><p>Alias: ${params.sellerAlias}<br>KYC: ${params.kycStatus}<br>Stripe account: ${params.stripeStatus}<br>Account age: ${params.accountAge} days<br>Previous sales: ${params.previousSales}<br>Reputation: ${params.reputation}/5.0<br>Previous disputes: ${params.disputes}</p><h2>AI risk assessment</h2><p>Risk score: ${params.riskScore}/100</p><p>Submitted at ${params.submittedAt} UTC<br>Seller timezone: ${params.timezone}</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL}/admin/review">Review this product</a></p><p>Approve · Request Changes · Reject · Ban Seller</p></main>`;
  return { text, html };
}
