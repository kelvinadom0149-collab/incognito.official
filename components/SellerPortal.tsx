'use client';

import { FormEvent, useEffect, useState } from 'react';

type Listing = { id: string; title: string; category: string; price_pesewas: number; stock: number; status: string; image_url?: string | null };
type AuthMode = 'register' | 'login' | 'verify';
const formatPrice = (amount: number) => `GH₵ ${(amount / 100).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;

export default function SellerPortal() {
  const [mode, setMode] = useState<AuthMode>('register');
  const [token, setToken] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [title, setTitle] = useState(''); const [category, setCategory] = useState('style'); const [description, setDescription] = useState(''); const [price, setPrice] = useState(''); const [stock, setStock] = useState('1'); const [preparation, setPreparation] = useState(''); const [condition, setCondition] = useState('new'); const [images, setImages] = useState<File[]>([]);
  const [proofVideo, setProofVideo] = useState<File | null>(null);
  const [listings, setListings] = useState<Listing[]>([]); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);

  async function refresh(tokenValue = token) {
    if (!tokenValue) return;
    try { const response = await fetch('/api/market/api/seller/products', { headers: { authorization: `Bearer ${tokenValue}` }, cache: 'no-store' }); if (response.ok) setListings(await response.json()); }
    catch { /* upload and account status remain visible */ }
  }
  useEffect(() => { try { const saved = sessionStorage.getItem('incognito-seller-token'); if (saved) { setToken(saved); void refresh(saved); } } catch { /* storage may be disabled */ } }, []);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus('');
    try {
      const path = mode === 'register' ? '/api/auth/register' : mode === 'verify' ? '/api/auth/verify' : '/api/auth/login';
      const body = mode === 'register' ? { full_name: name, phone, email: email || undefined, password, role: 'seller' } : mode === 'verify' ? { phone, code } : { phone, password };
      const response = await fetch(`/api/market${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json();
      if (!response.ok && mode === 'register' && response.status === 503) { setMode('verify'); setStatus('Account saved, but WhatsApp could not deliver your code. Retry when verification is available.'); return; }
      if (!response.ok) throw new Error(data.detail || 'Account request failed.');
      if (mode === 'register') { setMode('verify'); setStatus('Check WhatsApp for your six-digit verification code.'); }
      else if (mode === 'verify') { setMode('login'); setStatus(data.message || 'Phone verified. Your seller account must be approved before you can sign in.'); }
      else { setToken(data.access_token); try { sessionStorage.setItem('incognito-seller-token', data.access_token); } catch { /* in-memory session */ } setStatus('Signed in. Your seller identity stays private from customers.'); void refresh(data.access_token); }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Account request failed.'); }
    finally { setBusy(false); }
  }

  async function requestAnotherCode() {
    setBusy(true); setStatus('');
    try { const response = await fetch('/api/market/api/auth/otp/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) }); const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'Could not request a code.'); setStatus(data.message || 'If your account is waiting for verification, a code has been sent.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not request a code.'); }
    finally { setBusy(false); }
  }

  async function uploadOne(file: File) {
    const signed = await fetch('/api/market/api/seller/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content_type: file.type, size_bytes: file.size }) });
    const upload = await signed.json(); if (!signed.ok) throw new Error(upload.detail || 'Could not prepare a secure upload.');
    const data = new FormData(); Object.entries(upload.upload.fields as Record<string,string>).forEach(([key,value]) => data.append(key,value)); data.append('file',file);
    const result = await fetch(upload.upload.url, { method: 'POST', body: data }); if (!result.ok) throw new Error('Image upload failed. Check your image and try again.'); return upload.key as string;
  }

  async function submitListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus('Uploading listing…');
    try {
      if (images.length < 1 || images.length > 8) throw new Error('Choose between 1 and 8 product photos.');
      if (images.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) throw new Error('Each photo must be JPEG, PNG or WebP and 5 MB or less.');
      const pesewas = Math.round(Number(price) * 100); if (pesewas > 100_000 && !proofVideo) throw new Error('Add a proof-of-life video for listings over GH₵1,000. Seller reputation requirements also apply.');
      if (proofVideo && (proofVideo.size > 100 * 1024 * 1024 || !['video/mp4', 'video/webm', 'video/quicktime'].includes(proofVideo.type))) throw new Error('Proof video must be MP4, WebM or MOV and under 100 MB.');
      const keys = await Promise.all(images.map(uploadOne)); const proofKey = proofVideo ? await uploadOne(proofVideo) : undefined;
      const response = await fetch('/api/market/api/seller/products', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title, category, description, price_pesewas: pesewas, stock: Number(stock), preparation, condition, delivery_available: true, negotiable: false, specifications: 'Seller listing', fulfillment: 'blind_shipping', image_key: keys[0], image_keys: keys, proof_video_key: proofKey }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'Could not submit listing.');
      setStatus('Submitted for review. It will appear in the public marketplace only after approval.'); setTitle(''); setDescription(''); setPrice(''); setStock('1'); setPreparation(''); setImages([]); setProofVideo(null); void refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not submit listing.'); }
    finally { setBusy(false); }
  }

  async function withdraw(id: string) {
    if (!window.confirm('Withdraw this product from the marketplace?')) return;
    setBusy(true); setStatus('');
    try { const response = await fetch(`/api/market/api/seller/products/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }); if (!response.ok) { const data = await response.json(); throw new Error(data.detail || 'Could not withdraw listing.'); } setStatus('Listing withdrawn.'); void refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not withdraw listing.'); }
    finally { setBusy(false); }
  }

  return <div className="seller-portal"><header className="seller-top"><a className="brand" href="/"><span className="brand-mark">A</span><span>akwaaba<span className="brand-light"> market</span></span></a><a href="/" className="back-link">← Back to marketplace</a></header><div className="seller-intro"><div className="eyebrow">SELL WITH AKWAABA MARKET</div><h1>Your craft.<br/><em>Our storefront.</em></h1><p>Manage your listings privately. Customers see the marketplace brand, not your personal identity.</p></div>
    {!token ? <section className="seller-account card"><h2>{mode === 'register' ? 'Create a seller account' : mode === 'verify' ? 'Verify your phone' : 'Seller sign in'}</h2><p className="modal-intro">We use your real details to secure the seller account and arrange approved payouts. Your name and phone are never shown on product pages.</p><form className="market-form" onSubmit={authenticate}>{mode === 'register' && <><label>Legal name<input required minLength={2} value={name} onChange={event => setName(event.target.value)} autoComplete="name"/></label><label>Email <span>(optional)</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"/></label></>}{mode !== 'verify' && <><label>Ghana mobile number<input required type="tel" placeholder="024 123 4567" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel"/></label><label>Password<input required type="password" minLength={mode === 'register' ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}/></label></>}{mode === 'verify' && <label>WhatsApp code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} placeholder="6-digit code"/></label>}{status && <p className="form-message" role="status">{status}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create seller account' : mode === 'verify' ? 'Verify number' : 'Sign in'}</button></form>{mode === 'verify' && <button className="text-button" disabled={busy} onClick={() => void requestAnotherCode()}>Send another code</button>}<div className="switch-account">{mode === 'register' ? <>Already registered? <button onClick={() => { setMode('login'); setStatus(''); }}>Sign in</button></> : mode === 'login' ? <>New seller? <button onClick={() => { setMode('register'); setStatus(''); }}>Create an account</button></> : null}</div></section> : <><div className="seller-dashboard-heading"><div><div className="eyebrow">SELLER WORKSPACE</div><h2>Your listings</h2></div><button className="outline-button" onClick={() => { setToken(''); setListings([]); try { sessionStorage.removeItem('incognito-seller-token'); } catch { /* ignore */ } }}>Sign out</button></div><div className="seller-listings">{listings.map(item => <article className="seller-listing" key={item.id}>{item.image_url ? <img src={item.image_url} alt=""/> : <div className="seller-image-empty">AK</div>}<div className="seller-listing-text"><b>{item.title}</b><span>{formatPrice(item.price_pesewas)} · {item.stock} available</span></div><span className={`status-chip status-${item.status}`}>{item.status.replaceAll('_',' ')}</span><button className="remove-line" onClick={() => void withdraw(item.id)}>Withdraw</button></article>)}{listings.length === 0 && <p className="catalog-message">No listings yet. Add your first product below.</p>}</div><section className="seller-account card"><h2>Post a product</h2><p className="modal-intro">New listings are private until they pass review. Approved listings appear automatically in the customer marketplace.</p><form className="market-form" onSubmit={submitListing}><label>Product title<input required minLength={3} maxLength={100} value={title} onChange={event => setTitle(event.target.value)}/></label><div className="form-two"><label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="style">Style</option><option value="home">Home</option><option value="food">Food</option><option value="care">Care</option></select></label><label>Condition<select value={condition} onChange={event => setCondition(event.target.value)}><option value="new">New</option><option value="used">Used</option><option value="refurbished">Refurbished</option></select></label></div><div className="form-two"><label>Price (GHS)<input required type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)}/></label><label>Available quantity<input required type="number" min="0" max="1000000" value={stock} onChange={event => setStock(event.target.value)}/></label></div><label>Description<textarea required minLength={10} maxLength={1500} rows={4} value={description} onChange={event => setDescription(event.target.value)}/></label><label>Preparation time<input maxLength={80} required value={preparation} onChange={event => setPreparation(event.target.value)} placeholder="e.g. Ready to ship in 2 days"/></label><label>Product photos<input required type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => setImages(Array.from(event.target.files || []).slice(0,8))}/><small>Choose up to 8 JPEG, PNG or WebP images, 5 MB each.</small></label>{Number(price) > 1000 && <label>Proof-of-life video<input required type="file" accept="video/mp4,video/webm,video/quicktime" onChange={event => setProofVideo(event.target.files?.[0] || null)}/><small>Required above GH₵1,000. A clean seller history with at least 3 completed sales is also required.</small></label>}{images.length > 0 && <p className="form-message">{images.length} photo{images.length === 1 ? '' : 's'} selected.</p>}{status && <p className="form-message" role="status">{status}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button></form></section></>}
  </div>;
}
