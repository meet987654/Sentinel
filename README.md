# Sentinel

### API Impact Analyzer for GitHub

> **Sentinel detects breaking API contract changes and maps them to detected consumer usages, files, and lines of code during code review.**

---

## The Problem

Modern software development relies heavily on APIs to connect backend services with frontend applications and microservices. However, API contracts inevitably evolve:

- Backend engineers remove or rename schema fields.
- Endpoints change response shapes or parameter requirements.
- Types are narrowed or made required.

When an API contract changes incompatibly, current developer tools answer parts of the problem—but leave a critical gap:

```text
Backend API Contract Change (e.g. university → college)
           │
           ├── Code-Quality Tools (SonarCloud, Codacy)
           │   └── "Is the modified backend code clean and maintainable?"
           │
           ├── API Contract Analyzers (oasdiff)
           │   └── "Did the OpenAPI spec change in a breaking way?"
           │
           └── Sentinel (API Impact Analyzer)
               └── "Which consumers depend on that changed contract, and where in their source code?"
```

---

## Why Existing Tools Don't Answer This Question

| Tool Category | Primary Question Answered | Focus Area |
| :--- | :--- | :--- |
| **Code-Quality / Security Analyzers** *(SonarCloud, Codacy)* | Is the code introducing bugs, security vulnerabilities, or maintainability issues? | Internal repository code health |
| **API Contract Analyzers** *(oasdiff)* | Did the API contract change in a breaking way? | Schema diffing & contract compatibility |
| **Sentinel** | **Which consumers have detected dependencies on the changed contract, and where?** | **Source-level consumer impact analysis** |

### Sentinel & `oasdiff`

Sentinel does not attempt to reinvent OpenAPI breaking-change detection. Existing tools such as [`oasdiff`](https://github.com/Tufin/oasdiff) already provide sophisticated contract-diff capabilities. 

Sentinel uses contract analysis as the entry point and focuses on the next question: **given that an API contract changed, where is that change expressed in consumer source code?**

---

## See the Difference

Consider a common breaking change where a backend API renames the field `university` to `college`:

```diff
  Member:
    type: object
    properties:
      id:
        type: string
-     university:
-       type: string
+     college:
+       type: string
```

### Traditional API Diff Tool Output
> `WARN: Property 'university' was removed from schema 'Member'.`

### Sentinel Output (Pull Request Check / Comment)

```text
⚠ Breaking API Change Detected

Schema property 'Member.university' was removed.

Detected consumer usage:

web-frontend
  src/pages/community.tsx:67
  member.university

admin-dashboard
  src/components/MemberRow.tsx:31
  member.university

2 detected source usages across 2 files.
```

---

## How Sentinel Works

Sentinel's design rests on four core pillars:

### 1. Contract Analysis
Parses OpenAPI 3.0 specifications and computes structural diffs to isolate breaking schema removals, type shifts, and path changes.

### 2. Consumer Discovery
Determines which codebases and modules should be analyzed as potential consumers of the changed API.

### 3. Source-Level Impact Analysis
Scans consumer source ASTs for property access expressions corresponding to the changed contract surface, with deeper type/symbol resolution planned.

### 4. Evidence-First Reporting
Surfaces concrete source evidence—exact files, line numbers, and code snippets—directly inside GitHub PRs and Check Runs. AI assistance is used strictly to summarize and explain findings, not to determine breakage.

> **Core Philosophy:** *Deterministic analysis establishes evidence. AI explains the evidence.*

---

## Technical Architecture

### The North Star Execution Loop
```text
ONE API
  ↓
ONE breaking contract change
  ↓
ONE TypeScript consumer
  ↓
ONE resolved source dependency
  ↓
ONE exact file + line
  ↓
ONE trustworthy GitHub result
```

### Progressive Scaling Model
Sentinel scales this core loop across three dimensions:
1. **1 consumer → many consumers**
2. **1 repository → many repositories**
3. **REST/OpenAPI → multiple contract protocols**

### Symbol Resolution Pipeline
```text
OpenAPI Spec
     ↓
GET /members/{id}
     ↓
Member Schema (university property removed)
     ↓
Consumer Response Interface (e.g. MemberResponse)
     ↓
TypeScript Symbol Resolution (Typechecker & AST)
     ↓
PropertyAccessExpression (member.university)
     ↓
Source Location (src/pages/community.tsx:67)
```

---

## Evidence Classification

Static analysis surfaces source-level evidence rather than guaranteeing runtime failures. Sentinel categorizes findings into four explicit confidence levels:

| Classification | Definition |
| :--- | :--- |
| **Confirmed source usage** | A statically resolved reference to the changed contract surface was identified in consumer source code. |
| **Potential impact** | A likely reference was identified, but static analysis could not fully resolve the dependency (e.g. dynamic access or unverified type path). |
| **No detected usage** | No reference to the changed contract surface was found in the analyzed consumer codebase. |
| **Unable to determine** | Analysis could not establish whether the consumer depends on the changed contract (e.g. unparseable file or unresolvable import). |

---

## Performance & Scalability Direction

As Sentinel expands to multi-repository analysis, the architecture is designed around incremental indexing and targeted analysis:

```text
Repository Indexing → Symbol & Dependency Index → Incremental Analysis → Targeted Consumer Scan → Result Caching
```

- **Symbol & Dependency Indexing:** Pre-builds light dependency indices for consumer repositories.
- **Targeted Consumer Scanning:** Restricts AST scanning only to consumers importing the affected API endpoints or types.
- **Incremental Analysis & Caching:** Caches AST parsing results across commits to ensure low latency during CI/CD PR checks.

---

## Implementation Status

### Implemented
- **OpenAPI 3.0 Contract Diffing:** Breaking change detection for field removals, type shifts, and required parameters (`src/schema/differ.ts`).
- **TypeScript AST Scanning:** `PropertyAccessExpression` identifier extraction using `ts-morph` (`src/analyzer/tsMorph.ts`).
- **Source Location Mapping:** File path and exact line number identification for detected usages.
- **GitHub Webhook Integration:** Event handling for PR `opened` and `synchronize` triggers (`src/github/app.ts`).
- **GitHub Check Run Annotations:** Inline Check Run reporting and code annotations via Octokit (`src/github/reporter.ts`).
- **PR Markdown Summaries:** Automated PR summary comments detailing breaking contract changes and findings.

### In Development
- **Full TypeScript Symbol Resolution:** Deep type-checker tracing (`OpenAPI schema property → response type → TypeScript symbol → PropertyAccessExpression`).
- **Cross-Repository Consumer Discovery:** Automated discovery and scanning of external consumer repositories.

### Vision
- **Organization-Wide Dependency Graph:** Cross-repository index tracking contract dependencies end-to-end.
- **Multi-Protocol Contracts:** Schema analysis support for GraphQL, gRPC protobufs, and AsyncAPI.
- **Automated Remediation:** AI-generated migration suggestions and automated pull requests to update consumer code.

---

## Roadmap

### Phase 1 — Source-Level Impact
Establish the core pipeline from OpenAPI breaking-change detection to TypeScript source-level usage locations, including the planned symbol-resolution layer.

### Phase 2 — GitHub-Native Integration
Harden and expand GitHub integration with richer inline annotations, PR UX, configuration, permissions, failure handling, and repository-level workflows.

### Phase 3 — Cross-Repository Consumer Discovery
Discover consuming repositories across GitHub organizations and analyze candidate consumer repositories automatically.

### Phase 4 — Organization-Wide Dependency Graph
Construct an organization-wide graph tracing `API → Endpoint → Schema → Repository → File → Symbol → Usage`.

### Phase 5 — Multi-Protocol Contracts
Extend contract analysis beyond OpenAPI to GraphQL schemas, gRPC protobufs, and AsyncAPI specifications.

### Phase 6 — Evidence & Remediation
Source evidence → LLM explanation → migration suggestions → automated PR fixes.

---

## Scope & Language Boundaries

Sentinel focuses on executing a tight, reliable analysis loop before expanding language and protocol coverage:

- **Initial Scope:** OpenAPI 3.0 REST APIs, TypeScript/TSX consumers, GitHub Pull Requests.
- **Planned Boundaries:** Monorepo package boundaries, Python/Go consumer ASTs, GraphQL/gRPC protocols.

---

## Getting Started

### Prerequisites
- Node.js >= 18
- npm or pnpm

### Installation & Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/meet987654/Sentinel.git
   cd Sentinel
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Set your `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`.

4. Run tests:
   ```bash
   npm test
   ```

5. Start the server locally:
   ```bash
   npm run dev
   ```

---

## License

[MIT](LICENSE)
