import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import {
	For,
	Show,
	action,
	affects,
	createOptimistic,
	createSignal,
	isPending,
	untrack,
	type Component,
} from "solid-js";

import {
	ClientRpcs,
	ClientState,
	SUBSCRIPTION_TYPES,
	type AccountId,
} from "./Definition.ts";
import TwitchPlugin from "./Plugin.ts";

const styles = stylex.create({
	root: { color: colors.gray12 },
	empty: {
		borderBottom: `1px solid ${colors.gray6}`,
		borderTop: `1px solid ${colors.gray6}`,
		color: colors.gray10,
		fontSize: 12,
		paddingBlock: 16,
		textAlign: "center",
	},
	account: {
		alignItems: "center",
		borderBottomColor: { default: colors.gray5, ":last-child": "transparent" },
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		columnGap: 8,
		display: "grid",
		gridTemplateColumns: ".75rem minmax(0, 1fr) auto",
		paddingBottom: 8,
		paddingTop: { default: 8, ":first-child": 0 },
		rowGap: 2,
	},
	focus: {
		boxShadow: {
			default: null,
			":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
		},
		outline: "none",
	},
	accountButton: {
		alignItems: "center",
		backgroundColor: "transparent",
		border: 0,
		borderRadius: 4,
		columnGap: 8,
		display: "grid",
		gridColumn: "1 / span 2",
		gridRowStart: 1,
		gridTemplateColumns: ".75rem minmax(0, 1fr)",
		textAlign: "left",
	},
	chevronBox: {
		backgroundColor: { default: "transparent", ":hover": colors.gray3 },
		borderRadius: 4,
		padding: 2,
		transitionProperty: "background-color",
	},
	chevron: { height: 10, transitionProperty: "transform", width: 10 },
	collapsed: { transform: "rotate(-90deg)" },
	accountName: {
		fontSize: 12,
		fontWeight: 500,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	stateDot: {
		alignSelf: "center",
		borderRadius: "50%",
		gridColumnStart: 1,
		gridRowStart: 2,
		height: 6,
		justifySelf: "center",
		width: 6,
	},
	stateLabel: {
		color: colors.gray10,
		fontSize: 11,
		gridColumnStart: 2,
		gridRowStart: 2,
	},
	connect: {
		backgroundColor: { default: colors.gray3, ":hover": colors.gray4 },
		border: `1px solid ${colors.gray6}`,
		borderRadius: 2,
		color: colors.gray12,
		fontSize: 12,
		gridColumnStart: 3,
		gridRow: "1 / span 2",
		opacity: { default: 1, ":disabled": 0.5 },
		padding: "4px 8px",
		transitionProperty: "background-color",
	},
	subscriptions: { gridColumn: "2 / span 2", gridRowStart: 3, marginTop: 6 },
	subscription: {
		alignItems: "center",
		borderRadius: 2,
		display: "flex",
		gap: 16,
		justifyContent: "space-between",
		padding: "6px 8px",
	},
	subscriptionName: { color: colors.gray12, display: "block", fontSize: 12 },
	subscriptionId: {
		color: colors.gray10,
		display: "block",
		fontSize: 10,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	switch: {
		border: 0,
		borderRadius: 9999,
		flexShrink: 0,
		height: 16,
		opacity: { default: 1, ":disabled": 0.7 },
		position: "relative",
		transitionProperty: "background-color",
		width: 28,
	},
	thumb: {
		backgroundColor: "white",
		borderRadius: "50%",
		height: 12,
		left: 2,
		position: "absolute",
		top: 2,
		transition: "transform 200ms ease-in-out",
		width: 12,
	},
	invalid: { color: colors.red10, fontSize: 12 },
});

const subscriptionName = (subscription: string) =>
	subscription
		.replace(/^channel\./, "")
		.split(/[._]/)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");

export interface SettingsProps {
	readonly state: () => typeof ClientState.Type;
	readonly rpc: {
		readonly ConnectEventSub: (payload: {
			readonly accountId: AccountId;
		}) => Effect.Effect<void, unknown>;
		readonly DisconnectEventSub: (payload: {
			readonly accountId: AccountId;
		}) => Effect.Effect<void, unknown>;
		readonly ToggleEventSubSubscription: (payload: {
			readonly accountId: AccountId;
			readonly subscriptionType: string;
			readonly enabled: boolean;
		}) => Effect.Effect<void, unknown>;
	};
	readonly onChanged: () => Promise<void>;
}

type Account = (typeof ClientState.Type)["accounts"][number];
type SocketState = Account["eventSubSocket"]["state"];

const socketStateLabel = (state: SocketState) =>
	state === "connected"
		? "Connected"
		: state === "connecting"
			? "Connecting"
			: "Disconnected";

const Settings: Component<SettingsProps> = (props) => {
	const [collapsedAccounts, setCollapsedAccounts] = createSignal<
		ReadonlyArray<AccountId>
	>(untrack(() => props.state().accounts.map((account) => account.id)));

	const run = action(async function* (
		effect: Effect.Effect<void, unknown>,
		optimistic?: () => void,
	) {
		optimistic?.();
		yield;
		const success = await Effect.runPromise(effect).then(
			() => true,
			() => false,
		);
		yield;
		if (!success) return;
		yield props.onChanged();
	});

	const isCollapsed = (accountId: AccountId) =>
		collapsedAccounts().includes(accountId);
	const toggleCollapsed = (accountId: AccountId) =>
		setCollapsedAccounts((accounts) =>
			accounts.includes(accountId)
				? accounts.filter((id) => id !== accountId)
				: [...accounts, accountId],
		);
	const toggleSubscription = (
		account: Account,
		subscription: string,
		enabled: boolean,
		optimistic: () => void,
	) =>
		run(
			props.rpc.ToggleEventSubSubscription({
				accountId: account.id,
				subscriptionType: subscription,
				enabled,
			}),
			optimistic,
		);
	const toggleConnection = (
		account: Account,
		connected: boolean,
		optimistic: () => void,
	) =>
		void run(
			connected
				? props.rpc.DisconnectEventSub({ accountId: account.id })
				: props.rpc.ConnectEventSub({ accountId: account.id }),
			optimistic,
		);

	return (
		<section sx={styles.root}>
			<div>
				<For
					each={props.state().accounts}
					keyed={(account) => account.id}
					fallback={
						<div sx={styles.empty}>
							No Twitch credentials are available to this editor host.
						</div>
					}
				>
					{(account) => {
						const [state, setState] = createOptimistic(
							() => account().eventSubSocket.state,
						);
						const [enabled, setEnabled] = createOptimistic(
							() => account().enabledSubscriptions,
						);
						return (
							<section sx={styles.account}>
								<button
									type="button"
									sx={[styles.focus, styles.accountButton]}
									onClick={() => toggleCollapsed(account().id)}
									aria-expanded={isCollapsed(account().id) ? "false" : "true"}
								>
									<span sx={styles.chevronBox}>
										<svg
											viewBox="0 0 16 16"
											sx={styles.chevron}
											style={{
												transform: isCollapsed(account().id)
													? "rotate(-90deg)"
													: undefined,
											}}
											aria-hidden="true"
										>
											<path
												d="m3 6 5 5 5-5"
												fill="none"
												stroke="currentColor"
												stroke-width="1.75"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
									</span>
									<h3 sx={styles.accountName}>
										{account().displayName}
									</h3>
								</button>
								<span
									sx={styles.stateDot}
									style={{
										"background-color":
											state() === "connecting"
												? "#eab308"
												: state() === "connected"
													? "#22c55e"
													: "#ef4444",
									}}
								/>
								<div sx={styles.stateLabel}>
									EventSub {socketStateLabel(state())}
								</div>
								<button
									type="button"
									sx={[styles.focus, styles.connect]}
									disabled={
										state() === "connecting" ||
										isPending(state) ||
										(props.state().transport === "webhook" &&
											state() !== "connected" &&
											enabled().length === 0)
									}
									aria-busy={
										state() === "connecting" || isPending(state)
											? "true"
											: undefined
									}
									onClick={() => {
										const connected = state() === "connected";
										toggleConnection(account(), connected, () => {
											setState(connected ? "disconnected" : "connecting");
											affects(state);
											affects(account);
										});
									}}
								>
									{state() === "connected" ? "Disconnect" : "Connect"}
								</button>
								<Show when={!isCollapsed(account().id)}>
									<div sx={styles.subscriptions}>
										<For each={SUBSCRIPTION_TYPES}>
											{(subscription) => {
												const [isEnabled, setIsEnabled] = createOptimistic(() =>
													account().enabledSubscriptions.includes(subscription),
												);
												const [pending, setPending] = createSignal(false);
												return (
													<div sx={styles.subscription}>
														<span style={{ "min-width": "0" }}>
															<span sx={styles.subscriptionName}>
																{subscriptionName(subscription)}
															</span>
															<span sx={styles.subscriptionId}>
																{subscription}
															</span>
														</span>
												<button
													type="button"
													role="switch"
													aria-checked={isEnabled() ? "true" : "false"}
													aria-busy={pending() ? "true" : undefined}
													aria-label={subscriptionName(subscription)}
													disabled={pending()}
													sx={[styles.focus, styles.switch]}
													style={{
														"background-color": isEnabled()
															? "#16a34a"
															: "var(--gray-5)",
													}}
													onClick={() => {
														const nextEnabled = !isEnabled();
														setPending(true);
														void toggleSubscription(
															account(),
															subscription,
																nextEnabled,
																() => {
																	setIsEnabled(nextEnabled);
																	setEnabled((current) =>
																	nextEnabled
																		? [...current, subscription]
																		: current.filter((value) => value !== subscription),
																	);
																	affects(isEnabled);
																	affects(enabled);
															},
														).finally(() => setPending(false));
													}}
												>
													<span
														sx={styles.thumb}
														style={{
															transform: isEnabled()
																? "translateX(12px)"
																: "translateX(0)",
														}}
													/>
														</button>
													</div>
												);
											}}
										</For>
									</div>
								</Show>
							</section>
						);
					}}
				</For>
			</div>
		</section>
	);
};

export default Settings;

export const settings = ClientSettings.make({
	plugin: TwitchPlugin,
	state: ClientState,
	initial: { transport: "webhook", accounts: [] },
	rpcs: ClientRpcs,
	render: (state, context) => (
		<Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
	),
	renderInvalid: () => (
		<p sx={styles.invalid}>
			Plugin settings state is unavailable.
		</p>
	),
});
