'use client';

import { useEffect, useState } from 'react';

type Product={id:string;listingId:string;title:string;priceUsdCents:number;imageUrls:string[];seller:{alias:string;kycStatus:string};aiRiskScore:number;createdAt:string};

export default function AdminReviewQueue(){const [items,setItems]=useState<Product[]>([]);const [status,setStatus]=useState('');
  async function load(){const token=localStorage.getItem('incognito_admin_token');const response=await fetch('/api/admin/review',{headers:{Authorization:`Bearer ${token||''}`}});if(!response.ok){setStatus('Authentication required');return}setItems(await response.json())}
  useEffect(()=>{load()},[]);
  async function decide(id:string,action:string){const reason=action==='REQUEST_CHANGES'||action==='REJECT'?window.prompt('Reason or reviewer note')||undefined:undefined;const token=localStorage.getItem('incognito_admin_token');const response=await fetch(`/api/products/${id}/decision`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token||''}`},body:JSON.stringify({action,reason})});if(!response.ok){setStatus('Decision failed');return}setStatus('Decision saved');load()}
  return <section><p role="status">{status}</p><div className="grid">{items.map(product=>{const urgent=Date.now()-new Date(product.createdAt).getTime()>22*60*60*1000;return <article className="card" key={product.id}><b>{urgent?'[URGENT] ':''}{product.title}</b><p>{product.listingId} · $ {((product.priceUsdCents||0)/100).toFixed(2)}</p><div className="preview-grid">{product.imageUrls.map(url=><img key={url} src={url} alt=""/> )}</div><p>Seller {product.seller.alias} · KYC {product.seller.kycStatus} · Risk {product.aiRiskScore}/100</p><div className="row"><button className="button" onClick={()=>decide(product.id,'APPROVE')}>Approve</button><button className="button secondary" onClick={()=>decide(product.id,'REQUEST_CHANGES')}>Request Changes</button><button className="button secondary" onClick={()=>decide(product.id,'REJECT')}>Reject</button><button className="button secondary" onClick={()=>decide(product.id,'BAN_SELLER')}>Ban Seller</button></div></article>})}</div>{items.length===0&&<p>No pending listings.</p>}</section>
}
