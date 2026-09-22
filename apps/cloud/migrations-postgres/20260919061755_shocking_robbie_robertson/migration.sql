CREATE TABLE "session" (
	"id" varchar(255) PRIMARY KEY,
	"user_id" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(255) PRIMARY KEY,
	"email" varchar(255) NOT NULL UNIQUE,
	"hashed_password" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_code_sessions" (
	"app_id" varchar(255) NOT NULL,
	"code" varchar(10) NOT NULL,
	"device_code" varchar(255) PRIMARY KEY,
	"user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_apps" (
	"pk" serial PRIMARY KEY,
	"id" varchar(255) NOT NULL,
	"type" varchar,
	"owner_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_credential" (
	"provider_id" varchar(255),
	"user_id" varchar(255),
	"provider_user_id" varchar(255),
	"token" json NOT NULL,
	"token_created_at" timestamp NOT NULL,
	"display_name" varchar(255),
	CONSTRAINT "oauth_credential_pkey" PRIMARY KEY("provider_id","user_id","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"id" serial PRIMARY KEY,
	"app_id" varchar(255) NOT NULL,
	"access_token" varchar(255) NOT NULL UNIQUE,
	"refresh_token" varchar(255) NOT NULL UNIQUE,
	"expires" timestamp NOT NULL,
	"user_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_registration_sessions" (
	"id" varchar(255) PRIMARY KEY,
	"userCode" varchar(10) NOT NULL UNIQUE,
	"user_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
