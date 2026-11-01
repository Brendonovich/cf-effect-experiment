import type { Provider } from "./Provider.ts";
import type { Tool } from "./Tool.ts";

import * as GitHub from "./providers/GitHub.ts";
import * as Twitch from "./providers/Twitch.ts";

export const providers: ReadonlyArray<Provider> = [Twitch.provider, GitHub.provider];

export const tools: ReadonlyArray<Tool> = [...Twitch.tools, ...GitHub.tools];

const providersById = new Map(providers.map((provider) => [provider.id, provider]));
const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

export const provider = (id: string) => providersById.get(id);
export const tool = (name: string) => toolsByName.get(name);
