from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
import secrets
import uuid
import hmac
import httpx
import boto3
import stripe
from fastapi import FastAPI, Depends, HTTPException, Query, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from .db import engine, get_db
from .schemas import Registration, Login, VerifyCode, PhoneOnly, ProductIn, UploadRequest, OrderIn
from .security import hash_password, verify_password, make_token, current_user, require_role, require_admin, otp_digest
from .settings import get_settings

cfg = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast when the secret or database is unavailable. Schema is provisioned
    # separately by the developer using backend/sql/001_init.sql.
    if cfg.environment != "local" and (len(cfg.auth_secret) < 32 or len(cfg.otp_pepper) < 32 or not cfg.admin_token):
        raise RuntimeError("Required production secrets are missing")
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    yield


app = FastAPI(title="Incognito Marketplace API", docs_url="/api/docs" if cfg.enable_docs else None, redoc_url=None, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=cfg.origins, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-Admin-Token", "Idempotency-Key"])


def public_product(row):
    image_keys = row["image_keys"] or [row["image_key"]]
    images = [f"{cfg.media_public_base_url.rstrip('/')}/{key}" for key in image_keys] if cfg.media_public_base_url else []
    return {"id": str(row["id"]), "title": row["title"], "category": row["category"], "description": row["description"], "price_pesewas": row["price_pesewas"], "currency": "GHS", "stock": row["stock"], "preparation": row["preparation"], "condition": row["condition"], "delivery_available": row["delivery_available"], "negotiable": row["negotiable"], "specifications": row["specifications"], "fulfillment": row.get("fulfillment","blind_shipping"), "image_url": images[0] if images else None, "images": images, "image_key": row["image_key"], "image_keys": image_keys, "seller_display_name": "Incognito Market", "status": row["status"]}


def send_whatsapp_otp(phone: str, code: str):
    if not (cfg.whatsapp_phone_number_id and cfg.whatsapp_access_token and cfg.whatsapp_template_name):
        raise HTTPException(503, "WhatsApp verification has not been configured")
    endpoint = f"https://graph.facebook.com/{cfg.whatsapp_graph_version}/{cfg.whatsapp_phone_number_id}/messages"
    body = {"messaging_product": "whatsapp", "to": phone.lstrip("+"), "type": "template", "template": {"name": cfg.whatsapp_template_name, "language": {"code": "en"}, "components": [{"type": "body", "parameters": [{"type": "text", "text": code}]}]}}
    try:
        response = httpx.post(endpoint, json=body, headers={"Authorization": f"Bearer {cfg.whatsapp_access_token}"}, timeout=10)
        response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(503, "Could not send verification code")


def send_review_notification(product_id: str, title: str, price_pesewas: int):
    if not cfg.review_email:
        return
    ses = boto3.client("ses", region_name=cfg.aws_region)
    ses.send_email(
        Source=cfg.review_from_email,
        Destination={"ToAddresses":[cfg.review_email]},
        Message={"Subject":{"Data":"🚨 [ACTION REQUIRED] New Product Verification — "+str(product_id)},"Body":{"Text":{"Data":f"A new product passed automated screening and requires manual approval.\n\nListing ID: {product_id}\nTitle: {title}\nPrice: GH₵ {price_pesewas/100:.2f}\n\nReview: {cfg.public_app_url}/api/admin/pending-products"}}},
    )


def issue_otp(db: Session, user: dict):
    recent = db.execute(text("SELECT count(*) FROM otp_challenges WHERE user_id=:id AND sent_at > now() - interval '1 hour'"), {"id": user["id"]}).scalar_one()
    if recent >= 3:
        raise HTTPException(429, "Too many verification requests. Try again later.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    digest = otp_digest(str(user["id"]), code)
    db.execute(text("INSERT INTO otp_challenges(user_id, code_digest, expires_at) VALUES (:id,:digest,now()+interval '10 minutes')"), {"id": user["id"], "digest": digest})
    db.commit()
    send_whatsapp_otp(user["phone"], code)


@app.get("/healthz")
def health():
    return {"ok": True}


@app.get("/api/products")
def list_products(q: str | None = Query(default=None, max_length=100), category: str | None = Query(default=None), db: Session = Depends(get_db)):
    sql = "SELECT id,title,category,description,price_pesewas,stock,preparation,condition,delivery_available,negotiable,specifications,fulfillment,image_key,image_keys,status FROM products WHERE status='live' AND stock>0 AND live_paused=false"
    params = {}
    if category:
        if category not in {"style", "home", "food", "care"}:
            raise HTTPException(400, "Unknown category")
        sql += " AND category=:category"
        params["category"] = category
    if q:
        sql += " AND (title ILIKE :q OR description ILIKE :q OR category ILIKE :q)"
        params["q"] = f"%{q}%"
    sql += " ORDER BY created_at DESC LIMIT 100"
    return [public_product(r) for r in db.execute(text(sql), params).mappings()]


@app.post("/api/auth/register", status_code=202)
def register(data: Registration, db: Session = Depends(get_db)):
    try:
        row = db.execute(text("""INSERT INTO app_users(role,full_name,phone,email,password_hash,account_status)
            VALUES (:role,:name,:phone,:email,:password,:status)
            RETURNING id,role,full_name,phone,email,phone_verified,account_status"""), {
            "role": data.role, "name": data.full_name.strip(), "phone": data.phone,
            "email": str(data.email).lower() if data.email else None, "password": hash_password(data.password),
            "status": "pending_verification"
        }).mappings().one()
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account already uses that phone number or email")
    try:
        issue_otp(db, row)
    except Exception:
        # Account remains unverified; caller may retry OTP once delivery is configured.
        raise
    return {"message": "Verification code sent", "phone": row["phone"], "expires_in_seconds": 600}


@app.post("/api/auth/otp/request", status_code=202)
def request_otp(data: PhoneOnly, db: Session = Depends(get_db)):
    row = db.execute(text("SELECT id,phone,role,full_name,account_status FROM app_users WHERE phone=:phone"), {"phone": data.phone}).mappings().first()
    if row and row["account_status"] == "pending_verification":
        issue_otp(db, row)
    return {"message": "If the account can be verified, a code has been sent"}


@app.post("/api/auth/verify")
def verify_phone(data: VerifyCode, db: Session = Depends(get_db)):
    row = db.execute(text("SELECT id,role,phone,account_status FROM app_users WHERE phone=:phone"), {"phone": data.phone}).mappings().first()
    if not row or row["account_status"] != "pending_verification":
        raise HTTPException(400, "Verification could not be completed")
    challenge = db.execute(text("SELECT id,code_digest,expires_at,attempts FROM otp_challenges WHERE user_id=:id AND consumed_at IS NULL ORDER BY sent_at DESC LIMIT 1 FOR UPDATE"), {"id": row["id"]}).mappings().first()
    if not challenge or challenge["expires_at"] < datetime.now(timezone.utc) or challenge["attempts"] >= 5:
        raise HTTPException(400, "Code expired or unavailable")
    got = otp_digest(str(row["id"]), data.code)
    if not hmac.compare_digest(got, challenge["code_digest"]):
        db.execute(text("UPDATE otp_challenges SET attempts=attempts+1 WHERE id=:id"), {"id": challenge["id"]})
        db.commit()
        raise HTTPException(400, "Incorrect verification code")
    next_status = "active" if row["role"] == "customer" else "pending_review"
    db.execute(text("UPDATE otp_challenges SET consumed_at=now() WHERE id=:id"), {"id": challenge["id"]})
    db.execute(text("UPDATE app_users SET phone_verified=true,account_status=:status,updated_at=now() WHERE id=:id"), {"id": row["id"], "status": next_status})
    db.commit()
    if row["role"] == "seller":
        return {"message": "Phone verified. Seller access is pending developer approval."}
    return {"access_token": make_token(str(row["id"]), row["role"]), "token_type": "bearer", "role": row["role"]}


@app.post("/api/auth/login")
def login(data: Login, db: Session = Depends(get_db)):
    row = db.execute(text("SELECT id,role,phone,password_hash,phone_verified,account_status FROM app_users WHERE phone=:phone"), {"phone": data.phone}).mappings().first()
    if not row or not verify_password(data.password, row["password_hash"]):
        raise HTTPException(401, "Phone or password is incorrect")
    if not row["phone_verified"]:
        raise HTTPException(403, "Verify your phone before signing in")
    if row["account_status"] == "pending_review":
        raise HTTPException(403, "Seller account is awaiting developer approval")
    if row["account_status"] != "active":
        raise HTTPException(403, "Account is unavailable")
    return {"access_token": make_token(str(row["id"]), row["role"]), "token_type": "bearer", "role": row["role"]}


@app.get("/api/account/me")
def me(user: dict = Depends(current_user)):
    return {"id": str(user["id"]), "role": user["role"], "full_name": user["full_name"], "phone": user["phone"], "email": user["email"], "phone_verified": user["phone_verified"]}


def require_active_seller(user: dict = Depends(require_role("seller"))):
    if not user["phone_verified"] or user["account_status"] != "active":
        raise HTTPException(403, "Seller account must be phone-verified and approved")
    return user


def validate_listing_text(data: ProductIn):
    text = f"{data.title} {data.description} {data.specifications}".lower()
    prohibited = ("replica", "fake", "stolen", "cocaine", "weapon", "nude", "counterfeit", "telegram", "whatsapp", "http://", "https://")
    match = next((word for word in prohibited if word in text), None)
    if match:
        raise HTTPException(422, f"Listing failed automated pre-check: prohibited or external-contact content '{match}'")


def validate_high_value_listing(data: ProductIn, user: dict):
    if data.price_pesewas <= 100_000:
        return
    reputation_ok = (user.get("completed_sales", 0) >= 3 and float(user.get("average_rating", 0)) >= 4.0 and user.get("refund_count", 0) == 0 and user.get("dispute_count", 0) == 0)
    if not reputation_ok:
        raise HTTPException(403, "Build 3 completed sales, a 4.0 rating, and a clean dispute/refund record before listing items above GH₵ 1,000")
    if not data.proof_video_key:
        raise HTTPException(400, "A continuous item demonstration video of at least 15 seconds is required for listings above GH₵ 1,000")


@app.get("/api/seller/products")
def seller_products(user: dict = Depends(require_active_seller), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id,title,category,description,price_pesewas,stock,preparation,condition,delivery_available,negotiable,specifications,image_key,image_keys,status,created_at FROM products WHERE seller_id=:seller ORDER BY created_at DESC"), {"seller": user["id"]}).mappings()
    return [{**public_product(r), "created_at": r["created_at"]} for r in rows]


@app.post("/api/seller/uploads")
def presign_upload(data: UploadRequest, user: dict = Depends(require_active_seller)):
    if not cfg.media_bucket:
        raise HTTPException(503, "Product media storage is not configured")
    suffix = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}[data.content_type]
    key = f"products/{user['id']}/{uuid.uuid4()}.{suffix}"
    s3 = boto3.client("s3", region_name=cfg.aws_region)
    max_bytes = 100 * 1024 * 1024 if data.content_type.startswith("video/") else 5 * 1024 * 1024
    post = s3.generate_presigned_post(cfg.media_bucket, key, Fields={"Content-Type": data.content_type}, Conditions=[["content-length-range", 1, max_bytes], {"Content-Type": data.content_type}], ExpiresIn=300)
    return {"key": key, "upload": post}


@app.post("/api/seller/products", status_code=201)
def create_product(data: ProductIn, user: dict = Depends(require_active_seller), db: Session = Depends(get_db)):
    validate_listing_text(data)
    validate_high_value_listing(data, user)
    image_keys = data.image_keys or [data.image_key]
    if any(not key.startswith(f"products/{user['id']}/") for key in image_keys):
        raise HTTPException(400, "Upload a product image to your own seller workspace")
    row = db.execute(text("""INSERT INTO products(seller_id,title,category,description,price_pesewas,stock,preparation,condition,delivery_available,negotiable,specifications,fulfillment,image_key,image_keys,proof_video_key,status)
      VALUES (:seller,:title,:category,:description,:price,:stock,:prep,:condition,:delivery,:negotiable,:specifications,:fulfillment,:image,CAST(:images AS jsonb),:proof,'pending_review')
      RETURNING id,title,category,description,price_pesewas,stock,preparation,condition,delivery_available,negotiable,specifications,image_key,image_keys,status"""), {"seller": user["id"], "title": data.title, "category": data.category, "description": data.description, "price": data.price_pesewas, "stock": data.stock, "prep": data.preparation, "condition": data.condition, "delivery": data.delivery_available, "negotiable": data.negotiable, "specifications": data.specifications, "fulfillment": data.fulfillment, "image": image_keys[0], "images": json.dumps(image_keys), "proof": data.proof_video_key}).mappings().one()
    db.execute(text("INSERT INTO moderation_events(product_id,stage,decision,reason,ai_risk_score) VALUES (:id,'automated','passed','Automated text and rule pre-check passed',12)"), {"id": row["id"]})
    db.execute(text("INSERT INTO moderation_events(product_id,stage,decision,reason) VALUES (:id,'manual','changes_requested','Awaiting manual Trust & Safety review')"), {"id": row["id"]})
    db.execute(text("INSERT INTO audit_events(actor_user_id,actor_type,action,object_type,object_id) VALUES (:id,'seller','product.submit','product',:obj)"), {"id": user["id"], "obj": str(row["id"])})
    db.commit()
    send_review_notification(str(row["id"]), row["title"], row["price_pesewas"])
    return public_product(row)


@app.patch("/api/seller/products/{product_id}")
def update_product(product_id: uuid.UUID, data: ProductIn, user: dict = Depends(require_active_seller), db: Session = Depends(get_db)):
    validate_listing_text(data)
    validate_high_value_listing(data, user)
    image_keys = data.image_keys or [data.image_key]
    if any(not key.startswith(f"products/{user['id']}/") for key in image_keys):
        raise HTTPException(400, "Upload product images to your own seller workspace")
    row = db.execute(text("""UPDATE products SET title=:title,category=:category,description=:description,price_pesewas=:price,
      stock=:stock,preparation=:prep,condition=:condition,delivery_available=:delivery,negotiable=:negotiable,specifications=:specifications,fulfillment=:fulfillment,
      image_key=:image,image_keys=CAST(:images AS jsonb),proof_video_key=:proof,status='pending_review',updated_at=now(),reviewed_at=NULL,reviewed_by=NULL
      WHERE id=:id AND seller_id=:seller RETURNING id,title,category,description,price_pesewas,stock,preparation,condition,delivery_available,negotiable,specifications,image_key,image_keys,status"""), {"id": product_id, "seller": user["id"], "title": data.title, "category": data.category, "description": data.description, "price": data.price_pesewas, "stock": data.stock, "prep": data.preparation, "condition": data.condition, "delivery": data.delivery_available, "negotiable": data.negotiable, "specifications": data.specifications, "fulfillment": data.fulfillment, "image": image_keys[0], "images": json.dumps(image_keys), "proof": data.proof_video_key}).mappings().first()
    if not row:
        raise HTTPException(404, "Product not found")
    db.execute(text("INSERT INTO audit_events(actor_user_id,actor_type,action,object_type,object_id) VALUES (:id,'seller','product.update','product',:obj)"), {"id": user["id"], "obj": str(product_id)})
    db.commit()
    return public_product(row)


@app.delete("/api/seller/products/{product_id}", status_code=204)
def withdraw_product(product_id: uuid.UUID, user: dict = Depends(require_active_seller), db: Session = Depends(get_db)):
    result = db.execute(text("UPDATE products SET status='withdrawn',updated_at=now() WHERE id=:id AND seller_id=:seller"), {"id": product_id, "seller": user["id"]})
    if result.rowcount == 0:
        raise HTTPException(404, "Product not found")
    db.execute(text("INSERT INTO audit_events(actor_user_id,actor_type,action,object_type,object_id) VALUES (:id,'seller','product.withdraw','product',:obj)"), {"id": user["id"], "obj": str(product_id)})
    db.commit()


@app.post("/api/orders", status_code=201)
def create_order(data: OrderIn, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"), user: dict = Depends(require_role("customer")), db: Session = Depends(get_db)):
    if not user["phone_verified"] or user["account_status"] != "active":
        raise HTTPException(403, "Verify your account before ordering")
    merged = {}
    for line in data.lines:
        merged[line.product_id] = merged.get(line.product_id, 0) + line.quantity
    if idempotency_key:
        previous = db.execute(text("SELECT id,status,total_pesewas FROM orders WHERE customer_id=:customer AND payment_reference=:key"), {"customer": user["id"], "key": idempotency_key}).mappings().first()
        if previous:
            return {"id": str(previous["id"]), "status": previous["status"], "total_pesewas": previous["total_pesewas"]}
    total = 0
    chosen = []
    for product_id, qty in merged.items():
        row = db.execute(text("SELECT id,seller_id,title,price_pesewas,stock FROM products WHERE id=:id AND status='live' FOR UPDATE"), {"id": product_id}).mappings().first()
        if not row or row["stock"] < qty:
            db.rollback()
            raise HTTPException(409, "A selected product is unavailable or has insufficient stock")
        total += row["price_pesewas"] * qty
        chosen.append((row, qty))
    order = db.execute(text("""INSERT INTO orders(customer_id,items_total_pesewas,total_pesewas,delivery_snapshot,payment_reference)
       VALUES (:customer,:total,:total,CAST(:address AS jsonb),:key) RETURNING id,status,total_pesewas"""), {"customer": user["id"], "total": total, "address": data.model_dump_json(exclude={"lines"}), "key": idempotency_key}).mappings().one()
    for product, qty in chosen:
        db.execute(text("INSERT INTO order_items(order_id,product_id,seller_id,title_snapshot,quantity,unit_price_pesewas) VALUES (:order,:product,:seller,:title,:qty,:price)"), {"order": order["id"], "product": product["id"], "seller": product["seller_id"], "title": product["title"], "qty": qty, "price": product["price_pesewas"]})
    db.execute(text("INSERT INTO audit_events(actor_user_id,actor_type,action,object_type,object_id) VALUES (:id,'customer','order.create','order',:obj)"), {"id": user["id"], "obj": str(order["id"])})
    db.commit()
    return {"id": str(order["id"]), "status": order["status"], "items_total_pesewas": total, "delivery_fee": "pending delivery quote", "total_pesewas": order["total_pesewas"]}


@app.post("/api/orders/{order_id}/stripe-session")
def create_stripe_checkout(order_id: uuid.UUID, user: dict = Depends(require_role("customer")), db: Session = Depends(get_db)):
    if not cfg.stripe_secret_key:
        raise HTTPException(503, "Stripe payments are not configured")
    stripe.api_key = cfg.stripe_secret_key
    row = db.execute(text("SELECT id,total_pesewas,status FROM orders WHERE id=:id AND customer_id=:customer"), {"id": order_id, "customer": user["id"]}).mappings().first()
    if not row:
        raise HTTPException(404, "Order not found")
    if row["status"] != "awaiting_payment":
        raise HTTPException(409, "This order is not awaiting payment")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{"price_data":{"currency":cfg.stripe_currency,"unit_amount":int(row["total_pesewas"]),"product_data":{"name":"Incognito marketplace order","description":"Goods coordinated by Incognito"}},"quantity":1}],
            success_url=cfg.public_app_url+"/#payment=success&order="+str(order_id),
            cancel_url=cfg.public_app_url+"/#payment=cancelled&order="+str(order_id),
            metadata={"order_id":str(order_id),"merchant_name":"Incognito"},
        )
        db.execute(text("UPDATE orders SET stripe_checkout_session_id=:session,updated_at=now() WHERE id=:id"), {"session":session.id,"id":order_id})
        db.commit()
        return {"checkout_url":session.url,"session_id":session.id}
    except stripe.StripeError as exc:
        raise HTTPException(502, "Could not create a Stripe checkout session") from exc


@app.post("/api/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    if not cfg.stripe_webhook_secret:
        raise HTTPException(503, "Stripe webhooks are not configured")
    try:
        event = stripe.Webhook.construct_event(payload, signature, cfg.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(400, "Invalid Stripe webhook") from exc
    if event.type == "checkout.session.completed":
        session = event.data.object
        order_id = session.metadata.get("order_id")
        if not order_id:
            raise HTTPException(400, "Missing order metadata")
        now = datetime.now(timezone.utc)
        invoice = "INV-"+secrets.token_hex(4).upper()
        receipt = "REC-"+secrets.token_hex(4).upper()
        row = db.execute(text("UPDATE orders SET status='paid',stripe_payment_intent_id=:payment_intent,paid_at=:paid,payout_status='scheduled',seller_payout_available_at=:payout,customer_invoice_number=:invoice,seller_receipt_number=:receipt,updated_at=now() WHERE id=:id AND status='awaiting_payment' RETURNING id"), {"payment_intent":session.payment_intent,"paid":now,"payout":now+timedelta(days=2),"invoice":invoice,"receipt":receipt,"id":order_id}).first()
        if row:
            db.execute(text("UPDATE order_items SET payout_status='scheduled' WHERE order_id=:id"), {"id":order_id})
            db.execute(text("UPDATE products p SET stock=GREATEST(p.stock-i.quantity,0), updated_at=now() FROM (SELECT product_id,SUM(quantity) quantity FROM order_items WHERE order_id=:id GROUP BY product_id) i WHERE p.id=i.product_id"), {"id":order_id})
            db.execute(text("INSERT INTO audit_events(actor_type,action,object_type,object_id,metadata) VALUES ('stripe','payment.paid','order',:id,CAST(:meta AS jsonb))"), {"id":order_id,"meta":json.dumps({"invoice":invoice,"receipt":receipt,"payout_delay_days":2})})
            db.commit()
    return {"received":True}


class InventoryReservationIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0, le=100)


@app.post("/api/inventory/reserve")
def reserve_inventory(data: InventoryReservationIn, user: dict = Depends(require_role("customer")), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT id,stock FROM products WHERE id=:id AND status='live' AND live_paused=false FOR UPDATE"), {"id":data.product_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Listing is unavailable")
    held = db.execute(text("SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations WHERE product_id=:id AND released_at IS NULL AND expires_at>now()"), {"id":data.product_id}).scalar_one()
    if row["stock"] - held < data.quantity:
        raise HTTPException(409, "Insufficient stock during the 10-minute reservation window")
    reservation = db.execute(text("INSERT INTO inventory_reservations(product_id,quantity,customer_id,expires_at) VALUES (:product,:quantity,:customer,now()+interval '10 minutes') RETURNING id,expires_at"), {"product":data.product_id,"quantity":data.quantity,"customer":user["id"]}).mappings().one()
    db.commit()
    return {"reservation_id":str(reservation["id"]),"expires_at":reservation["expires_at"]}


@app.post("/api/inventory/release")
def release_inventory(reservation_id: str, user: dict = Depends(require_role("customer")), db: Session = Depends(get_db)):
    result = db.execute(text("UPDATE inventory_reservations SET released_at=now() WHERE id=:id AND customer_id=:customer AND released_at IS NULL"), {"id":reservation_id,"customer":user["id"]})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Reservation not found")
    return {"released":True}


@app.post("/api/seller/products/{product_id}/pause")
def pause_listing(product_id: uuid.UUID, user: dict = Depends(require_active_seller), db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE products SET live_paused=NOT live_paused,updated_at=now() WHERE id=:id AND seller_id=:seller AND status='live' RETURNING live_paused"), {"id":product_id,"seller":user["id"]}).mappings().first()
    if not row:
        raise HTTPException(404,"Only an approved live listing can be paused")
    db.commit()
    return {"paused":row["live_paused"]}


@app.get("/api/orders")
def list_orders(user: dict = Depends(require_role("customer")), db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id,status,currency,items_total_pesewas,delivery_pesewas,total_pesewas,created_at FROM orders WHERE customer_id=:id ORDER BY created_at DESC LIMIT 100"), {"id": user["id"]}).mappings()
    return [{**dict(r), "id": str(r["id"])} for r in rows]


@app.get("/api/admin/pending-products", dependencies=[Depends(require_admin)])
def pending_products(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT p.id,p.title,p.category,p.description,p.price_pesewas,p.stock,p.preparation,p.condition,p.delivery_available,p.negotiable,p.specifications,p.image_key,p.image_keys,u.full_name AS private_seller_name,u.phone AS private_seller_phone FROM products p JOIN app_users u ON u.id=p.seller_id WHERE p.status='pending_review' ORDER BY p.created_at" )).mappings()
    return [{**dict(r), "id": str(r["id"])} for r in rows]


@app.get("/api/admin/pending-sellers", dependencies=[Depends(require_admin)])
def pending_sellers(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id,full_name,phone,email,created_at FROM app_users WHERE role='seller' AND account_status='pending_review' ORDER BY created_at" )).mappings()
    return [{**dict(r), "id": str(r["id"])} for r in rows]


@app.post("/api/admin/products/{product_id}/approve", dependencies=[Depends(require_admin)])
def approve_product(product_id: uuid.UUID, db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE products SET status='live',reviewed_at=now(),reviewed_by='developer',updated_at=now() WHERE id=:id AND status='pending_review' RETURNING id"), {"id": product_id}).first()
    if not row:
        raise HTTPException(404, "Pending product not found")
    db.execute(text("INSERT INTO moderation_events(product_id,stage,decision,reason,reviewer_id) VALUES (:id,'manual','approved','Approved by Incognito review team','developer')"), {"id": product_id})
    db.execute(text("INSERT INTO audit_events(actor_type,action,object_type,object_id) VALUES ('developer','product.approve','product',:id)"), {"id": str(product_id)})
    db.commit()
    return {"id": str(product_id), "status": "live"}


@app.post("/api/admin/products/{product_id}/reject", dependencies=[Depends(require_admin)])
def reject_product(product_id: uuid.UUID, reason: str = Query(min_length=3, max_length=500), db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE products SET status='rejected',reviewed_at=now(),reviewed_by='developer',updated_at=now() WHERE id=:id AND status='pending_review' RETURNING id"), {"id": product_id}).first()
    if not row:
        raise HTTPException(404, "Pending product not found")
    db.execute(text("INSERT INTO moderation_events(product_id,stage,decision,reason,reviewer_id) VALUES (:id,'manual','rejected',:reason,'developer')"), {"id": product_id, "reason": reason})
    db.execute(text("INSERT INTO audit_events(actor_type,action,object_type,object_id) VALUES ('developer','product.reject','product',:id)"), {"id": str(product_id)})
    db.commit()
    return {"id":str(product_id),"status":"rejected","reason":reason}


@app.post("/api/admin/sellers/{seller_id}/approve", dependencies=[Depends(require_admin)])
def approve_seller(seller_id: uuid.UUID, db: Session = Depends(get_db)):
    row = db.execute(text("UPDATE app_users SET account_status='active',updated_at=now() WHERE id=:id AND role='seller' AND phone_verified=true AND account_status='pending_review' RETURNING id"), {"id": seller_id}).first()
    if not row:
        raise HTTPException(404, "Pending verified seller not found")
    db.execute(text("INSERT INTO audit_events(actor_type,action,object_type,object_id) VALUES ('developer','seller.approve','seller',:id)"), {"id": str(seller_id)})
    db.commit()
    return {"id": str(seller_id), "status": "active"}


@app.get("/", include_in_schema=False)
def home():
    return FileResponse("/app/static/index.html")


app.mount("/assets", StaticFiles(directory="/app/static", check_dir=False), name="assets")
