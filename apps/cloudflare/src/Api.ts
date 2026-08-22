import {
  ExecutionsApiGroup,
  IngressEventsApiGroup,
  PreviewsApiGroup,
  ProjectsApiGroup,
  RevisionsApiGroup,
  SessionApiGroup,
  TeamsApiGroup,
} from "@macrograph/cloud-api";
import { HttpApi } from "effect/unstable/httpapi";
import { OpenApi } from "effect/unstable/httpapi";

export class Api extends HttpApi.make("Api")
  .add(SessionApiGroup)
  .add(TeamsApiGroup)
  .add(ProjectsApiGroup)
  .add(RevisionsApiGroup)
  .add(ExecutionsApiGroup)
  .add(IngressEventsApiGroup)
  .add(PreviewsApiGroup)
  .annotate(OpenApi.Title, "Macrograph Cloud API")
  .annotate(OpenApi.Version, "1.0.0") {}
