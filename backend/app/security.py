from datetime import datetime, timedelta, timezone
import hmac
import hashlib
import jwt
from pwdlib import PasswordHash
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session
from .db import get_db
from .settings import get_settings

password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)


def hash_password(value: str) -> str:
    return password_hash.hash(value)


def verify_password(value: str, encoded: str) -> bool:
    return password_hash.verify(value, encoded)


def make_token(user_id: str, role: str) -> str:
    cfg = get_settings()
    if len(cfg.auth_secret) < 32:
        raise HTTPException(503, "Authentication is not configured")
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user_id, "role": role, "iat": now, "exp": now + timedelta(hours=8)}, cfg.auth_secret, algorithm="HS256")


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    cfg = get_settings()
    if not credentials or len(cfg.auth_secret) < 32:
        raise HTTPException(401, "Sign in required")
    try:
        claims = jwt.decode(credentials.credentials, cfg.auth_secret, algorithms=["HS256"])
        user_id = claims.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired session")
    user = db.execute(text("SELECT id, role, full_name, phone, email, phone_verified, account_status, completed_sales, average_rating, refund_count, dispute_count FROM app_users WHERE id=:id"), {"id": user_id}).mappings().first()
    if not user or user["account_status"] == "suspended":
        raise HTTPException(401, "Account unavailable")
    return dict(user)


def require_role(role: str):
    def check(user: dict = Depends(current_user)):
        if user["role"] != role:
            raise HTTPException(403, "This account cannot access that area")
        return user
    return check


def require_admin(x_admin_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    expected = get_settings().admin_token
    if not expected or not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(403, "Developer administration access required")
    return {"role": "developer_admin"}


def otp_digest(user_id: str, code: str) -> str:
    pepper = get_settings().otp_pepper
    if len(pepper) < 32:
        raise HTTPException(503, "Phone verification is not configured")
    return hmac.new(pepper.encode(), f"{user_id}:{code}".encode(), hashlib.sha256).hexdigest()
