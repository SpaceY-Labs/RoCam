# Architecture

## Simplified Architecture (High Level)

```mermaid
flowchart LR
  FE[Frontend\n(React)] --> BE[Cloud Run\nBackend API + SAM3 GPU\n(Node/Express)]
  BE --> FS[Firestore\n(metadata)]
  BE --> ST[Storage\n(files)]
```
