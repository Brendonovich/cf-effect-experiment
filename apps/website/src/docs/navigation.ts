import { serverSetupPath } from "./reference";

export interface DocsPage {
  readonly label: string;
  readonly href: string;
  readonly description: string;
}

export interface DocsSection {
  readonly label: string;
  readonly items: ReadonlyArray<DocsPage>;
}

/** The docs sidebar. Modules have their own section of the site. */
export const docsSections: ReadonlyArray<DocsSection> = [
  {
    label: "Guides",
    items: [
      {
        label: "Set up a server",
        href: serverSetupPath,
        description: "Run MacroGraph around the clock on your own hardware with Docker.",
      },
    ],
  },
];
