import { HttpApi } from "effect/unstable/httpapi";

import { EventsApiGroup } from "./EventsApi.ts";
import { CredentialsApiGroup } from "./CredentialsApi.ts";
import { ExecutionsApiGroup } from "./ExecutionsApi.ts";
import { PreviewsApiGroup } from "./PreviewsApi.ts";
import { ProjectsApiGroup } from "./ProjectsApi.ts";
import { DeploymentsApiGroup } from "./DeploymentsApi.ts";
import { SessionApiGroup } from "./SessionApi.ts";
import { TeamsApiGroup } from "./TeamsApi.ts";

export class CloudApi extends HttpApi.make("CloudApi")
  .add(SessionApiGroup)
  .add(TeamsApiGroup)
  .add(ProjectsApiGroup)
  .add(DeploymentsApiGroup)
  .add(ExecutionsApiGroup)
  .add(EventsApiGroup)
  .add(CredentialsApiGroup)
  .add(PreviewsApiGroup) {}
