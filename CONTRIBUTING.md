# Contributing to RoCam

Thank you for your interest in contributing to the RoCam project.

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/RoCam.git
   cd RoCam
   ```
3. Install dependencies (see [INSTALL.md](INSTALL.md)).

## Branch Naming

Use descriptive branch names with a category prefix:

- `feature/<description>` for new features
- `fix/<description>` for bug fixes
- `docs/<description>` for documentation changes
- `test/<description>` for test additions or fixes

## Development Workflow

1. Create a new branch from `main`.
2. Make your changes in focused, atomic commits.
3. Write or update tests for your changes.
4. Ensure all tests pass before pushing:
   ```bash
   # Backend
   cd src/backend && pytest

   # Frontend
   cd src/react-app && npm run test
   ```
5. Push your branch and open a Pull Request against `main`.

## Code Style

- **Python (Backend):** Follow PEP 8. Use Ruff for linting and Black for formatting.
- **TypeScript (Frontend):** Follow the ESLint and Prettier configuration in the project.
- **Comments:** Explain *what* and *why*, not *how*. Every module file should have a header docstring identifying its author, date, and purpose.

## Pull Request Guidelines

- Keep PRs focused on a single change.
- Include a clear description of what the PR does and why.
- Reference related GitHub Issues (e.g., `Closes #123`).
- All CI checks (linting, tests) must pass before merge.
- At least one team member must review and approve the PR.

## Reporting Issues

Use [GitHub Issues](https://github.com/SpaceY-Labs/RoCam/issues) to report bugs or request features. Include:

- A clear title and description
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Screenshots or logs if applicable
