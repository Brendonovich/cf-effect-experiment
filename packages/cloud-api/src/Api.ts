import { HttpApi } from "effect/unstable/httpapi";

import { ExecutionsApiGroup } from "./ExecutionsApi.ts";
import { IngressEventsApiGroup } from "./IngressEventsApi.ts";
import { PreviewsApiGroup } from "./PreviewsApi.ts";
import { ProjectsApiGroup } from "./ProjectsApi.ts";
import { RevisionsApiGroup } from "./RevisionsApi.ts";
import { SessionApiGroup } from "./SessionApi.ts";
import { TeamsApiGroup } from "./TeamsApi.ts";

export class CloudApi extends HttpApi.make("CloudApi")
  .add(SessionApiGroup)
  .add(TeamsApiGroup)
  .add(ProjectsApiGroup)
  .add(RevisionsApiGroup)
  .add(ExecutionsApiGroup)
  .add(IngressEventsApiGroup)
  .add(PreviewsApiGroup) {}
