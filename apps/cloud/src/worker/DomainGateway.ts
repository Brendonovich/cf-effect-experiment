export default {
  fetch(request: Request, env: { WORKER: { fetch(request: Request): Promise<Response> } }) {
    // Forward unchanged so the public origin, streaming bodies, and WebSockets survive.
    return env.WORKER.fetch(request);
  },
};
