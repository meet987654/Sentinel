# Contributing to Sentinel 🛡️

Thank you for your interest in contributing to **Sentinel**! Sentinel is an automated API Impact Analyzer that deterministically maps OpenAPI breaking changes directly to consumer TypeScript source code lines.

---

## 🛠️ Development Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/meet987654/Sentinel.git
   cd Sentinel
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run Unit Tests**:
   ```bash
   npm test
   ```

4. **Build TypeScript Project**:
   ```bash
   npm run build
   ```

---

## 📌 Code Architecture

- **`src/server.ts`**: Fastify HTTP Webhook receiver for GitHub App events.
- **`src/github/app.ts`**: Octokit authentication & PR event orchestrator.
- **`src/schema/parser.ts`**: OpenAPI 3.0/3.1 dereferencing and recursive `$ref` pointer resolution.
- **`src/schema/differ.ts`**: Contract diffing engine isolating breaking schema changes.
- **`src/analyzer/tsMorph.ts`**: TypeScript consumer AST scanner using `ts-morph` and `TypeChecker`.
- **`src/github/reporter.ts`**: Inline GitHub Check Run annotation engine and PR reporter.

---

## 📜 Commit Guidelines

We follow Conventional Commits:
- `feat`: A new feature for Sentinel
- `fix`: A bug fix in parser, differ, or AST scanner
- `docs`: Documentation updates
- `test`: Unit test additions
