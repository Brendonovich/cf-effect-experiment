import * as Cloudflare from "@alchemy.run/cloudflare";

/**
 * Hosts Cloud's APIs, editor connections, and web app at `/cloud` on the main site. In production
 * Worker Routes claim those paths ahead of WebsiteWorker's Custom Domain; other stages reach it
 * through WebsiteWorker's service binding. The implementation lives in `CloudWorkerLayer.ts`.
 */
export class CloudWorker extends Cloudflare.Worker<CloudWorker, {}>()("CloudWorker") {}
