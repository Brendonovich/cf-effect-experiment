import { ModuleUI } from "@macrograph/module/ModuleUI";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({ only: { paddingTop: 1111 } });

export const className = stylex.props(styles.only).className;

export default ModuleUI.make({});
