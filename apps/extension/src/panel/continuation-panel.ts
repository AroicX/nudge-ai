/** Call during the Send/call button gesture, before awaiting work or inference. */
export function openContinuationPanel(
  fullPage: boolean,
  windowId: number | undefined,
  open: (options: { windowId: number }) => Promise<void>,
  failed: () => void,
): void {
  if (!fullPage || windowId === undefined) return;
  // A window-wide panel follows the task when it opens or activates another tab.
  // Chrome rejects delayed opens once the original user gesture has expired.
  try {
    void open({ windowId }).catch(failed);
  } catch {
    failed();
  }
}
