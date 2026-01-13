# Architecture

## Simplified Architecture (High Level)

```mermaid
flowchart LR
  FE[Frontend\n(React)] --> BE[Cloud Run\nBackend API\n(Node/Express)]
  BE --> FS[Firestore\n(metadata)]
  BE --> ST[Storage\n(files)]
  BE --> SAM3[SAM3\n(Cloud Run)]
```
