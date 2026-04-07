# Frontend

Author: Zifan Si
Date: 2025-09-26
Purpose: Documents the React frontend workspace, its major modules, and the standard commands used to run and verify it.

## Overview

This frontend provides the operator interface for the RoCam system. It is a Vite + React + TypeScript application that renders the live control dashboard, system status panels, backend log viewer, and recordings management workflow.

## Prerequisites

- Node.js 18 or newer
- Yarn 1.x
- A backend instance when testing live API or stream behavior

## Install

```bash
cd src/react-app
yarn
```

## Run

Start the development server:

```bash
yarn dev
```

Create a production build:

```bash
yarn build
```

Preview the production build locally:

```bash
yarn preview
```

## Test And Quality Checks

Run the full unit test suite:

```bash
yarn test
```

Run tests with coverage output:

```bash
yarn test:coverage
```

Run linting:

```bash
yarn lint
```

Format the workspace:

```bash
yarn format
```

## Frontend Code Map

- `src/main.tsx`: React entry point that mounts routing and shared providers.
- `src/provider.tsx`: Composes Jotai, i18n, HeroUI, toast, and backend providers.
- `src/App.tsx`: Defines the top-level route table.
- `src/pages/control.tsx`: Renders the live control dashboard.
- `src/pages/recordings.tsx`: Renders recording list, rename, delete, and preview flows.
- `src/components/`: Contains reusable UI sections such as controls, status, logs, navigation, and configuration.
- `src/network/api.ts`: Defines backend response types and the API client.
- `src/network/rocamProvider.tsx`: Exposes backend status, logs, and API access through context.
- `src/store/settingsAtom.ts`: Stores persisted frontend preferences.
- `src/utils/` and `src/utils.ts`: Shared formatting and error-display helpers.
- `src/test/`: Shared test setup and reusable test render helpers.

## Notes

- Translation catalogs are managed through Lingui.
- The production build emits static assets to `dist/`, which can be served by the backend.
- Generated locale files and third-party dependencies are not intended for manual documentation edits.
