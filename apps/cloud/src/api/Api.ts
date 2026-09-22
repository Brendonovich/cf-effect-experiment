import {
  ExecutionsApiGroup,
  CredentialsApiGroup,
  EventsApiGroup,
  PreviewsApiGroup,
  ProjectsApiGroup,
  DeploymentsApiGroup,
  SessionApiGroup,
  TeamsApiGroup,
} from "@macrograph/cloud-api";
import { HttpApi } from "effect/unstable/httpapi";
import { OpenApi } from "effect/unstable/httpapi";

import { EditorRpcApiGroup } from "../editor/EditorRpcApi.ts";

export class Api extends HttpApi.make("Api")
  .add(SessionApiGroup)
  .add(TeamsApiGroup)
  .add(ProjectsApiGroup)
  .add(DeploymentsApiGroup)
  .add(ExecutionsApiGroup)
  .add(CredentialsApiGroup)
  .add(EventsApiGroup)
  .add(PreviewsApiGroup)
  .add(EditorRpcApiGroup)
  .annotate(OpenApi.Title, "MacroGraph Cloud API")
  .annotate(OpenApi.Version, "1.0.0") {}
