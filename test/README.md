# Automated tests

The folders and files for this folder are as follows:

Describe ...

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
