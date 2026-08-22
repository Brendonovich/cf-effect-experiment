import { Schema } from "effect";

export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()(
  "ProjectNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class TeamNotFound extends Schema.TaggedErrorClass<TeamNotFound>()(
  "TeamNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class RevisionNotFound extends Schema.TaggedErrorClass<RevisionNotFound>()(
  "RevisionNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class ExecutionNotFound extends Schema.TaggedErrorClass<ExecutionNotFound>()(
  "ExecutionNotFound",
  {},
  { httpApiStatus: 404 },
) {}
