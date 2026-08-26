import config from "./vite.config";

export default {
  ...config,
  test: { environment: "node" },
};
