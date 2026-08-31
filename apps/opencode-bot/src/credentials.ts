import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const variable = "OPENCODE_CREDENTIALS";
const server = "https://opencode.ai/console";

class CredentialError extends Error {}

export interface Credential {
  access: string;
  refresh: string;
  expires: number;
}

export function encrypt(value: Credential, key: string, repository: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), nonce);
  cipher.setAAD(Buffer.from(`${repository}:${variable}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(value: string, key: string, repository: string): Credential {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length <= 28 || bytes.toString("base64") !== value)
    throw new Error("Invalid credential envelope");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    bytes.subarray(0, 12),
    { authTagLength: 16 },
  );
  cipher.setAAD(Buffer.from(`${repository}:${variable}`));
  cipher.setAuthTag(bytes.subarray(12, 28));
  const parsed: unknown = JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
  );
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("access" in parsed) ||
    typeof parsed.access !== "string" ||
    !parsed.access ||
    !("refresh" in parsed) ||
    typeof parsed.refresh !== "string" ||
    !parsed.refresh ||
    !("expires" in parsed) ||
    typeof parsed.expires !== "number" ||
    !Number.isFinite(parsed.expires)
  ) {
    throw new Error("Invalid stored credential");
  }
  return { access: parsed.access, refresh: parsed.refresh, expires: parsed.expires };
}

function gh(args: string[], input?: string) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  if (result.status !== 0) {
    const status = result.stderr.match(/HTTP (\d{3})/)?.[1];
    throw new CredentialError(
      `GitHub ${args[0]} ${args[1]} failed${status ? ` (HTTP ${status})` : ""}; check PAT permissions and expiry`,
    );
  }
  return result.stdout.trim();
}

async function token(body: Record<string, string>) {
  const response = await fetch(`${server}/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: "opencode-cli", ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (
      data &&
      typeof data === "object" &&
      "error" in data &&
      (data.error === "authorization_pending" || data.error === "slow_down")
    )
      return data.error;
    throw new CredentialError(
      `Console token request failed (HTTP ${response.status}); enroll again if authorization was revoked`,
    );
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("access_token" in data) ||
    typeof data.access_token !== "string" ||
    !data.access_token ||
    !("refresh_token" in data) ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token ||
    !("expires_in" in data) ||
    typeof data.expires_in !== "number" ||
    data.expires_in <= 60
  ) {
    throw new Error("Invalid Console token response");
  }
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000,
  };
}

export async function main(mode: string | undefined) {
  const repository =
    process.env.GITHUB_REPOSITORY ??
    gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  let key = process.env.OPENCODE_CREDENTIAL_KEY;
  const save = async (credential: Credential) => {
    if (!key) throw new Error("Missing credential encryption key");
    const blob = encrypt(credential, key, repository);
    for (let attempt = 0; ; attempt++) {
      try {
        gh(["variable", "set", variable, "--repo", repository], blob);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  };

  if (mode === "enroll") {
    if (!key) {
      const secrets: Array<{ name: string }> = JSON.parse(
        gh(["secret", "list", "--repo", repository, "--json", "name"]),
      );
      if (secrets.some((secret) => secret.name === "OPENCODE_CREDENTIAL_KEY")) {
        throw new CredentialError(
          "Encryption key already exists. Use the enrollment workflow to preserve it.",
        );
      }
      key = randomBytes(32).toString("base64");
      gh(["secret", "set", "OPENCODE_CREDENTIAL_KEY", "--repo", repository], key);
    }
    const response = await fetch(`${server}/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "opencode-cli" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Console device login failed");
    const device: unknown = await response.json();
    if (
      !device ||
      typeof device !== "object" ||
      !("device_code" in device) ||
      typeof device.device_code !== "string" ||
      !("verification_uri_complete" in device) ||
      typeof device.verification_uri_complete !== "string" ||
      !("user_code" in device) ||
      typeof device.user_code !== "string" ||
      !("interval" in device) ||
      typeof device.interval !== "number" ||
      device.interval <= 0 ||
      !("expires_in" in device) ||
      typeof device.expires_in !== "number" ||
      device.expires_in <= 0
    ) {
      throw new Error("Invalid Console device response");
    }
    const url = new URL(device.verification_uri_complete, `${server}/`);
    if (url.protocol !== "https:") throw new Error("Invalid Console verification URL");
    console.log(`Authorize the bot: ${url.href}\nDevice code: ${device.user_code}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Authorize the bot: ${url.href}\n\nDevice code: ${device.user_code}\n`,
      );
    }
    let interval = device.interval * 1000;
    const expires = Date.now() + device.expires_in * 1000;
    while (Date.now() < expires) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      const result = await token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
      });
      if (result === "slow_down") interval += 5000;
      else if (result !== "authorization_pending") {
        await save(result);
        console.log("Console credentials encrypted and stored in the repository variable.");
        return;
      }
    }
    throw new Error("Device authorization expired");
  }

  if (mode !== "refresh" || !key || !process.env.GITHUB_ENV)
    throw new Error("Invalid mode or missing CI configuration");
  // Fetch inside the concurrency lock; vars context can be stale when a job was queued.
  const blob = gh([
    "variable",
    "get",
    variable,
    "--repo",
    repository,
    "--json",
    "value",
    "--jq",
    ".value",
  ]);
  let credential: Credential;
  try {
    credential = decrypt(blob, key, repository);
  } catch {
    throw new CredentialError(
      "Stored credentials could not be decrypted; check the encryption secret or reenroll",
    );
  }
  // Refresh before every job to maximize its usable lifetime, then persist before starting the agent.
  const refreshed = await token({ grant_type: "refresh_token", refresh_token: credential.refresh });
  if (typeof refreshed === "string") throw new Error("Unexpected refresh response");
  credential = refreshed;
  await save(credential);
  const escape = (value: string) =>
    value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.log(`::add-mask::${escape(credential.access)}`);
  if (/[\r\n]/.test(credential.access)) throw new Error("Invalid access token");
  appendFileSync(
    process.env.GITHUB_ENV,
    `OPENCODE_API_KEY=${credential.access}\nOPENCODE_TOKEN_EXPIRES=${credential.expires}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error: unknown) => {
    console.error(
      error instanceof CredentialError
        ? error.message
        : "Credential setup failed. Check GitHub permissions and Console enrollment.",
    );
    process.exitCode = 1;
  });
}
