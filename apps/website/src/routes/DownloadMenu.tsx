import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

export function DownloadMenu() {
  return (
    <Button type="button" disabled sx={styles.trigger}>
      <IconTablerDeviceDesktopDown {...stylex.attrs(styles.icon)} />
      Download
      <span sx={styles.badge}>Soon</span>
    </Button>
  );
}

const styles = stylex.create({
  trigger: { gap: 8, height: 44, paddingInline: 20, borderRadius: 8, fontSize: 15 },
  icon: { width: 18, height: 18 },
  badge: {
    paddingInline: 6,
    borderRadius: 4,
    backgroundColor: colors.gray4,
    fontSize: 11,
    lineHeight: "18px",
    color: colors.gray11,
  },
});
