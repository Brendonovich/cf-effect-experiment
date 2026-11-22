import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

export function DownloadMenu() {
  return (
    <div sx={styles.root}>
      <Button type="button" disabled aria-describedby="download-soon" sx={styles.trigger}>
        <IconTablerDeviceDesktopDown {...stylex.attrs(styles.icon)} />
        Download Desktop
      </Button>
      <span id="download-soon" sx={styles.sticker}>
        Soon
      </span>
    </div>
  );
}

const styles = stylex.create({
  root: { position: "relative" },
  trigger: { gap: 8, height: 44, paddingInline: 20, borderRadius: 8, fontSize: 15 },
  icon: { width: 18, height: 18 },
  sticker: {
    position: "absolute",
    top: -7,
    right: -7,
    paddingInline: 7,
    borderRadius: 999,
    backgroundColor: colors.gray12,
    boxShadow: `0 0 0 2px ${colors.gray1}`,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "16px",
    color: colors.gray1,
    pointerEvents: "none",
  },
});
