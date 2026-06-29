FROM python:3.12-slim

WORKDIR /app

# System deps (none required beyond base for current packages)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=3500
EXPOSE 3500

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-3500}"]
