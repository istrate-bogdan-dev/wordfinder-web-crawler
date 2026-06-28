FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WORDFINDER_HOST=0.0.0.0 \
    WORDFINDER_PORT=8000 \
    WORDFINDER_DEV_RELOAD=false

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY frontend /app/frontend
COPY README.md /app/README.md

RUN useradd --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; port = os.getenv('WORDFINDER_PORT') or os.getenv('PORT') or '8000'; urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3).read()"

USER appuser

CMD ["python", "main.py"]
