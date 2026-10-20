FROM python:3.13-slim-bookworm
RUN pip install --no-cache-dir psycopg[binary]==3.2.13
WORKDIR /app
COPY relay.py /app/relay.py
USER 65534:65534
CMD ["python", "-u", "/app/relay.py"]
