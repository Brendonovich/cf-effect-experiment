import AutoImport from "unplugin-auto-import/vite";
import IconsResolver from "unplugin-icons/resolver";
import UnpluginIcons from "unplugin-icons/vite";

const FixedAutoImport = (options) => {
  const autoImport = AutoImport(options);

  const wrapTransform = (transform) => (source, id) => {
    const pathname = id.startsWith("/") ? new URL(`file://${id}`).pathname : id;
    return transform(source, pathname);
  };

  if (typeof autoImport.transform === "function") {
    autoImport.transform = wrapTransform(autoImport.transform);
  } else if (typeof autoImport.transform === "object") {
    autoImport.transform = wrapTransform(autoImport.transform.handler);
  }

  return autoImport;
};

export function Icons() {
  return [
    FixedAutoImport({
      resolvers: [IconsResolver({ prefix: "Icon", extension: "jsx" })],
      dts: new URL("./auto-imports.d.ts", import.meta.url).pathname,
    }),
    UnpluginIcons({ compiler: "solid" }),
  ];
}
