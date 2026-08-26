import type { Credential } from "@macrograph/plugin";

import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { colors } from "../tokens.stylex.ts";

const styles = stylex.create({
  container: {
    overflowX: "auto",
    borderColor: colors.gray4,
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
  },
  table: {
    width: "100%",
    minWidth: "30rem",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: 12,
  },
  tableHead: {
    backgroundColor: colors.gray3,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  nameColumn: { width: "38%" },
  providerColumn: { width: "25%" },
  tableHeader: {
    borderBottomColor: colors.gray6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    paddingBlock: 6,
    paddingInline: 10,
    fontWeight: 500,
    color: colors.gray11,
  },
  tableRow: {
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  emptyCell: { paddingBlock: 12, paddingInline: 10, color: colors.gray10 },
  cell: { paddingBlock: 8, paddingInline: 10 },
  nameCell: { fontWeight: 500, color: colors.gray12 },
  provider: {
    borderRadius: 2,
    backgroundColor: colors.gray3,
    paddingBlock: 2,
    paddingInline: 6,
    fontSize: 11,
    textTransform: "capitalize",
    color: colors.gray11,
  },
  idCell: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    color: colors.gray10,
  },
});

export interface CredentialTableProps {
  readonly credentials: ReadonlyArray<Credential.Summary>;
}

export function CredentialTable(props: CredentialTableProps) {
  return (
    <div sx={styles.container}>
      <table sx={styles.table}>
        <thead sx={styles.tableHead}>
          <tr>
            <th sx={[styles.tableHeader, styles.nameColumn]}>Name</th>
            <th sx={[styles.tableHeader, styles.providerColumn]}>Provider</th>
            <th sx={styles.tableHeader}>ID</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.credentials}
            fallback={
              <tr sx={styles.tableRow}>
                <td sx={styles.emptyCell} colspan="3">
                  No credentials available.
                </td>
              </tr>
            }
          >
            {(credential) => (
              <tr sx={styles.tableRow}>
                <td sx={[styles.cell, styles.nameCell]}>
                  {credential.displayName ?? credential.id}
                </td>
                <td sx={styles.cell}>
                  <span sx={styles.provider}>{credential.provider}</span>
                </td>
                <td sx={[styles.cell, styles.idCell]}>{credential.id}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
