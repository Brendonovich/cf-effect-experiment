import { createStore } from "solid-js";

export function createStateMachine<
  State extends object,
  Actions extends Record<string, (state: State, ...args: never[]) => void>,
>(initial: State, actions: Actions) {
  const [state, setState] = createStore<State>(initial as Exclude<State, Function>);
  const wrappedActions = {} as {
    [Key in keyof Actions]: Actions[Key] extends (state: State, ...args: infer Args) => void
      ? (...args: Args) => void
      : never;
  };

  for (const key in actions) {
    const action = actions[key]!;
    wrappedActions[key] = ((...args: never[]) => {
      setState((draft) => {
        action(draft, ...args);
      });
    }) as (typeof wrappedActions)[typeof key];
  }

  return [state, wrappedActions] as const;
}
