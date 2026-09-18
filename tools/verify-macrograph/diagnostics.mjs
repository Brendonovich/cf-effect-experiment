export function isUnexpectedConsoleProblem(message) {
  return (
    message.ignored !== true &&
    (message.type === "error" || message.text.includes("[STRICT_READ_UNTRACKED]"))
  );
}
