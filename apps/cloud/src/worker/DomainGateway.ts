export default {
  fetch(request: Request, env: { CLOUD_WORKER: { fetch(request: Request): Promise<Response> } }) {
    // Forward unchanged so the public origin, streaming bodies, and WebSockets survive.
    return env.CLOUD_WORKER.fetch(request);
  },
};
