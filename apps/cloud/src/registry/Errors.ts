import { Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
  message: Schema.String,
}) {}

export class NotAdmin extends Schema.TaggedError<NotAdmin>()("NotAdmin", {
  message: Schema.String,
}) {}

export class PublisherNotOwned extends Schema.TaggedError<PublisherNotOwned>()(
  "PublisherNotOwned",
  { publisher: Schema.String, message: Schema.String },
) {}

export class PublisherNotApproved extends Schema.TaggedError<PublisherNotApproved>()(
  "PublisherNotApproved",
  { publisher: Schema.String, status: Schema.String, message: Schema.String },
) {}

export class PublisherNameUnavailable extends Schema.TaggedError<PublisherNameUnavailable>()(
  "PublisherNameUnavailable",
  { publisher: Schema.String, message: Schema.String },
) {}

export class PublisherNotFound extends Schema.TaggedError<PublisherNotFound>()(
  "PublisherNotFound",
  { publisher: Schema.String, message: Schema.String },
) {}

export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()("AccountNotFound", {
  account: Schema.String,
  message: Schema.String,
}) {}

export class PackageNotFound extends Schema.TaggedError<PackageNotFound>()("PackageNotFound", {
  message: Schema.String,
}) {}

export class ReleaseNotFound extends Schema.TaggedError<ReleaseNotFound>()("ReleaseNotFound", {
  message: Schema.String,
}) {}

export class VersionExists extends Schema.TaggedError<VersionExists>()("VersionExists", {
  message: Schema.String,
}) {}

export class InvalidPackage extends Schema.TaggedError<InvalidPackage>()("InvalidPackage", {
  message: Schema.String,
  problems: Schema.Array(Schema.String),
}) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  message: Schema.String,
}) {}

export class RegistryUnavailable extends Schema.TaggedError<RegistryUnavailable>()(
  "RegistryUnavailable",
  { message: Schema.String },
) {}

export type RegistryError =
  | Unauthorized
  | NotAdmin
  | PublisherNotOwned
  | PublisherNotApproved
  | PublisherNameUnavailable
  | PublisherNotFound
  | AccountNotFound
  | PackageNotFound
  | ReleaseNotFound
  | VersionExists
  | InvalidPackage
  | InvalidRequest
  | RegistryUnavailable;

export const status = (error: RegistryError): number => {
  switch (error._tag) {
    case "Unauthorized":
      return 401;
    case "NotAdmin":
    case "PublisherNotOwned":
    case "PublisherNotApproved":
      return 403;
    case "PublisherNotFound":
    case "AccountNotFound":
    case "PackageNotFound":
    case "ReleaseNotFound":
      return 404;
    case "PublisherNameUnavailable":
    case "VersionExists":
      return 409;
    case "InvalidPackage":
      return 422;
    case "InvalidRequest":
      return 400;
    case "RegistryUnavailable":
      return 503;
  }
};
