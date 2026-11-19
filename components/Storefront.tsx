'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Product = {
  id: string; title: string; category: string; description: string; price_pesewas: number;
  currency: 'GHS'; stock: number; condition: string; image_url: string | null; images?: string[];
  seller_display_name?: string; status: 'live'; delivery_available?: boolean;
};
type CartLine = { product: Product; quantity: number };
type AccountMode = 'register' | 'login' | 'verify';

const money = (pesewas: number) => `GH₵ ${(pesewas / 100).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
const categories = [
  { id: '', label: 'Everything' }, { id: 'style', label: 'Style' }, { id: 'home', label: 'Home' },
  { id: 'food', label: 'Food' }, { id: 'care', label: 'Care' },
];

export default function Storefront() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const requestSequence = useRef(0);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<AccountMode>('register');
  const [token, setToken] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [orderAddress, setOrderAddress] = useState({ name: '', phone: '', email: '', region: '', town: '', address: '', digitalAddress: '', notes: '' });

  async function loadProducts(search = query, selectedCategory = category) {
    const requestId = ++requestSequence.current;
    setLoading(true); setLoadError('');
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    try {
      const response = await fetch(`/api/market/api/products${params.size ? `?${params}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 503 ? 'The live catalog is not connected yet.' : 'Could not load products.');
      const rows = await response.json();
      if (requestId === requestSequence.current) setProducts(Array.isArray(rows) ? rows.filter((item: Product) => item.status === 'live' && item.stock > 0) : []);
    } catch (error) {
      if (requestId === requestSequence.current) { setProducts([]); setLoadError(error instanceof Error ? error.message : 'The live catalog is not connected yet.'); }
    } finally { if (requestId === requestSequence.current) setLoading(false); }
  }

  useEffect(() => {
    void loadProducts('', '');
    try { const saved = sessionStorage.getItem('incognito-customer-token'); if (saved) setToken(saved); } catch { /* storage may be disabled */ }
  }, []);
  useEffect(() => {
    if (!token) return;
    fetch('/api/market/api/account/me', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(account => { if (account) { setCustomerName(account.full_name || ''); setPhone(account.phone || ''); setEmail(account.email || ''); setOrderAddress(value => ({ ...value, name: value.name || account.full_name || '', phone: value.phone || account.phone || '', email: value.email || account.email || '' })); } })
      .catch(() => {});
  }, [token]);
  useEffect(() => {
    try { const saved = localStorage.getItem('incognito-cart'); if (saved) setCart(JSON.parse(saved)); } catch { /* ignore invalid local cart */ }
  }, []);
  useEffect(() => { try { localStorage.setItem('incognito-cart', JSON.stringify(cart)); } catch { /* cart still works in memory */ } }, [cart]);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price_pesewas * line.quantity, 0);
  const featured = useMemo(() => products.slice(0, 6), [products]);
  const searched = query.trim().length > 0 || category.length > 0;

  function addToCart(product: Product) {
    setCart(current => {
      const found = current.find(line => line.product.id === product.id);
      if (found) return current.map(line => line.product.id === product.id ? { ...line, quantity: Math.min(product.stock, line.quantity + 1) } : line);
      return [...current, { product, quantity: 1 }];
    });
    setNotice(`${product.title} added to your cart`); setCartOpen(true);
  }
  function changeQuantity(id: string, next: number) {
    const product = cart.find(line => line.product.id === id)?.product;
    if (next < 1) { setCart(current => current.filter(line => line.product.id !== id)); return; }
    if (product) setCart(current => current.map(line => line.product.id === id ? { ...line, quantity: Math.min(product.stock, next) } : line));
  }
  function openAccount(mode: AccountMode = 'register') { setAccountMode(mode); setAccountMessage(''); setAccountOpen(true); }
  function saveToken(value: string) { setToken(value); try { sessionStorage.setItem('incognito-customer-token', value); } catch { /* in-memory session */ } }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setAccountMessage('');
    try {
      const path = accountMode === 'login' ? '/api/auth/login' : accountMode === 'verify' ? '/api/auth/verify' : '/api/auth/register';
      const body = accountMode === 'login' ? { phone, password } : accountMode === 'verify' ? { phone, code } : { full_name: customerName, phone, email: email || undefined, password, role: 'customer' };
      const response = await fetch(`/api/market${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok && accountMode === 'register' && response.status === 503) { setAccountMode('verify'); setAccountMessage('Your account was saved, but WhatsApp could not deliver the code. Try sending it again when verification is available.'); return; }
      if (!response.ok) throw new Error(data.detail || data.error || 'Account request failed.');
      if (accountMode === 'register') { setAccountMode('verify'); setAccountMessage('A six-digit WhatsApp code was sent. Enter it here to verify your phone.'); }
      else if (accountMode === 'verify') { if (data.access_token) { saveToken(data.access_token); setAccountOpen(false); setNotice('Your account is verified. Welcome to the marketplace.'); } else { setAccountMode('login'); setAccountMessage(data.message || 'Phone verified. Sign in to continue.'); } }
      else { saveToken(data.access_token); setAccountOpen(false); setNotice('You are signed in.'); }
    } catch (error) { setAccountMessage(error instanceof Error ? error.message : 'Account request failed.'); }
    finally { setBusy(false); }
  }

  async function resendCode() {
    setBusy(true); setAccountMessage('');
    try {
      const response = await fetch('/api/market/api/auth/otp/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not request another code.');
      setAccountMessage('If your account is waiting for verification, a new code has been sent.');
    } catch (error) { setAccountMessage(error instanceof Error ? error.message : 'Could not request another code.'); }
    finally { setBusy(false); }
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!token) { setCheckoutOpen(false); openAccount('register'); return; }
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/market/api/orders', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ lines: cart.map(line => ({ product_id: line.product.id, quantity: line.quantity })), recipient_name: orderAddress.name, recipient_phone: orderAddress.phone, email: orderAddress.email || undefined, region: orderAddress.region, town: orderAddress.town, delivery_address: orderAddress.address, digital_address: orderAddress.digitalAddress || undefined, delivery_notes: orderAddress.notes || undefined }),
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) { setToken(''); try { sessionStorage.removeItem('incognito-customer-token'); } catch { /* ignore */ } throw new Error('Please sign in again before placing an order.'); }
      if (!response.ok) throw new Error(data.detail || 'Order could not be placed. Check that the items are still available.');
      setCart([]); setCheckoutOpen(false); setNotice(`Order request ${data.id} recorded. Delivery fee is pending and no payment was collected; checkout needs a confirmed delivery price and configured payment service.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Order could not be placed.'); }
    finally { setBusy(false); }
  }

  function openCheckout() {
    if (!cart.length) return;
    setCartOpen(false);
    if (!token) { setCheckoutOpen(false); openAccount('register'); setAccountMessage('Create or sign in to an account before checkout. Your cart is saved.'); return; }
    setCheckoutOpen(true);
  }

  function card(product: Product) {
    return <article className="product-card" key={product.id}>
      <div className="product-photo">{product.image_url ? <img src={product.image_url} alt={product.title} loading="lazy" /> : <div className="photo-fallback" aria-label="No product photo">AK</div>}<span className="live-tag">Verified</span></div>
      <div className="product-info"><div className="product-category">{product.category}</div><h3>{product.title}</h3><p className="product-description">{product.description}</p><button className="details-link" onClick={() => setSelectedProduct(product)}>View product details</button><div className="product-buy"><strong>{money(product.price_pesewas)}</strong><button className="add-button" onClick={() => addToCart(product)} aria-label={`Add ${product.title} to cart`}>Add to cart <span>+</span></button></div><div className="stock-note">{product.stock === 1 ? 'Only one left' : `${product.stock} available`} · {product.seller_display_name || 'Incognito Market'}</div></div>
    </article>;
  }

  return <main className="market-shell">
    <header className="market-header"><a className="brand" href="/"><span className="brand-mark">A</span><span>akwaaba<span className="brand-light"> market</span></span></a><div className="header-actions"><a href="/seller/upload" className="sell-link">Sell with us</a>{token ? <button className="account-button" onClick={() => { setToken(''); try { sessionStorage.removeItem('incognito-customer-token'); } catch { /* ignore */ } setNotice('You have signed out.'); }}>Sign out</button> : <button className="account-button" onClick={() => openAccount('login')}>Sign in</button>}<button className="cart-button" onClick={() => setCartOpen(true)} aria-label={`Open cart with ${cartCount} items`}>Bag <span>{cartCount}</span></button></div></header>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span /> MADE IN GHANA, FOUND HERE</div><h1>Good things.<br/><em>From Ghana.</em></h1><p>Shop thoughtful finds from Ghanaian makers. We verify every listing and keep seller identities private.</p><div className="hero-cta"><a href="#shop" className="primary-button">Explore the collection <span>↘</span></a><span className="safe-note">Secure checkout · Ghana-wide delivery</span></div></div><div className="hero-art"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-seal">AK<br/><small>LOCAL<br/>FINDS</small></div><div className="hero-caption">Discover something<br/>made with care.</div><span className="hero-star">✳</span><span className="hero-dot dot-one"/><span className="hero-dot dot-two"/></div></section>
    <section className="trust-strip"><div><b>01</b><span>Verified listings</span></div><div><b>02</b><span>Private sellers</span></div><div><b>03</b><span>Delivery coordinated</span></div><div><b>04</b><span>Pay only after delivery is confirmed</span></div></section>
    {notice && <div className="market-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    <section id="shop" className="shop-section"><div className="section-heading"><div><div className="eyebrow">THE MARKETPLACE</div><h2>Find your next <em>favourite.</em></h2></div><span className="result-count">{loading ? 'Loading…' : `${products.length} verified ${products.length === 1 ? 'find' : 'finds'}`}</span></div>
      <div className="search-wrap"><span className="search-icon">⌕</span><input value={query} onChange={event => { const value = event.target.value; setQuery(value); void loadProducts(value, category); }} placeholder="Search handmade, home, fashion…" aria-label="Search products"/><kbd>Search</kbd></div>
      <div className="category-tabs" role="group" aria-label="Filter by category">{categories.map(item => <button key={item.id} className={category === item.id ? 'category-tab active' : 'category-tab'} onClick={() => { setCategory(item.id); void loadProducts(query, item.id); }}>{item.label}</button>)}</div>
      {loading ? <div className="catalog-message"><span className="loader"/>Loading the latest verified finds…</div> : loadError ? <div className="catalog-message catalog-error"><div className="empty-symbol">↗</div><h3>Live products are not connected yet</h3><p>{loadError} Once the marketplace API and database are running, approved listings will appear here automatically.</p><button className="outline-button" onClick={() => void loadProducts()}>Try again</button></div> : products.length === 0 ? <div className="catalog-message"><div className="empty-symbol">⌕</div><h3>{searched ? 'No matching finds yet' : 'The shelves are getting ready'}</h3><p>{searched ? 'Try another search or choose a different category.' : 'Verified products will show up here as sellers are approved.'}</p>{searched && <button className="outline-button" onClick={() => { setQuery(''); setCategory(''); void loadProducts('', ''); }}>Show all finds</button>}</div> : <><div className="product-grid">{(searched || showAll ? products : featured).map(card)}</div>{!searched && products.length > 6 && <button className="all-products-link" onClick={() => { setShowAll(value => !value); setNotice(showAll ? 'Showing featured finds.' : 'Showing the full verified catalog.'); }}>{showAll ? 'Show featured finds' : `View all ${products.length} products`} <span>→</span></button>}</>}
    </section>
    <footer className="market-footer"><a className="brand" href="/"><span className="brand-mark">A</span><span>akwaaba<span className="brand-light"> market</span></span></a><span>Made for Ghana. Shared with care.</span><a href="/seller/upload">Become a seller <span>↗</span></a></footer><div id="privacy" className="privacy-note">Account and delivery details are used to verify your account, manage orders, and arrange delivery. Public listings identify the marketplace rather than the individual seller. This site does not collect Ghana Card numbers. The marketplace operator must publish its legal business identity, full privacy notice, contact route, delivery terms, and return/refund terms before accepting live orders.</div>

    {selectedProduct && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedProduct(null); }}><section className="modal-card detail-modal"><div className="panel-heading"><div><div className="eyebrow">VERIFIED FIND · {selectedProduct.category}</div><h2>{selectedProduct.title}</h2></div><button className="close-button" onClick={() => setSelectedProduct(null)} aria-label="Close details">×</button></div>{selectedProduct.image_url && <img className="detail-photo" src={selectedProduct.image_url} alt={selectedProduct.title}/>}<p className="detail-price">{money(selectedProduct.price_pesewas)}</p><p className="detail-description">{selectedProduct.description}</p><p className="detail-stock">{selectedProduct.stock === 1 ? 'Only one left' : `${selectedProduct.stock} available`} · Sold by {selectedProduct.seller_display_name || 'Akwaaba Market'}</p><button className="primary-button full-button" onClick={() => { addToCart(selectedProduct); setSelectedProduct(null); }}>Add to bag <span>+</span></button></section></div>}

    {cartOpen && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) setCartOpen(false); }}><aside className="side-panel" aria-label="Shopping bag"><div className="panel-heading"><div><div className="eyebrow">YOUR PICKS</div><h2>Shopping bag <span>({cartCount})</span></h2></div><button className="close-button" onClick={() => setCartOpen(false)} aria-label="Close bag">×</button></div>{cart.length === 0 ? <div className="panel-empty"><div className="empty-symbol">♡</div><h3>Your bag is taking a break.</h3><p>Find something lovely to bring home.</p><button className="primary-button" onClick={() => setCartOpen(false)}>Continue browsing</button></div> : <><div className="cart-lines">{cart.map(({ product, quantity }) => <div className="cart-line" key={product.id}><div className="cart-thumb">{product.image_url && <img src={product.image_url} alt=""/>}</div><div className="cart-line-main"><b>{product.title}</b><span>{money(product.price_pesewas)}</span><div className="quantity-control"><button onClick={() => changeQuantity(product.id, quantity - 1)} aria-label="Reduce quantity">−</button><span>{quantity}</span><button onClick={() => changeQuantity(product.id, quantity + 1)} aria-label="Increase quantity">+</button></div></div><button className="remove-line" onClick={() => changeQuantity(product.id, 0)}>Remove</button></div>)}</div><div className="cart-summary"><div><span>Items subtotal</span><b>{money(subtotal)}</b></div><p>Delivery is quoted after we confirm your address. You will see the full amount before payment.</p><button className="primary-button full-button" onClick={openCheckout}>Continue to checkout <span>→</span></button><button className="text-button" onClick={() => setCartOpen(false)}>Keep browsing</button></div></>}</aside></div>}

    {accountOpen && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) setAccountOpen(false); }}><section className="modal-card"><div className="panel-heading"><div><div className="eyebrow">YOUR PRIVATE ACCOUNT</div><h2>{accountMode === 'verify' ? 'Verify your number' : accountMode === 'login' ? 'Welcome back' : 'Join the marketplace'}</h2></div><button className="close-button" onClick={() => setAccountOpen(false)} aria-label="Close">×</button></div><p className="modal-intro">Your contact details are used for account security and delivery. Sellers never see your private profile.</p><form onSubmit={submitAccount} className="market-form">{accountMode === 'register' && <><label>Full name<input required minLength={2} value={customerName} onChange={event => setCustomerName(event.target.value)} autoComplete="name"/></label><label>Email <span>(optional)</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email"/></label></>}{accountMode !== 'verify' && <><label>Ghana mobile number<input required type="tel" placeholder="024 123 4567" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel"/></label><label>Password<input required type="password" minLength={accountMode === 'register' ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} autoComplete={accountMode === 'register' ? 'new-password' : 'current-password'}/>{accountMode === 'register' && <small>Use at least 10 characters.</small>}</label></>}{accountMode === 'verify' && <><label>WhatsApp verification code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" value={code} onChange={event => setCode(event.target.value)}/></label></>}{accountMessage && <p className="form-message" role="status">{accountMessage}</p>}<button className="primary-button full-button" disabled={busy}>{busy ? 'Please wait…' : accountMode === 'verify' ? 'Verify account' : accountMode === 'login' ? 'Sign in' : 'Create account'}</button></form>{accountMode === 'verify' && <button className="text-button" disabled={busy} onClick={() => void resendCode()}>Send another code</button>}<div className="switch-account">{accountMode === 'register' ? <>Already have an account? <button onClick={() => { setAccountMode('login'); setAccountMessage(''); }}>Sign in</button></> : accountMode === 'login' ? <>New to the market? <button onClick={() => { setAccountMode('register'); setAccountMessage(''); }}>Create account</button></> : <>Need to start again? <button onClick={() => { setAccountMode('register'); setAccountMessage(''); }}>Back to sign up</button></>}</div><p className="privacy-footnote">We do not ask for your Ghana Card number. Learn about how we protect <a href="#privacy">your privacy</a>.</p></section></div>}

    {checkoutOpen && <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) setCheckoutOpen(false); }}><section className="modal-card checkout-modal"><div className="panel-heading"><div><div className="eyebrow">ALMOST YOURS</div><h2>Delivery details</h2></div><button className="close-button" onClick={() => setCheckoutOpen(false)} aria-label="Close">×</button></div><p className="modal-intro">We coordinate delivery across Ghana. We will confirm the delivery fee and final total with you before payment.</p><form onSubmit={placeOrder} className="market-form"><div className="form-two"><label>Recipient name<input required value={orderAddress.name} onChange={event => setOrderAddress({ ...orderAddress, name: event.target.value })} autoComplete="name"/></label><label>Mobile number<input required type="tel" placeholder="024 123 4567" value={orderAddress.phone} onChange={event => setOrderAddress({ ...orderAddress, phone: event.target.value })} autoComplete="tel"/></label></div><label>Email <span>(optional)</span><input type="email" value={orderAddress.email} onChange={event => setOrderAddress({ ...orderAddress, email: event.target.value })} autoComplete="email"/></label><div className="form-two"><label>Region<input required value={orderAddress.region} onChange={event => setOrderAddress({ ...orderAddress, region: event.target.value })} placeholder="e.g. Greater Accra"/></label><label>Town / city<input required value={orderAddress.town} onChange={event => setOrderAddress({ ...orderAddress, town: event.target.value })} placeholder="e.g. Accra"/></label></div><label>Delivery address<input required minLength={5} value={orderAddress.address} onChange={event => setOrderAddress({ ...orderAddress, address: event.target.value })} placeholder="House number, street, landmark" autoComplete="street-address"/></label><label>GhanaPost GPS <span>(optional)</span><input value={orderAddress.digitalAddress} onChange={event => setOrderAddress({ ...orderAddress, digitalAddress: event.target.value })} placeholder="e.g. GA-123-4567"/></label><label>Delivery notes <span>(optional)</span><textarea rows={2} value={orderAddress.notes} onChange={event => setOrderAddress({ ...orderAddress, notes: event.target.value })}/></label><div className="checkout-total"><span>Items subtotal</span><b>{money(subtotal)}</b></div><p className="form-message">Delivery fee is not included yet. Your order is saved as a request; no payment is collected until you approve the confirmed total.</p><button className="primary-button full-button" disabled={busy}>{busy ? 'Submitting…' : 'Place order request'}</button></form></section></div>}
  </main>;
}
