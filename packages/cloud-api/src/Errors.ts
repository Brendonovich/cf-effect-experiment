import { Schema } from "effect";

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()(
  "ProjectNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()(
  "TeamNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class DeploymentNotFound extends Schema.TaggedError<DeploymentNotFound>()(
  "DeploymentNotFound",
  {},
  { httpApiStatus: 404 },
) {}
export class ExecutionNotFound extends Schema.TaggedError<ExecutionNotFound>()(
  "ExecutionNotFound",
  {},
  { httpApiStatus: 404 },
) {}
