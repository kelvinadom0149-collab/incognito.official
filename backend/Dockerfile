FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/certs \
  && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY backend/app /app/app
COPY backend/sql /app/sql
COPY index.html /app/static/index.html
COPY *.jpg /app/static/
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
