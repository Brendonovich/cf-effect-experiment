/**
 * Replaces `@julusian/midi/load-native.js` in the packaged server entry: the host loads the
 * addon from the package's `native/midi/<target>.node` instead of `pkg-prebuilds` searching
 * `node_modules`.
 */
export default () => require("macrograph:native/midi");
