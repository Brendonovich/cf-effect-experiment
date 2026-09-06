import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import Discord from "@macrograph/module-discord";
import ElevenLabs from "@macrograph/module-elevenlabs";
import Filesystem from "@macrograph/module-fs";
import GoXLR from "@macrograph/module-goxlr";
import Json from "@macrograph/module-json";
import List from "@macrograph/module-list";
import Logic from "@macrograph/module-logic";
import Math from "@macrograph/module-math";
import OBS from "@macrograph/module-obs";
import OpenAI from "@macrograph/module-openai";
import Streamlabs from "@macrograph/module-streamlabs";
import Strings from "@macrograph/module-string";
import Twitch from "@macrograph/module-twitch";
import Utilities from "@macrograph/module-utilities";
import Voicemod from "@macrograph/module-voicemod";
import VTubeStudio from "@macrograph/module-vtube-studio";
import WebSocketServer from "@macrograph/module-websocket-server";
import { Effect } from "effect";

type PortName = readonly [
  schema: string,
  direction: "dataInputs" | "dataOutputs" | "executionInputs" | "executionOutputs",
  port: string,
  name: string | null,
];

// Labels from MacroGraph's packages/packages and base-packages catalogs.
// null means intentionally unnamed, not an invitation to display the port ID.
const check = (
  module: string,
  collect: Effect.Effect<ReadonlyArray<Registration.RegisteredSchema>>,
  expected: ReadonlyArray<PortName>,
) => it.effect(`${module} preserves the original IO names`, () =>
  Effect.gen(function* () {
    const schemas = yield* collect;
    for (const [id, direction, portId, name] of expected) {
      const schema = schemas.find((schema) => schema.id === id);
      assert.isDefined(schema, `${module}.${id}`);
      for (const io of [schema, schema.generateIO({})]) {
        const port = io[direction].find((port) => port.id === portId);
        assert.isDefined(port, `${module}.${id}.${direction}.${portId}`);
        assert.strictEqual(port.name ?? null, name, `${module}.${id}.${direction}.${portId}`);
      }
    }
  }),
);

describe("Original MacroGraph IO names", () => {
  check("Logic", Registration.collect(Logic.effect), [
    ["Branch", "executionInputs", "exec", null],
    ["Branch", "dataInputs", "condition", "Condition"],
    ["Branch", "executionOutputs", "true", "True"],
    ["Branch", "executionOutputs", "false", "False"],
    ["AND", "dataInputs", "one", null],
    ["AND", "dataOutputs", "value", null],
    ["Conditional", "dataInputs", "condition", "Condition"],
    ["Conditional", "dataInputs", "trueValue", "True"],
    ["Conditional", "dataInputs", "falseValue", "False"],
    ["Conditional", "dataOutputs", "output", null],
    ["Switch", "dataInputs", "switchOn", "Data In"],
    ["Switch", "dataOutputs", "switchOut", "Data Out"],
    ["Switch", "executionOutputs", "exec", "Default"],
    ["Switch", "executionOutputs", "key-0", null],
  ]);
  check("Utilities", Registration.collect(Utilities.effect), [
    ["Print", "dataInputs", "in", "Input"],
    ["ConcatStrings", "dataInputs", "str1", null],
    ["ConcatStrings", "dataInputs", "str2", null],
    ["ConcatStrings", "dataOutputs", "result", null],
    ["IntToString", "dataInputs", "int", null],
    ["IntToString", "dataOutputs", "str", null],
    ["FormatString", "dataOutputs", "result", null],
    ["FormatTime", "dataInputs", "timeIn", null],
    ["FormatTime", "dataOutputs", "timeOut", null],
    ["Tick", "dataOutputs", "tick", null],
  ]);
  check("String", Registration.collect(Strings.effect), [
    ["StringIncludes", "dataInputs", "input", "String"],
    ["StringIncludes", "dataInputs", "needle", "Includes"],
    ["StringIncludes", "dataOutputs", "bool", null],
    ["StringStartsWith", "dataInputs", "prefix", "Starts With"],
    ["StringReplaceAll", "dataInputs", "find", "Find"],
    ["StringReplaceFirst", "dataInputs", "replace", "Replace"],
    ["StringLength", "dataInputs", "input", "String"],
    ["Substring", "dataInputs", "input", null],
    ["Substring", "dataInputs", "start", "Start"],
    ["Substring", "dataInputs", "end", "End"],
    ["IntToStringBase", "dataInputs", "base", "Base"],
    ["StringToIntBase", "dataInputs", "base", "Base"],
    ["SplitString", "dataInputs", "separator", "Separator"],
    ["SplitLines", "dataInputs", "input", "String"],
    ["JoinLines", "dataInputs", "input", "Lines"],
    ["NthWord", "dataInputs", "index", "N"],
  ]);
  check("Math", Registration.collect(Math.effect), [
    ["AddInts", "dataInputs", "one", null],
    ["AddInts", "dataOutputs", "output", null],
    ["RemainderInt", "dataInputs", "input", "Number"],
    ["RemainderFloat", "dataInputs", "divisor", "Divisor"],
    ["RemainderFloat", "dataOutputs", "remainder", "Remainder"],
    ["CompareInt", "dataInputs", "compare", "Compare against"],
    ["ExponentFloats", "dataInputs", "one", "Number"],
    ["ExponentFloats", "dataInputs", "two", "Exponent"],
    ["DivideIntsExact", "dataInputs", "one", null],
    ["RandomFloatInRange", "dataInputs", "min", "Min"],
    ["RandomIntegerInRange", "dataInputs", "max", "Max"],
    ["DateNow", "dataOutputs", "out", "Time (ms)"],
    ["CurrentTimestamp", "dataOutputs", "out", "Timestamp"],
  ]);
  check("List", Registration.collect(List.effect), [
    ["ListCreate", "dataInputs", "value-0", null],
    ["ListCreate", "dataOutputs", "out", null],
    ["GetListValue", "dataOutputs", "return", "Value"],
    ["JoinStringList", "dataInputs", "separator", "Separator"],
    ["SliceList", "dataInputs", "start", "Start"],
    ["SliceList", "dataInputs", "end", "End"],
  ]);
  check("JSON", Registration.collect(Json.effect), [
    ["ParseJSON", "dataInputs", "in", null],
    ["ParseJSON", "dataOutputs", "out", null],
    ["ToJSON", "dataOutputs", "out", null],
    ["FromJSON", "dataInputs", "in", null],
    ["QueryJSON", "dataInputs", "in", null],
    ["QueryJSON", "dataOutputs", "out", null],
    ["JSONGetString", "dataInputs", "in", null],
    ["JSONGetNumber", "dataInputs", "in", null],
    ["JSONGetBoolean", "dataInputs", "in", null],
    ["JSONGetList", "dataInputs", "in", null],
    ["StringifyJSON", "dataInputs", "in", "Json"],
    ["StringifyJSON", "dataOutputs", "out", "String"],
  ]);
  check("Discord", Registration.collect(Discord.effect), [
    ["DiscordMessage", "dataOutputs", "message", "Message"],
    ["DiscordMessage", "dataOutputs", "rolesJson", "Roles"],
    ["DiscordSendMessage", "dataInputs", "channelId", "Channel ID"],
    ["DiscordGetUser", "dataOutputs", "username", "UserName"],
    ["DiscordGetGuildMember", "dataOutputs", "nick", "Nickname"],
    ["DiscordGetRole", "dataOutputs", "permissions", "Permissions"],
    ["DiscordSendWebhook", "dataInputs", "content", "Message"],
    ["DiscordSendWebhook", "dataOutputs", "status", "Status"],
  ]);
  check("Streamlabs", Registration.collect(Streamlabs.effect), [
    ["StreamlabsDonation", "dataOutputs", "formattedAmount", "Formatted Amount"],
    ["StreamlabsYoutubeMembership", "dataOutputs", "months", "Months"],
    ["StreamlabsYoutubeSuperchat", "dataOutputs", "displayString", "Display String"],
    ["StreamlabsYoutubeMembershipGiftee", "dataOutputs", "membershipGiftId", "Membership Gift ID"],
    ["StreamlabsYoutubeMembershipGifter", "dataOutputs", "giftMembershipsCount", "Membership Count"],
  ]);
  check("OBS", Registration.collect(OBS.effect), [
    ["RGBAHexToOBSColour", "dataInputs", "input", null],
    ["GetStats", "dataOutputs", "memoryUsage", "Memory Usage (MB)"],
    ["GetStats", "dataOutputs", "activeFps", "Current FPS"],
    ["GetSceneItemEnabled", "dataOutputs", "sceneItemEnabled", "Enabled"],
    ["SetInputName", "dataInputs", "inputName", "Current Name"],
    ["GetInputSettings", "dataOutputs", "inputSettings", "Settings (JSON)"],
    ["SetInputVolumeDb", "dataInputs", "inputVolumeDb", "Input Volume (dB)"],
    ["InputVolumeChanged", "dataOutputs", "inputVolumeDb", "Volume (dB)"],
    ["InputVolumeMeters", "dataOutputs", "inputs", "Inputs"],
  ]);
  check("Twitch", Registration.collect(Twitch.effect), [
    ["UnbanUser", "dataInputs", "userId", "userID"],
    ["CheckUserFollow", "dataOutputs", "following", "Following"],
    ["CheckUserFollow", "dataOutputs", "followedAt", "Followed At"],
    ["CheckUserVIP", "dataOutputs", "vip", "Vip"],
    ["StartCommercial", "dataInputs", "duration", "Duration (s)"],
    ["StartCommercial", "dataOutputs", "retryAfter", "Cooldown"],
    ["ModerationChatDelay", "dataInputs", "enabled", ""],
    ["UniqueChatMode", "dataInputs", "enabled", ""],
    ["ValidateToken", "dataOutputs", "expiresIn", "Token Expires in (s)"],
  ]);
  check("Filesystem", Registration.collect(Filesystem.effect), [
    ["ListFiles", "dataOutputs", "files", "Files"],
    ["ListFolders", "dataOutputs", "folders", "Folders"],
  ]);
  check("GoXLR", Registration.collect(GoXLR.effect), [
    ["SetReverbAmount", "dataInputs", "amount", "Amount (%)"],
    ["SetGenderAmount", "dataInputs", "amount", "(%)"],
  ]);
  check("ElevenLabs", Registration.collect(ElevenLabs.effect), [
    ["ElevenLabsTTS", "dataInputs", "modelId", "Model Id"],
    ["ElevenLabsTTS", "dataInputs", "body", "Body"],
  ]);
  check("OpenAI", Registration.collect(OpenAI.effect), [
    ["ChatGPTMessage", "dataInputs", "historyIn", "Chat History"],
  ]);
  check("Voicemod", Registration.collect(Voicemod.effect), [
    ["SetVoice", "dataInputs", "voice", "Voice"],
    ["SetVoiceChangerState", "dataInputs", "state", null],
    ["SetHearSelfState", "dataInputs", "state", null],
  ]);
  check("VTube Studio", Registration.collect(VTubeStudio.effect), [
    ["AvailableModels", "dataOutputs", "models", null],
    ["LoadModel", "dataInputs", "model", null],
    ["ExpressionState", "dataOutputs", "expressions", "Expressions"],
    ["ToggleExpression", "dataInputs", "file", "File URL"],
    ["GetHotkeyList", "dataOutputs", "hotkeys", null],
  ]);
  check("WebSocket Server", Registration.collect(WebSocketServer.effect), [
    ["SendToClient", "dataInputs", "message", "Data"],
    ["MessageReceived", "dataOutputs", "message", "Data"],
  ]);
});
