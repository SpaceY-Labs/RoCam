# Unit Tests

## Prerequisites

Build the shared package first (required for backend tests):

```bash
cd src/labelling-app/shared
npm run build
```

## Running Tests

```bash
# Backend
cd src/labelling-app/backend
npx vitest run --coverage

# Shared
cd src/labelling-app/shared
npx vitest run --coverage
```

## Labelling API Contract Check

Run the API contract probe script against a deployed backend:

```bash
node test/labelling_api_contract_check.mjs
```

Required environment variables:
- `API_BASE_URL`
- `AUTH_TOKEN`

Optional identifiers (enable extra endpoints):
- `PROJECT_ID`
- `IMAGE_ID`
- `EXPORT_ID`
- `USER_ID`
- `CLASS_ID`
