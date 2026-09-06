// Recorded white-spectrum bulb from AlCalzone/node-tradfri-client's
// src/lib/light.test.ts, "spectrum detection (GH#70)" wsPayloads.
export const bulb = {
  "3": {
    "0": "IKEA of Sweden",
    "1": "TRADFRI bulb E27 WS opal 980lm",
    "2": "",
    "3": "1.2.217",
    "6": 1,
  },
  "3311": [
    {
      "5706": "f5faf6",
      "5709": 24933,
      "5710": 24691,
      "5711": 250,
      "5717": 0,
      "5850": 1,
      "5851": 135,
      "9003": 0,
    },
  ],
  "5750": 2,
  "9001": "Strahler hinter Schreibtisch",
  "9002": 1521372733,
  "9003": 65537,
  "9019": 1,
  "9020": 1523726758,
  "9054": 0,
};

// Plug shape follows src/lib/accessory.ts: type 3 has plugList at 3312.
export const plug = {
  "9003": 65538,
  "9001": "TRADFRI control outlet",
  "9019": 1,
  "5750": 3,
  "3312": [{ "5850": 1, "9003": 0 }],
};
