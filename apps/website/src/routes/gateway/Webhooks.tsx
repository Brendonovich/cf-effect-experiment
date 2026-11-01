import { Button, LoadingState } from "@macrograph/editor-ui";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";

import { gateway, type GatewayWebhook, gatewayKeys } from "../../gatewayApi";
import { showToast } from "../../Toasts";
import { CopyField, Section, styles, time } from "./shared";

const parseFilters = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((filter) => filter.trim())
    .filter((filter) => filter !== "");

/** URLs the gateway POSTs every event to, signed and retried. */
export function GatewayWebhooksRoute() {
  const queryClient = useQueryClient();
  const webhooks = createQuery(() => ({
    queryKey: gatewayKeys.webhooks,
    queryFn: gateway.webhooks,
  }));
  const [url, setUrl] = createSignal("");
  const [filters, setFilters] = createSignal("");
  const [created, setCreated] = createSignal<{ readonly url: string; readonly secret: string }>();

  const add = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.addWebhook,
    onSuccess: (webhook) => {
      setCreated({ url: webhook.url, secret: webhook.secret });
      setUrl("");
      setFilters("");
      void queryClient.invalidateQueries({ queryKey: gatewayKeys.webhooks });
    },
    onError: (error) => showToast({ tone: "error", content: error.message }),
  }));

  const remove = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.removeWebhook,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gatewayKeys.webhooks }),
    onError: () => showToast({ tone: "error", content: "Could not remove the webhook." }),
  }));

  return (
    <div sx={styles.page}>
      <Section
        title="Webhooks"
        description="Each event is POSTed as JSON and retried with backoff for about 8 hours if your endpoint fails."
      >
        <Show when={created()}>
          {(current) => (
            <div sx={styles.callout}>
              <CopyField
                label={`Signing secret for ${current().url}`}
                value={current().secret}
                description="Use it to verify the MacroGraph-Signature header. It won't be shown again."
              />
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  sx={styles.button}
                  onClick={() => setCreated(undefined)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </Show>
        <form
          sx={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate({ url: url().trim(), events: parseFilters(filters()) });
          }}
        >
          <input
            sx={styles.input}
            type="url"
            placeholder="https://example.com/macrograph"
            aria-label="Webhook URL"
            value={url()}
            onInput={(event) => {
              setUrl(event.currentTarget.value);
            }}
          />
          <input
            sx={styles.input}
            placeholder="Filter, e.g. twitch.* github.push (empty for all)"
            aria-label="Event filter"
            value={filters()}
            onInput={(event) => {
              setFilters(event.currentTarget.value);
            }}
          />
          <Button
            type="submit"
            size="sm"
            sx={styles.button}
            disabled={add.isPending || url().trim() === ""}
          >
            {add.isPending ? "Adding..." : "Add webhook"}
          </Button>
        </form>
        <Show
          when={!webhooks.isPending}
          fallback={<LoadingState label="Loading webhooks" style={styles.loading} />}
        >
          <div sx={styles.list}>
            <For
              each={webhooks.data?.webhooks ?? []}
              fallback={<p sx={styles.empty}>No webhooks yet.</p>}
            >
              {(webhook) => (
                <Webhook
                  webhook={webhook}
                  removing={remove.isPending && remove.variables === webhook.id}
                  onRemove={() => {
                    if (window.confirm(`Stop sending events to ${webhook.url}?`))
                      remove.mutate(webhook.id);
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </Section>

      <Section title="Verifying deliveries">
        <pre sx={styles.code}>
          {`MacroGraph-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
MacroGraph-Event-Id: <event id, for deduplication>
MacroGraph-Event-Type: <source>.<type>, e.g. twitch.channel.chat.message

// Node.js
const [t, v1] = header.split(",").map((part) => part.split("=")[1]);
const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
  && Math.abs(Date.now() / 1000 - Number(t)) < 300;`}
        </pre>
      </Section>
    </div>
  );
}

function Webhook(props: {
  readonly webhook: GatewayWebhook;
  readonly removing: boolean;
  readonly onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const deliveries = createQuery(() => ({
    queryKey: gatewayKeys.deliveries(props.webhook.id),
    queryFn: () => gateway.deliveries(props.webhook.id),
    enabled: open(),
    refetchInterval: 10_000,
  }));
  return (
    <div sx={styles.card} data-webhook={props.webhook.id}>
      <div sx={styles.form}>
        <div sx={styles.body}>
          <p sx={styles.name}>{props.webhook.url}</p>
          <p sx={styles.detail}>
            {props.webhook.events.length === 0 ? "All events" : props.webhook.events.join(", ")} ·
            Added {time.format(new Date(props.webhook.createdAt))}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          sx={styles.button}
          onClick={() => setOpen(!open())}
        >
          {open() ? "Hide deliveries" : "Deliveries"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          sx={styles.button}
          disabled={props.removing}
          onClick={() => props.onRemove()}
        >
          Remove
        </Button>
      </div>
      <Show when={open()}>
        <For
          each={deliveries.data?.deliveries ?? []}
          fallback={<p sx={styles.muted}>No deliveries yet.</p>}
        >
          {(delivery) => (
            <div sx={styles.form}>
              <span
                sx={[
                  styles.badge,
                  delivery.status === "delivered" && styles.badgeGood,
                  delivery.status === "pending" && styles.badgeWarn,
                  delivery.status === "failed" && styles.badgeBad,
                ]}
              >
                {delivery.status}
              </span>
              <span sx={styles.muted}>
                Event #{delivery.eventSeq} · {delivery.attempts} attempt
                {delivery.attempts === 1 ? "" : "s"}
                {delivery.lastError === null ? "" : ` · ${delivery.lastError}`} ·{" "}
                {time.format(new Date(delivery.updatedAt))}
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
