# SAM2 Point-Based Mask Prediction Service
# Designed for Cloud Run with NVIDIA L4 GPU

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

WORKDIR /app

# Install system dependencies for image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download SAM2 model weights at build time to avoid cold start delay
RUN python -c "from ultralytics import SAM; SAM('sam2.1_b.pt')"

COPY main.py .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "main.py"]
