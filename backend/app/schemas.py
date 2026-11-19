import re
from typing import Literal
from pydantic import BaseModel, EmailStr, Field, field_validator


def normalize_ghana_phone(value: str) -> str:
    digits = "".join(c for c in value if c.isdigit())
    if digits.startswith("233") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 10:
        return "+233" + digits[1:]
    raise ValueError("Enter a valid Ghana mobile number, such as 024 123 4567")


class Registration(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str
    email: EmailStr | None = None
    password: str = Field(min_length=10, max_length=128)
    role: Literal["customer", "seller"]

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value):
        return normalize_ghana_phone(value)


class Login(BaseModel):
    phone: str
    password: str = Field(min_length=1, max_length=128)

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value):
        return normalize_ghana_phone(value)


class VerifyCode(BaseModel):
    phone: str
    code: str = Field(pattern=r"^[0-9]{6}$")

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value):
        return normalize_ghana_phone(value)


class PhoneOnly(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, value):
        return normalize_ghana_phone(value)


class ProductIn(BaseModel):
    title: str = Field(min_length=3, max_length=100)
    category: Literal["style", "home", "food", "care"]
    description: str = Field(min_length=10, max_length=1500)
    price_pesewas: int = Field(gt=0, le=100_000_000)
    stock: int = Field(ge=0, le=1_000_000)
    preparation: str = Field(max_length=80)
    condition: Literal["new", "used", "refurbished"] = "new"
    delivery_available: bool = True
    negotiable: bool = False
    specifications: str = Field(min_length=2, max_length=1500)
    fulfillment: Literal["locker", "blind_shipping", "digital"] = "blind_shipping"
    image_key: str = Field(pattern=r"^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$")
    image_keys: list[str] | None = Field(default=None, min_length=1, max_length=8)
    proof_video_key: str | None = Field(default=None, pattern=r"^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm|mov)$")

    @field_validator("image_keys")
    @classmethod
    def valid_image_keys(cls, value):
        if value is not None:
            pattern = r"^products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$"
            if any(not re.fullmatch(pattern, key) for key in value):
                raise ValueError("Invalid product image key")
        return value


class UploadRequest(BaseModel):
    content_type: Literal["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"]
    size_bytes: int = Field(gt=0, le=100 * 1024 * 1024)


class OrderLine(BaseModel):
    product_id: str
    quantity: int = Field(gt=0, le=100)


class OrderIn(BaseModel):
    lines: list[OrderLine] = Field(min_length=1, max_length=30)
    recipient_name: str = Field(min_length=2, max_length=120)
    recipient_phone: str
    email: EmailStr | None = None
    region: str = Field(min_length=2, max_length=80)
    town: str = Field(min_length=2, max_length=100)
    delivery_address: str = Field(min_length=5, max_length=500)
    digital_address: str | None = Field(default=None, max_length=30)
    delivery_notes: str | None = Field(default=None, max_length=500)

    @field_validator("recipient_phone")
    @classmethod
    def valid_phone(cls, value):
        return normalize_ghana_phone(value)
