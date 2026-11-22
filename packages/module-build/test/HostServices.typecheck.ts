import type { Engine } from "@macrograph/module";
import type { Crypto, FileSystem, Layer, Path } from "effect";
import type { HttpClient } from "effect/http";
import type { Socket } from "effect/socket";

/**
 * Section 10: a built-in's standalone deployment may only require the host services
 * (`http-client`, `file-system`, `socket`, `crypto`, `credentials`) plus its own engine context.
 */
type HostServices =
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Path.Path
  | Socket.WebSocketConstructor
  | Crypto.Crypto
  | Engine.Credentials;

type EngineContext = { readonly key: `macrograph/Module/EngineContext/${string}` };

type Unprovided<Deployment> = Deployment extends {
  readonly layer: Layer.Layer<infer _A, infer _E, infer R>;
}
  ? Exclude<R, HostServices | EngineContext>
  : never;

const check = <Deployment extends { readonly layer: Layer.Any }>(
  deployment: Deployment &
    ([Unprovided<Deployment>] extends [never]
      ? unknown
      : { readonly unprovidedServices: Unprovided<Deployment> }),
) => deployment;

import discord from "@macrograph/module-discord/Deployment";
import elevenlabs from "@macrograph/module-elevenlabs/Deployment";
import elgatoKeyLight from "@macrograph/module-elgato-key-light/Deployment";
import fs from "@macrograph/module-fs/Deployment";
import github from "@macrograph/module-github/Deployment";
import goxlr from "@macrograph/module-goxlr/Deployment";
import httpClient from "@macrograph/module-http-client/Deployment/Local";
import ikeaTradfri from "@macrograph/module-ikea-tradfri/Deployment";
import kofi from "@macrograph/module-kofi/Deployment/Webhook";
import lifx from "@macrograph/module-lifx/Deployment";
import midi from "@macrograph/module-midi/Deployment";
import obs from "@macrograph/module-obs/Deployment/WebSocket";
import openai from "@macrograph/module-openai/Deployment";
import opencode from "@macrograph/module-opencode/Deployment/Server";
import sendblue from "@macrograph/module-sendblue/Deployment";
import shell from "@macrograph/module-shell/Deployment";
import speakerbot from "@macrograph/module-speakerbot/Deployment";
import streamdeck from "@macrograph/module-streamdeck/Deployment";
import streamlabs from "@macrograph/module-streamlabs/Deployment";
import tiktokEulerStream from "@macrograph/module-tiktok-euler-stream/Deployment";
import twitch from "@macrograph/module-twitch/Deployment/WebSocket";
import utilities from "@macrograph/module-utilities/Deployment";
import voicemod from "@macrograph/module-voicemod/Deployment";
import vtubeStudio from "@macrograph/module-vtube-studio/Deployment";
import websocketClient from "@macrograph/module-websocket-client/Deployment/Local";
import websocketServer from "@macrograph/module-websocket-server/Deployment/Local";

check(discord);
check(elevenlabs);
check(elgatoKeyLight);
check(fs);
check(github);
check(goxlr);
check(httpClient);
check(ikeaTradfri);
check(kofi);
check(lifx);
check(midi);
check(obs);
check(openai);
check(opencode);
check(sendblue);
check(shell);
check(speakerbot);
check(streamdeck);
check(streamlabs);
check(tiktokEulerStream);
check(twitch);
check(utilities);
check(voicemod);
check(vtubeStudio);
check(websocketClient);
check(websocketServer);
