import 'dotenv/config';
import Fastify from 'fastify';
import crypto from 'crypto';
import { handlePullRequestEvent } from './github/app.js';

const fastify = Fastify({
  logger: true,
});

// Capture raw body for signature verification
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    const json = JSON.parse(body as string);
    // Attach raw body to the request object so we can use it in our handler
    (req as any).rawBody = body;
    done(null, json);
  } catch (err: any) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) {
    fastify.log.warn('WEBHOOK_SECRET is not set, skipping signature verification.');
    return true; // For local testing if secret is not provided
  }
  
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(payload);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (e) {
    return false;
  }
}

fastify.post('/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'] as string;
  const eventName = request.headers['x-github-event'] as string;
  const rawBody = (request.raw as any).rawBody || (request as any).rawBody;

  if (!signature) {
    return reply.status(401).send({ error: 'No signature provided' });
  }

  if (!verifySignature(rawBody, signature)) {
    return reply.status(401).send({ error: 'Invalid signature' });
  }

  // We only care about pull_request events
  if (eventName === 'pull_request') {
    const payload = request.body as any;
    
    // We only care when PR is opened or new commits are pushed
    if (payload.action === 'opened' || payload.action === 'synchronize') {
      fastify.log.info(`Received PR event: ${payload.action} for PR #${payload.pull_request.number}`);
      
      // Process event asynchronously so we can quickly return 200 to GitHub
      handlePullRequestEvent(payload).catch(err => {
        fastify.log.error(`Error processing PR event: ${err}`);
      });
    }
  }

  return reply.status(200).send({ ok: true });
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
