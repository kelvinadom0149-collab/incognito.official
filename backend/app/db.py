import boto3
import psycopg
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .settings import get_settings

settings = get_settings()


def connect_with_iam():
    token = boto3.client("rds", region_name=settings.aws_region).generate_db_auth_token(
        DBHostname=settings.db_host, Port=settings.db_port, DBUsername=settings.db_user
    )
    return psycopg.connect(
        host=settings.db_host, port=settings.db_port, dbname=settings.db_name,
        user=settings.db_user, password=token, sslmode="verify-full",
        sslrootcert=settings.db_ssl_root_cert, connect_timeout=5,
    )


if settings.db_iam_auth:
    engine = create_engine("postgresql+psycopg://", creator=connect_with_iam, pool_pre_ping=True, pool_recycle=840, pool_size=5, max_overflow=10)
else:
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
