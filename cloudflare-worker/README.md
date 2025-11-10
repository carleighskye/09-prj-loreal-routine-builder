# Cloudflare Worker: OpenAI proxy

This worker acts as a small proxy so you can keep your OpenAI API key secret.

How it works

- The browser sends a POST to your worker with a JSON body: { messages: [...], model?: 'gpt-4o' }
- The worker reads the secret `OPENAI_API_KEY` from Cloudflare (set with `wrangler secret put OPENAI_API_KEY`) and forwards the request to OpenAI.
- The worker returns OpenAI's response to the browser and adds CORS headers.

Deployment (using Wrangler v2)

1. Install Wrangler: https://developers.cloudflare.com/workers/cli-wrangler/install
2. In this folder create a `wrangler.toml` with your account info. Example:

```toml
name = "loreal-openai-proxy"
main = "./worker.js"
compatibility_date = "2025-01-01"

[deploy]
atomic = true
```

3. Authenticate and set your OpenAI key as a secret (do NOT commit your API key):

```bash
wrangler login
wrangler secret put OPENAI_API_KEY
```

4. Publish:

```bash
wrangler publish
```

The command will return a worker URL like `https://<name>.<account>workers.dev`.

Client usage

1. In your browser code, set a constant `WORKER_URL` to the worker URL.
2. POST JSON { messages: [...] } to that URL. The worker will forward and respond with the OpenAI response.

Security notes

- Keep the API key only in Cloudflare secrets. Never store it in `secrets.js` or in source control.
- Consider adding rate-limiting or authentication to the worker if it will be publicly reachable.
