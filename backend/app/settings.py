from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    environment: str = "local"
    database_url: str = "postgresql+psycopg://marketplace:local-only-change-me@db:5432/marketplace"
    db_iam_auth: bool = False
    db_host: str = ""
    db_name: str = "marketplace"
    db_user: str = "marketplace_api"
    db_port: int = 5432
    db_ssl_root_cert: str = "/app/certs/rds-global-bundle.pem"
    auth_secret: str = ""
    admin_token: str = ""
    cors_origins: str = "http://localhost:8000,http://127.0.0.1:8000"
    whatsapp_phone_number_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_template_name: str = ""
    whatsapp_graph_version: str = "v27.0"
    otp_pepper: str = ""
    media_bucket: str = ""
    media_public_base_url: str = ""
    aws_region: str = "af-south-1"
    enable_docs: bool = True
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_currency: str = "ghs"
    public_app_url: str = "http://localhost:8000"
    review_email: str = ""
    review_from_email: str = "noreply@incognito.com"

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
