import {
  ConnectionId,
  GraphId,
  IoId,
  NodeId,
  PackageId,
  ResourceConstant,
  SchemaId,
  type Graph,
  type Node,
  type Package,
  type Project,
  type RenderedGraph,
} from "@macrograph/core";

export const noop = () => {};
export const noSuggestions = async (): Promise<ReadonlyArray<string>> => [];

export const twitchPackageId = PackageId.make("twitch");
export const utilityPackageId = PackageId.make("utilities");
export const obsPackageId = PackageId.make("obs");

export const chatMessageSchema: Package.SchemaModel = {
  id: SchemaId.make("chat-message"),
  name: "Chat Message",
  description: "Runs whenever a viewer sends a message in the selected channel.",
  type: "event",
  properties: [
    {
      id: "channel",
      name: "Channel",
      description: "Twitch channel to listen to.",
      resource: "channel",
      optional: false,
    },
  ],
  dataInputs: [],
  dataOutputs: [
    { id: IoId.make("username"), name: "Username", type: { _tag: "String" } },
    { id: IoId.make("message"), name: "Message", type: { _tag: "String" } },
    { id: IoId.make("subscriber"), name: "Subscriber", type: { _tag: "Bool" } },
  ],
  executionInputs: [],
  executionOutputs: [{ id: IoId.make("triggered"), name: "Triggered" }],
};

export const containsSchema: Package.SchemaModel = {
  id: SchemaId.make("contains"),
  name: "Contains Text",
  description: "Checks whether a message contains the specified search text.",
  type: "pure",
  properties: [
    {
      id: "case-sensitive",
      name: "Case sensitive",
      description: "Match uppercase and lowercase characters exactly.",
      type: { _tag: "Bool" },
      optional: false,
      defaultValue: false,
    },
  ],
  dataInputs: [
    { id: IoId.make("text"), name: "Text", type: { _tag: "String" } },
    {
      id: IoId.make("search"),
      name: "Search",
      type: { _tag: "String" },
      defaultValue: "!scene",
    },
  ],
  dataOutputs: [{ id: IoId.make("matches"), name: "Matches", type: { _tag: "Bool" } }],
  executionInputs: [],
  executionOutputs: [],
};

export const branchSchema: Package.SchemaModel = {
  id: SchemaId.make("branch"),
  name: "Branch",
  description: "Routes execution based on whether the condition is true or false.",
  type: "exec",
  properties: [],
  dataInputs: [{ id: IoId.make("condition"), name: "Condition", type: { _tag: "Bool" } }],
  dataOutputs: [],
  executionInputs: [{ id: IoId.make("exec"), name: "Execute" }],
  executionOutputs: [
    { id: IoId.make("true"), name: "True" },
    { id: IoId.make("false"), name: "False" },
  ],
};

export const switchSceneSchema: Package.SchemaModel = {
  id: SchemaId.make("switch-scene"),
  name: "Switch Scene",
  description: "Changes the active scene in OBS Studio.",
  type: "exec",
  properties: [
    {
      id: "connection",
      name: "OBS connection",
      description: "OBS Studio instance used for this action.",
      resource: "connection",
      optional: false,
    },
    {
      id: "transition-ms",
      name: "Transition duration",
      description: "Duration of the scene transition in milliseconds.",
      type: { _tag: "Int" },
      optional: true,
      defaultValue: 300,
    },
  ],
  dataInputs: [
    {
      id: IoId.make("scene"),
      name: "Scene",
      type: { _tag: "String" },
      defaultValue: "Just Chatting",
      suggestions: true,
    },
  ],
  dataOutputs: [],
  executionInputs: [{ id: IoId.make("exec"), name: "Execute" }],
  executionOutputs: [{ id: IoId.make("done"), name: "Done" }],
};

export const twitchPackage: Package.Model = {
  id: twitchPackageId,
  name: "Twitch",
  schemas: [chatMessageSchema],
  resources: [{ id: "channel", name: "Channel", description: "An authenticated Twitch channel." }],
};

export const utilityPackage: Package.Model = {
  id: utilityPackageId,
  name: "Utilities",
  schemas: [containsSchema, branchSchema],
  resources: [],
};

export const obsPackage: Package.Model = {
  id: obsPackageId,
  name: "OBS Studio",
  schemas: [switchSceneSchema],
  resources: [
    {
      id: "connection",
      name: "OBS connection",
      description: "A connected OBS Studio instance.",
    },
  ],
};

export const packages: ReadonlyArray<Package.Model> = [twitchPackage, utilityPackage, obsPackage];

const renderedNode = (
  id: string,
  name: string,
  packageId: PackageId,
  schema: Package.SchemaModel,
  position: { readonly x: number; readonly y: number },
  options: Pick<Node.Model, "properties" | "inputDefaults" | "foldPins"> = {
    properties: {},
    inputDefaults: {},
    foldPins: false,
  },
): RenderedGraph.Node => ({
  id: NodeId.make(id),
  name,
  schema: { package: packageId, schema: schema.id },
  position,
  ...options,
  io: {
    dataInputs: schema.dataInputs,
    dataOutputs: schema.dataOutputs,
    executionInputs: schema.executionInputs,
    executionOutputs: schema.executionOutputs,
  },
});

export const chatMessageNode = renderedNode(
  "chat-message-node",
  "Chat Message",
  twitchPackageId,
  chatMessageSchema,
  { x: 80, y: 120 },
  {
    properties: { channel: "main-channel" },
    inputDefaults: {},
    foldPins: false,
  },
);

export const containsNode = renderedNode(
  "contains-node",
  "Contains Text",
  utilityPackageId,
  containsSchema,
  { x: 380, y: 310 },
  {
    properties: { "case-sensitive": false },
    inputDefaults: { search: "!scene" },
    foldPins: false,
  },
);

export const branchNode = renderedNode("branch-node", "Branch", utilityPackageId, branchSchema, {
  x: 420,
  y: 110,
});

export const switchSceneNode = renderedNode(
  "switch-scene-node",
  "Switch Scene",
  obsPackageId,
  switchSceneSchema,
  { x: 760, y: 105 },
  {
    properties: { connection: "main-obs", "transition-ms": 450 },
    inputDefaults: { scene: "Just Chatting" },
    foldPins: false,
  },
);

export const renderedGraph: RenderedGraph.Model = {
  id: GraphId.make("stream-automation"),
  name: "Stream Automation",
  nodes: {
    [chatMessageNode.id]: chatMessageNode,
    [containsNode.id]: containsNode,
    [branchNode.id]: branchNode,
    [switchSceneNode.id]: switchSceneNode,
  },
  connections: [
    {
      id: ConnectionId.make("event-to-branch"),
      outNodeId: chatMessageNode.id,
      outIoId: IoId.make("triggered"),
      inNodeId: branchNode.id,
      inIoId: IoId.make("exec"),
    },
    {
      id: ConnectionId.make("message-to-contains"),
      outNodeId: chatMessageNode.id,
      outIoId: IoId.make("message"),
      inNodeId: containsNode.id,
      inIoId: IoId.make("text"),
    },
    {
      id: ConnectionId.make("matches-to-branch"),
      outNodeId: containsNode.id,
      outIoId: IoId.make("matches"),
      inNodeId: branchNode.id,
      inIoId: IoId.make("condition"),
    },
    {
      id: ConnectionId.make("branch-to-scene"),
      outNodeId: branchNode.id,
      outIoId: IoId.make("true"),
      inNodeId: switchSceneNode.id,
      inIoId: IoId.make("exec"),
    },
  ],
  schemas: {
    [twitchPackageId]: { [chatMessageSchema.id]: chatMessageSchema },
    [utilityPackageId]: {
      [containsSchema.id]: containsSchema,
      [branchSchema.id]: branchSchema,
    },
    [obsPackageId]: { [switchSceneSchema.id]: switchSceneSchema },
  },
};

export const graph: Graph.Model = {
  id: renderedGraph.id,
  name: renderedGraph.name,
  nodes: renderedGraph.nodes,
  connections: renderedGraph.connections,
};

export const secondaryGraph: Graph.Model = {
  id: GraphId.make("moderation"),
  name: "Chat Moderation",
  nodes: {},
  connections: [],
};

export const constants: Project.Model["constants"] = {
  "main-channel": {
    id: ResourceConstant.Id.make("main-channel"),
    name: "Main Twitch channel",
    isDefault: true,
    resource: { package: twitchPackageId, resource: "channel" },
    value: "macrograph",
  },
  "main-obs": {
    id: ResourceConstant.Id.make("main-obs"),
    name: "Streaming PC",
    isDefault: true,
    resource: { package: obsPackageId, resource: "connection" },
    value: "studio-pc",
  },
  "backup-obs": {
    id: ResourceConstant.Id.make("backup-obs"),
    name: "Backup PC",
    resource: { package: obsPackageId, resource: "connection" },
    value: "streaming-laptop",
  },
};

export const resourceValues = (
  resource: ResourceConstant.ResourceRef,
): ReadonlyArray<ResourceConstant.LiveValue> =>
  resource.package === twitchPackageId
    ? [
        { id: "macrograph", display: "macrograph" },
        { id: "macrograph_dev", display: "macrograph_dev" },
      ]
    : [
        { id: "studio-pc", display: "Studio PC" },
        { id: "streaming-laptop", display: "Streaming Laptop" },
      ];
