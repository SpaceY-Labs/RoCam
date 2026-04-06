# Installation Guide for RoCam

## Prerequisites

| Component | Version | Notes |
|-----------|---------|-------|
| NVIDIA Jetson Orin Nano | JetPack 6.x | Primary deployment platform |
| Python | 3.10+ | Backend services |
| Node.js | 24.x (see `.nvmrc`) | Frontend build toolchain |
| npm | 10.x+ | Included with Node.js |
| GStreamer | 1.20+ | Video pipeline (pre-installed on Jetson) |
| TensorRT | 10.x | CV inference acceleration (pre-installed on Jetson) |

## Backend Installation

```bash
cd src/backend

# Install Python dependencies
pip install -r requirement.txt

# (Optional) Install test dependencies
pip install -r requirements-test.txt
```

### Model Setup

A TensorRT engine file is required for the computer vision pipeline. Convert a YOLO model:

```bash
cd src/backend
python3 ../benchmark/convert_tensorrt.py ../benchmark/models/<model-name>.pt ./src/cv_process/model.engine
```

Pre-trained models are stored in `src/benchmark/models/`.

## Frontend Installation

```bash
cd src/react-app

# Install Node.js dependencies
npm install

# Compile language files
npx lingui compile

# Build for production
npm run build
```

## Running the System

### Start the Backend

```bash
cd src/backend

# Full backend (CV + gimbal + recording + API)
./start_backend.sh

# Recording management only (rename, delete, download)
./start_backend.sh recording-management
```

### Start the Frontend (Development)

```bash
cd src/react-app
npm run dev
```

### Network Ports

| Port | Service |
|------|---------|
| 80 | HTTP (frontend) |

## Running Tests

### Backend Tests

```bash
cd src/backend
pip install -r requirements-test.txt
pytest --cov=src --cov-branch --cov-report=term-missing
```

### Frontend Tests

```bash
cd src/react-app
npm run test
npm run test:coverage   # with coverage report
```

## Uninstall

1. Stop all running RoCam processes.
2. Remove the cloned repository:
   ```bash
   rm -rf RoCam/
   ```
3. (Optional) Remove installed Python packages:
   ```bash
   pip uninstall -r src/backend/requirement.txt -y
   ```
4. (Optional) Remove Node.js modules:
   ```bash
   rm -rf src/react-app/node_modules/
   ```
