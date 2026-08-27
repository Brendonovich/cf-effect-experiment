// Keep the daemon's actual u64::MAX decimal literal instead of JSON.stringify's rounded value.
export const broadcastPatch = `{
  "id": 18446744073709551615,
  "data": { "Patch": [
    { "op": "remove", "path": "/mixers/serial" },
    { "op": "replace", "path": "/mixers/other/levels/volumes/Game", "value": 18446744073709551615 },
    { "op": "replace", "path": "/mixers/other/effects/current/pitch/amount", "value": 1e300 },
    { "op": "replace", "path": "/mixers/other/effects/current/reverb/decay", "value": 30 },
    { "op": "replace", "path": "/mixers/other/effects/presets/reverb/amount", "value": 40 },
    { "op": "replace", "path": "/mixers/other/levels/volumes/Music", "value": 12.6 },
    { "op": "replace", "path": "/mixers/other/button_down/Fader1Mute", "value": true },
    { "op": "replace", "path": "/mixers/other/effects/current/reverb/amount", "value": 21.6 },
    { "op": "replace", "path": "/mixers/other/fader_status/A/mute_state", "value": "MutedToX" }
  ] }
}`;
