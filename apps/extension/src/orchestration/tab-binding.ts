export function assertBoundTab(boundTabId: number, activeTabId: number): void {
  if (boundTabId !== activeTabId) {
    throw new Error(`Task is bound to tab ${boundTabId}; active tab is ${activeTabId}.`);
  }
}
