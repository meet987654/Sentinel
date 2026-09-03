# Sentinel

Sentinel is a GitHub-native bot that automatically detects breaking API contract changes and flags the specific TypeScript code in your repository that will be affected by those changes.

Built with Fastify, ts-morph, and Groq (LLMs), Sentinel ensures your frontend and consumer services never break due to unannounced backend API changes.

---

## Features

- **Automated Schema Diffing:** Automatically detects when `openapi.yaml` changes in a Pull Request and diffs the `base` and `head` branches to find breaking changes (e.g., removed fields, changed types).
- **AST Code Analysis:** Uses Abstract Syntax Trees (`ts-morph`) to scan your TypeScript source code and find exactly which files and lines of code are consuming the broken endpoints.
- **AI-Powered Summaries:** Uses Groq's high-speed LLMs (Qwen/Llama) to generate human-readable summaries of the breaking changes and suggest mitigation strategies.
- **GitHub Native:** Seamlessly integrates into your workflow by posting detailed markdown comments on Pull Requests and blocking merges via failing Check Runs.

## In Action

![Sentinel blocking a PR with an AST analysis summary](assets/screenshot.png)

## Architecture and Workflow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GitHub as GitHub PR
    participant Sentinel as Sentinel App (Render)
    participant Groq as Groq LLM

    Dev->>GitHub: Modifies openapi.yaml
    GitHub->>Sentinel: Webhook (pull_request.opened)
    Sentinel->>GitHub: Fetch base & head schemas
    Sentinel->>Sentinel: Diff schemas for breaking changes
    Sentinel->>GitHub: Fetch TypeScript source files
    Sentinel->>Sentinel: AST Analysis (ts-morph)
    Sentinel->>Groq: Request plain-English summary
    Groq-->>Sentinel: Return summary
    Sentinel->>GitHub: Post PR Comment
    Sentinel->>GitHub: Fail Check Run (Block Merge)
```

1. **Webhook Trigger:** When a Pull Request is opened or updated, GitHub sends a webhook payload to the Sentinel server.
2. **Analysis Pipeline:** Sentinel fetches the OpenAPI schema from both branches, diffs them, and analyzes the TypeScript files for consumers of the changed endpoints.
3. **LLM Generation:** The raw breaking changes and AST findings are sent to Groq for natural language summarization.
4. **Report Generation:** Sentinel posts the final report as a PR comment and updates the Check Run status to prevent breaking changes from being merged.

## Setup and Installation

### Prerequisites
- Node.js (v20+)
- A GitHub App configured with Webhook events for Pull Requests and Check Runs.
- A Groq API Key

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/meet987654/Sentinel.git
   cd Sentinel
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```env
   APP_ID=your_github_app_id
   PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
   WEBHOOK_SECRET=your_webhook_secret
   GROQ_API_KEY=your_groq_api_key
   SCHEMA_FILE_PATH=openapi.yaml
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Use a tunnel like `localtunnel` to forward webhooks to `localhost:3000`.

### Cloud Deployment
Sentinel includes a `Dockerfile` and is fully ready to be deployed to platforms like Render, Railway, or AWS. Simply connect your repository, add your environment variables, and map the public URL to your GitHub App's webhook settings.

## Built With

- **[Fastify](https://fastify.dev/)** - High performance Node.js web framework
- **[Octokit](https://github.com/octokit)** - Official GitHub API client
- **[ts-morph](https://ts-morph.com/)** - TypeScript Abstract Syntax Tree manipulator
- **[Groq SDK](https://console.groq.com/)** - Ultra-fast LLM inference
- **[swagger-parser](https://apitools.dev/swagger-parser/)** - OpenAPI schema parsing

## Contributing

We welcome contributions from the open-source community! Whether it is a bug report, feature request, or a code contribution, your input is highly valued.

### How to Contribute

1. **Report Issues:** If you encounter a bug or have a suggestion, please open an issue in the [Issue Tracker](https://github.com/meet987654/Sentinel/issues). Be sure to include a clear description and steps to reproduce any bugs.
2. **Request Features:** Have an idea to make Sentinel better? Open an issue and describe the feature, its use case, and how it would benefit the project.
3. **Submit Pull Requests:** 
   - Fork the repository.
   - Create a new branch for your feature or bug fix (`git checkout -b feature/your-feature-name`).
   - Make your changes and write tests if applicable.
   - Commit your changes (`git commit -m "Add some feature"`).
   - Push to the branch (`git push origin feature/your-feature-name`).
   - Open a Pull Request against the `main` branch.

Please ensure your code follows the existing style and passes all tests before submitting.

## License
MIT License
