# How to Run:

```bash
# Start the full backend
./start_backend.sh

# Start the backend with only recording management (rename, delete, download)
./start_backend.sh recording-management
```

# Unit Tests

```bash
pip install -r requirements-test.txt

pytest --cov=src --cov-branch --cov-report=term-missing
```

# How to Change the Model:

All the models for this project are stored in the `<repo-root>/src/benchmark/models` directory.

To use a certain model for the backend, you need to run the following command:

```bash
cd <repo-root>/src/backend

python3 ../benchmark/convert_tensorrt.py ../benchmark/models/<model-name>.pt ./src/cv_process/model.engine
```

# Ports

- 80: HTTP for frontend