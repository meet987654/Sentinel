# Sentinel — Complete Copy-Paste GitHub Issues Backlog (21 Issues)

This document contains **21 complete, copy-paste ready GitHub Issues**. Each issue is enclosed in a Markdown code block so you can copy and paste the entire block directly into GitHub Issues.

---

# 🎨 GitHub Custom Labels Setup Guide

Create these custom labels in your repository (**GitHub Repo → Issues → Labels → New label**):

| Label Name | Hex Color | Description |
| :--- | :--- | :--- |
| `phase-1` | `#1d76db` | Phase 1: Core AST & Symbol Engine |
| `phase-2` | `#0e8a16` | Phase 2: GitHub Integration & Developer Experience |
| `phase-3` | `#5319e7` | Phase 3: Cross-Repository Consumer Discovery |
| `phase-4` | `#fbca04` | Phase 4: Organization Dependency Graph & Performance |
| `phase-5` | `#d93f0b` | Phase 5: Multi-Protocol Contracts (GraphQL/gRPC/AsyncAPI) |
| `phase-6` | `#b60205` | Phase 6: AI Evidence & Automated Remediation |
| `core-analyzer` | `#0052cc` | Core ts-morph AST analyzer logic |
| `schema-engine` | `#bfdadc` | OpenAPI, GraphQL, gRPC schema parsing & diffing |
| `github-app` | `#24292e` | GitHub Octokit API, Check Runs & Webhooks |
| `cli` | `#006b75` | Standalone CLI runner package |
| `discovery` | `#d4c5f9` | Cross-repository consumer scanner |
| `performance` | `#d4c5f9` | Indexing, caching & performance optimizations |
| `llm` | `#f9d0c4` | AI evidence prompt engineering & LLM integration |
| `good-first-issue` | `#7057ff` | Beginner friendly for open-source contributors |
| `help-wanted` | `#008672` | Community help wanted |

---

# 📌 Phase 1 — Source-Level Impact MVP (Core AST & Symbol Engine)

---

### Issue #1: `[Feat] Implement Full TypeScript Symbol Resolution Pipeline`
**Labels**: `phase-1`, `core-analyzer`, `enhancement`, `help-wanted`  
**Target Files**: `src/analyzer/tsMorph.ts`, `src/types.ts`

```markdown
### 📝 Description & Motivation
Currently, Sentinel's AST scanner matches property access expressions heuristically using `PropertyAccessExpression.getName()`. For example, if an OpenAPI schema property `university` is removed, Sentinel flags any property access `obj.university` in consumer files.

This approach creates false positives when `obj` is an unrelated local variable or a third-party object. To elevate findings from `Potential impact` to `Confirmed source usage`, Sentinel requires deep TypeScript symbol resolution using `ts-morph`'s TypeChecker interface. This ensures Sentinel verifies that `obj` actually resolves to a TypeScript interface corresponding to the target API payload response.

### 🏗️ Proposed Implementation Plan
1. Retrieve `ts-morph`'s TypeChecker using `project.getTypeChecker()`.
2. For each `PropertyAccessExpression` AST node, resolve the symbol via `access.getExpression().getType()`.
3. Inspect the symbol declaration to verify whether it matches the OpenAPI schema type declaration (e.g. `MemberResponse`, `GetMember200Response`).
4. Set `ConsumerFinding.confidence = 'confirmed'` when symbol resolution succeeds, or fallback to `'medium'` when symbol resolution is incomplete.

### 💻 Code Signature Hint
```typescript
const typeChecker = project.getTypeChecker();
const expressionType = access.getExpression().getType();
const symbol = expressionType.getSymbol();

if (symbol && isTargetApiSymbol(symbol, change.schemaName)) {
  confidence = 'confirmed';
}
```

### ✅ Acceptance Criteria
- [ ] Symbol resolution correctly distinguishes API response interface properties from unrelated local objects with matching field names.
- [ ] Finding confidence level updates to `'confirmed'` when symbol resolution succeeds.
- [ ] Unit tests added in `tests/analyzer/tsMorph.test.ts` verifying typed interface matching vs plain objects.
```

---

### Issue #2: `[Feat] Support De-structured Property Assignments & Type Aliases`
**Labels**: `phase-1`, `core-analyzer`, `good-first-issue`  
**Target Files**: `src/analyzer/tsMorph.ts`

```markdown
### 📝 Description & Motivation
In modern React and Node.js applications, API response payloads are frequently accessed via object destructuring rather than direct property access:
```tsx
const { university, email } = userResponse;
```
Currently, Sentinel primarily scans for `SyntaxKind.PropertyAccessExpression` (`userResponse.university`). As a result, destructured field references are missed during contract analysis.

### 🏗️ Proposed Implementation Plan
1. Update `src/analyzer/tsMorph.ts` to scan AST node kinds `SyntaxKind.ObjectBindingPattern` and `SyntaxKind.BindingElement`.
2. Check `element.getName()` to determine if the destructured variable matches a removed or modified API contract property name.
3. Traverse parent `VariableDeclaration` nodes to verify the type annotation matches the API response interface.
4. Extract the exact file path and line number of the destructuring statement.

### 💻 Code Signature Hint
```typescript
const bindingElements = sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement);
for (const element of bindingElements) {
  const propName = element.getPropertyNameNode()?.getText() || element.getName();
  if (propertyNamesToFind.has(propName)) {
    // Record finding for destructured property
  }
}
```

### ✅ Acceptance Criteria
- [ ] Destructured variables (e.g., `const { university } = res`) are detected accurately.
- [ ] Nested destructuring (e.g., `const { profile: { university } } = res`) is detected.
- [ ] Line numbers point to the exact destructuring line.
- [ ] Unit tests added in `tests/analyzer/tsMorph.test.ts`.
```

---

### Issue #3: `[Feat] Support Function Argument & Array Callback Property Tracing`
**Labels**: `phase-1`, `core-analyzer`, `enhancement`  
**Target Files**: `src/analyzer/tsMorph.ts`

```markdown
### 📝 Description & Motivation
API fields are frequently passed directly into utility functions or processed within array iterator callbacks:
```tsx
members.map((member) => renderMemberCard(member.university));
```
Sentinel must ensure callback parameter bindings and function call arguments are scanned without missing nested property access expressions inside arrow functions or function bodies.

### 🏗️ Proposed Implementation Plan
1. Inspect `SyntaxKind.CallExpression` and `SyntaxKind.ArrowFunction` / `SyntaxKind.FunctionExpression` descendants in `ts-morph`.
2. Traverse parameter bodies to locate property access expressions on callback arguments.
3. Retain the exact line number of the property access expression within function calls.

### ✅ Acceptance Criteria
- [ ] Property access inside `map`, `filter`, and `reduce` callbacks is detected.
- [ ] Property access passed into helper functions (`formatUniversity(user.university)`) is detected.
- [ ] Line numbers accurately reference the inner expression line.
```

---

### Issue #4: `[Feat] Recursive OpenAPI $ref Schema Pointer Resolution`
**Labels**: `phase-1`, `schema-engine`, `enhancement`  
**Target Files**: `src/schema/parser.ts`, `src/schema/differ.ts`

```markdown
### 📝 Description & Motivation
Real-world OpenAPI specifications rely heavily on `$ref` schema pointers (e.g., `#/components/schemas/MemberAddress`). When a property is removed inside a nested schema referenced by `$ref`, Sentinel must trace through `$ref` chains to identify the broken property path (e.g., `Member.address.university`).

### 🏗️ Proposed Implementation Plan
1. Update `src/schema/parser.ts` to recursively resolve `$ref` pointers using JSON pointer traversal.
2. Implement a visited `$ref` cache map to prevent infinite loops on circular schema definitions (e.g., `User -> manager -> User`).
3. Flatten schema property paths into dot-notation strings (`Member.address.university`).

### ✅ Acceptance Criteria
- [ ] Deeply nested `$ref` property removals are identified with full property paths.
- [ ] Circular schema references do not cause stack overflows or infinite loops.
- [ ] Unit tests added in `tests/schema/parser.test.ts`.
```

---

### Issue #5: `[Feat] OpenAPI 3.1 & Schema Variation Diffing Engine`
**Labels**: `phase-1`, `schema-engine`, `enhancement`  
**Target Files**: `src/schema/differ.ts`

```markdown
### 📝 Description & Motivation
OpenAPI 3.1 introduces native JSON Schema alignment, including polymorphic schema keyword variations (`oneOf`, `anyOf`, `allOf`) and multi-type arrays (`type: ["string", "null"]`). Sentinel's schema differ needs to compute breaking changes across these polymorphic variations.

### 🏗️ Proposed Implementation Plan
1. Update `src/schema/differ.ts` to compute diffs across `oneOf`, `anyOf`, and `allOf` schema arrays.
2. Flag breaking changes when a variant option is removed from `oneOf` or `anyOf`.
3. Detect OpenAPI 3.1 nullability shifts (e.g., changing `type: ["string", "null"]` to `type: "string"`).

### ✅ Acceptance Criteria
- [ ] Removals of polymorphic variants in `oneOf`/`anyOf` are flagged as breaking changes.
- [ ] OpenAPI 3.1 schema specs parse and diff cleanly without errors.
- [ ] Unit tests added in `tests/schema/differ.test.ts`.
```

---

# 📌 Phase 2 — GitHub-Native Integration & Developer Experience

---

### Issue #6: `[Feat] Repository Configuration File Parser (.sentinel.yml)`
**Labels**: `phase-2`, `github-app`, `good-first-issue`  
**Target Files**: `src/config.ts`, `src/github/app.ts`

```markdown
### 📝 Description & Motivation
Repositories require configurable settings to specify non-standard OpenAPI file locations, consumer glob paths, ignore patterns, and severity thresholds without hardcoding paths in server code.

### 🏗️ Proposed Implementation Plan
1. Create a YAML config parser in `src/config.ts` using the `yaml` package.
2. Fetch `.sentinel.yml` from repo root via Octokit on PR webhook events.
3. Parse and merge repo configuration with default fallback options:
```yaml
schemaPath: "openapi.yaml"
consumers:
  - "src/**/*.ts"
  - "src/**/*.tsx"
ignorePaths:
  - "**/__tests__/**"
  - "**/mockData.ts"
```

### ✅ Acceptance Criteria
- [ ] `.sentinel.yml` is parsed and respected if present in repository root.
- [ ] `ignorePaths` correctly excludes test and mock files from AST scanning.
- [ ] Default configuration applies seamlessly when `.sentinel.yml` is absent.
```

---

### Issue #7: `[Feat] In-Place PR Comment Threading & Delta Updates`
**Labels**: `phase-2`, `github-app`, `enhancement`  
**Target Files**: `src/github/reporter.ts`

```markdown
### 📝 Description & Motivation
Currently, every push to a PR (`synchronize` event) creates a new PR comment. This spams PR comment history. Sentinel should search for its existing comment on the PR and edit it in-place.

### 🏗️ Proposed Implementation Plan
1. Add hidden HTML signature tag `<!-- sentinel-impact-report -->` at top of Sentinel PR comments.
2. On PR update, query Octokit `octokit.rest.issues.listComments()`.
3. Search for existing comment matching signature tag.
4. If found, call `octokit.rest.issues.updateComment()`; otherwise call `octokit.rest.issues.createComment()`.

### ✅ Acceptance Criteria
- [ ] Pushing new commits updates existing Sentinel PR comment in-place.
- [ ] Comment body includes "Last updated at: [ISO Timestamp]".
- [ ] No duplicate comments are created on subsequent commits.
```

---

### Issue #8: `[Feat] GitHub Check Run Rich Annotations & Summary Badges`
**Labels**: `phase-2`, `github-app`, `enhancement`  
**Target Files**: `src/github/reporter.ts`

```markdown
### 📝 Description & Motivation
GitHub Check Runs support rich markdown summaries, status titles, and inline code annotations. Sentinel should leverage Check Run annotations to highlight exact breaking schema lines directly in PR code diff views.

### 🏗️ Proposed Implementation Plan
1. Update `postCheckRunReport()` in `src/github/reporter.ts`.
2. Pass array of `annotations` to `octokit.rest.checks.update()` containing `path`, `start_line`, `end_line`, `annotation_level: 'warning'`, `message`.
3. Add summary table formatting displaying total detected usages and breaking schema properties.

### ✅ Acceptance Criteria
- [ ] Yellow warning annotations appear directly on lines in the OpenAPI spec in PR Files Changed tab.
- [ ] Check Run summary displays formatted markdown impact table.
```

---

### Issue #9: `[Feat] Standalone CLI Runner Mode (@sentinel/cli)`
**Labels**: `phase-2`, `cli`, `enhancement`  
**Target Files**: `src/cli/index.ts`

```markdown
### 📝 Description & Motivation
Developers and CI pipelines (GitHub Actions, GitLab CI, local pre-commit hooks) need the ability to run Sentinel locally via command line without requiring a hosted GitHub App server.

### 🏗️ Proposed Implementation Plan
1. Create `bin/sentinel.js` CLI entrypoint using `commander` package.
2. Implement command flags:
   - `--schema <path>` (Path to OpenAPI file)
   - `--workspace <path>` (Path to consumer codebase)
   - `--fail-on-breakage` (Return exit code 1 if impact is found)
3. Print formatted terminal output tables using `cli-table3` and `chalk`.

### ✅ Acceptance Criteria
- [ ] `npx @sentinel/cli check --schema openapi.yaml --workspace ./src` executes locally.
- [ ] Returns exit code `1` when breaking usages are found if `--fail-on-breakage` is specified.
- [ ] Returns exit code `0` when no impact is detected.
```

---

# 📌 Phase 3 — Cross-Repository Consumer Discovery

---

### Issue #10: `[Feat] Organization-Wide Consumer Repository Discovery Engine`
**Labels**: `phase-3`, `discovery`, `architecture`  
**Target Files**: `src/discovery/multiRepo.ts`

```markdown
### 📝 Description & Motivation
In microservices architectures, consumer code resides in separate repositories within a GitHub Organization. Sentinel needs a discovery engine to find and scan external consumer repositories when a core API repository changes.

### 🏗️ Proposed Implementation Plan
1. Implement `discoverConsumerRepos()` in `src/discovery/multiRepo.ts`.
2. Query GitHub Octokit API for repositories in the organization tagged with GitHub topic `sentinel-consumer` or configured in `.sentinel.yml`.
3. Fetch consumer source file trees via Octokit Git Trees API (`octokit.rest.git.getTree`).
4. Run AST property scanning across consumer repositories.

### ✅ Acceptance Criteria
- [ ] External consumer repos tagged with topic `sentinel-consumer` are discovered automatically.
- [ ] Consumer repo source files are fetched via GitHub API and analyzed.
- [ ] Discovery engine handles missing or empty repos gracefully without crashing.
```

---

### Issue #11: `[Feat] Multi-Repo App Permissions & Installation Token Manager`
**Labels**: `phase-3`, `github-app`, `security`  
**Target Files**: `src/github/auth.ts`

```markdown
### 📝 Description & Motivation
When scanning external consumer repositories across a GitHub Organization, GitHub App authentication requires valid installation access tokens for each target repository.

### 🏗️ Proposed Implementation Plan
1. Implement `getConsumerRepoOctokit()` in `src/github/auth.ts`.
2. Generate repository-scoped access tokens using `@octokit/auth-app`.
3. Catch permission errors (`403 Forbidden`, `404 Not Found`) when App is not installed on a target consumer repo.
4. Report permission status as `Unable to determine (Permission Denied)` in final report.

### ✅ Acceptance Criteria
- [ ] Access tokens are generated securely per target consumer repository.
- [ ] Unaccessible consumer repos report permission warnings without throwing unhandled rejections.
```

---

### Issue #12: `[Feat] Aggregated Multi-Repo Impact Report Generator`
**Labels**: `phase-3`, `github-app`, `reporting`  
**Target Files**: `src/github/reporter.ts`

```markdown
### 📝 Description & Motivation
When an API change impacts multiple repositories (e.g. `web-frontend`, `admin-dashboard`, `mobile-app`), Sentinel must aggregate findings across repositories into a unified, collapsible PR comment.

### 🏗️ Proposed Implementation Plan
1. Group `ConsumerFinding[]` by `repositoryName`.
2. Render collapsible `<details><summary>` HTML blocks per repository.
3. Build deep markdown links pointing directly to GitHub file lines (`https://github.com/org/repo/blob/sha/file.ts#L67`).

### ✅ Acceptance Criteria
- [ ] PR comment groups impact logically by repository.
- [ ] Direct file links point to exact GitHub line locations in consumer repositories.
- [ ] Summary displays total detected usages across all organization repositories.
```

---

# 📌 Phase 4 — Organization-Wide Dependency Graph & Performance

---

### Issue #13: `[Feat] Symbol & Dependency Index Generator`
**Labels**: `phase-4`, `performance`, `architecture`  
**Target Files**: `src/cache/indexer.ts`

```markdown
### 📝 Description & Motivation
Scanning thousands of TypeScript files on every pull request slows down CI checks. Sentinel needs a symbol index generator that pre-indexes consumer repositories, mapping imported endpoints to source files.

### 🏗️ Proposed Implementation Plan
1. Implement `buildDependencyIndex()` in `src/cache/indexer.ts`.
2. Parse import declarations in consumer files to map imported API client routes and types.
3. Export symbol index snapshot as a JSON structure (`dependency-index.json`).

### ✅ Acceptance Criteria
- [ ] Dependency index correctly maps API routes/types to source files.
- [ ] Index snapshot serializes cleanly to JSON.
```

---

### Issue #14: `[Feat] Incremental AST Analysis & Commit Caching Layer`
**Labels**: `phase-4`, `performance`, `caching`  
**Target Files**: `src/cache/store.ts`

```markdown
### 📝 Description & Motivation
To prevent re-parsing unchanged consumer source files on subsequent PR commits, Sentinel requires an incremental cache layer keyed by commit hash and file contents.

### 🏗️ Proposed Implementation Plan
1. Implement cache store interface in `src/cache/store.ts` supporting in-memory LRU or Redis.
2. Key cached AST findings by `(commit_sha, file_path, property_name)`.
3. On PR check, skip AST parsing for files whose SHA hash matches the cached state.

### ✅ Acceptance Criteria
- [ ] Unchanged files hit cache and bypass re-parsing.
- [ ] Modified files invalidate cache and undergo fresh AST scanning.
- [ ] AST scanning latency drops by >= 70% on cached commits.
```

---

### Issue #15: `[Feat] Target Endpoint Consumer Filter`
**Labels**: `phase-4`, `performance`, `filtering`  
**Target Files**: `src/analyzer/filter.ts`

```markdown
### 📝 Description & Motivation
Before running heavy `ts-morph` AST parses across an entire codebase, Sentinel should fast-filter consumer files using lightweight regex/import scanning to isolate files referencing the modified endpoint path.

### 🏗️ Proposed Implementation Plan
1. Extract modified API path routes (e.g. `/api/v1/members`) from breaking change payload.
2. Perform fast string/regex scan over consumer source files to isolate candidate files importing or referencing the path route.
3. Pass only candidate files into `ts-morph` AST parser.

### ✅ Acceptance Criteria
- [ ] Irrelevant source files are filtered out prior to AST parsing.
- [ ] Fast filter preserves all candidate files referencing the target endpoint path.
```

---

# 📌 Phase 5 — Multi-Protocol Contract Support

---

### Issue #16: `[Feat] GraphQL Schema Breaking Change Parser & AST Tracer`
**Labels**: `phase-5`, `schema-engine`, `multi-protocol`  
**Target Files**: `src/schema/graphqlDiffer.ts`

```markdown
### 📝 Description & Motivation
Extend Sentinel's contract analysis pillar to support GraphQL SDL schemas (`schema.graphql`), detecting removed fields, deprecated types, and argument changes.

### 🏗️ Proposed Implementation Plan
1. Parse `.graphql` / `.gql` schemas using `@graphql-tools/schema` and `@graphql-tools/utils`.
2. Compute breaking changes (removed fields, type changes, added required arguments).
3. Trace removed GraphQL fields into consumer AST queries (`gql` template literals & `.graphql` documents).

### ✅ Acceptance Criteria
- [ ] Breaking GraphQL schema changes are detected cleanly.
- [ ] Removed fields in consumer `gql` query strings are located with line numbers.
- [ ] Unit tests added in `tests/schema/graphqlDiffer.test.ts`.
```

---

### Issue #17: `[Feat] gRPC Protobuf Contract Compatibility Checker`
**Labels**: `phase-5`, `schema-engine`, `multi-protocol`  
**Target Files**: `src/schema/protoDiffer.ts`

```markdown
### 📝 Description & Motivation
In microservice architectures using gRPC, Protocol Buffer (`.proto`) schema changes can break binary or generated TypeScript clients (e.g., field tag reassignments, field removals).

### 🏗️ Proposed Implementation Plan
1. Parse `.proto` files using `protobufjs` parser.
2. Detect breaking changes (field removals, tag number changes, type modifications).
3. Trace generated gRPC client field accesses in consumer TypeScript code.

### ✅ Acceptance Criteria
- [ ] Protobuf field removals and tag reassignments are identified as breaking changes.
- [ ] Generated gRPC client field usages in consumer code are highlighted.
```

---

### Issue #18: `[Feat] AsyncAPI Event Schema Compatibility Engine`
**Labels**: `phase-5`, `schema-engine`, `multi-protocol`  
**Target Files**: `src/schema/asyncapiDiffer.ts`

```markdown
### 📝 Description & Motivation
Event-driven architectures use AsyncAPI specs to document Kafka, RabbitMQ, or WebSocket event message payloads. Sentinel needs to detect breaking schema changes in AsyncAPI event messages.

### 🏗️ Proposed Implementation Plan
1. Parse AsyncAPI 2.x / 3.x specifications using `@asyncapi/parser`.
2. Diff message payload schemas to identify breaking property removals.
3. Trace event message property accesses inside event handler callback functions.

### ✅ Acceptance Criteria
- [ ] AsyncAPI message payload breaking changes are detected.
- [ ] Event handler callback payload property accesses are located in consumer code.
```

---

# 📌 Phase 6 — Evidence-First AI Remediation

---

### Issue #19: `[Feat] Deterministic Evidence Synthesizer & LLM Prompt Formatter`
**Labels**: `phase-6`, `llm`, `architecture`  
**Target Files**: `src/llm/promptBuilder.ts`

```markdown
### 📝 Description & Motivation
Sentinel's core philosophy is: *Deterministic analysis establishes evidence. AI explains the evidence.* To prepare data for LLM summarization, deterministic AST findings must be formatted into clean, sanitized prompt payloads.

### 🏗️ Proposed Implementation Plan
1. Create `buildImpactPrompt()` in `src/llm/promptBuilder.ts`.
2. Combine OpenAPI breaking change diff + exact AST file/line snippets into structured prompt payload.
3. Strip API keys, tokens, and sensitive comments from code snippets prior to LLM submission.

### ✅ Acceptance Criteria
- [ ] Prompt payload structures OpenAPI diff and AST findings clearly.
- [ ] Code sanitizer removes sensitive tokens and secrets before sending to LLM API.
```

---

### Issue #20: `[Feat] LLM-Assisted Code Migration Suggestion Generator`
**Labels**: `phase-6`, `llm`, `ai`  
**Target Files**: `src/llm/summarizer.ts`

```markdown
### 📝 Description & Motivation
Use Google Gemini or OpenAI API to turn raw AST findings into actionable developer migration guides rendered directly inside PR comments.

### 🏗️ Proposed Implementation Plan
1. Implement `generateMigrationGuide()` in `src/llm/summarizer.ts`.
2. Query LLM API with sanitized evidence payload.
3. Output concise code migration suggestions (e.g., "Replace `member.university` with `member.college`").
4. Render AI output in a collapsible `<details><summary>🤖 AI Migration Guide</summary>` block.
5. Fallback gracefully to raw deterministic output if LLM API call fails or times out.

### ✅ Acceptance Criteria
- [ ] Clear code migration suggestions generated for broken property usages.
- [ ] AI explanation renders as a collapsible section without blocking core deterministic output.
- [ ] API failure or timeout falls back gracefully without breaking check run.
```

---

### Issue #21: `[Feat] Automated Remediation Pull Request Generator`
**Labels**: `phase-6`, `remediation`, `automation`  
**Target Files**: `src/remediation/prGenerator.ts`

```markdown
### 📝 Description & Motivation
Sentinel can automate code fixes by generating automated pull requests in consumer repositories to update deprecated or renamed API field usages.

### 🏗️ Proposed Implementation Plan
1. Implement `createRemediationPR()` in `src/remediation/prGenerator.ts`.
2. Use `ts-morph` AST transformation to rename or update property access expressions in consumer source code.
3. Commit modified consumer files to a fix branch (e.g. `sentinel/fix-member-university`).
4. Open a Draft PR in consumer repository referencing the API provider PR.

### ✅ Acceptance Criteria
- [ ] `ts-morph` applies property rename transformations cleanly to consumer code.
- [ ] Draft PR created automatically in consumer repo with link to original provider PR.
```
