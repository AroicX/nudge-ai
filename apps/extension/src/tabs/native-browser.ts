/** Browser UI commands deliberately bypass page models, with explicit tab/window targeting. */
export type NativeBrowserCommand =
  | { kind: 'zoom'; value: 'in' | 'out' | 'reset' | number }
  | { kind: 'window'; state: 'fullscreen' | 'normal' | 'maximized' | 'minimized' }
  | { kind: 'arrange'; layout: 'side-by-side' | 'stacked' }
  | { kind: 'unsplit' }
  | {
      kind: 'tab';
      action:
        'pin' | 'unpin' | 'mute' | 'unmute' | 'group' | 'ungroup' | 'reload' | 'back' | 'forward';
    };
export interface WorkArea {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface BrowserWindow {
  id?: number;
  state?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}
export interface BrowserTab {
  id?: number;
  windowId: number;
  index: number;
  pinned?: boolean;
  highlighted?: boolean;
  groupId?: number;
  splitViewId?: number;
  mutedInfo?: { muted: boolean };
  url?: string;
}
export interface BrowserApi {
  tabs: {
    get(id: number): Promise<BrowserTab>;
    query(query: {
      windowId?: number;
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<BrowserTab[]>;
    getZoom(id: number): Promise<number>;
    setZoom(id: number, factor: number): Promise<void>;
    update(
      id: number,
      changes: { pinned?: boolean; muted?: boolean },
    ): Promise<BrowserTab | undefined>;
    createSplit?(ids: [number, number]): Promise<number>;
    unsplit?(splitViewId: number): Promise<void>;
    group?(options: { tabIds: number[] }): Promise<number>;
    ungroup?(ids: number[]): Promise<void>;
    reload?(id: number): Promise<void>;
    goBack?(id: number): Promise<void>;
    goForward?(id: number): Promise<void>;
  };
  windows: {
    get(id: number): Promise<BrowserWindow>;
    update(
      id: number,
      changes: Partial<WorkArea> & { state?: 'normal' | 'fullscreen' | 'maximized' | 'minimized' },
    ): Promise<BrowserWindow>;
    create(
      options: WorkArea & { tabId: number; type: 'normal'; state: 'normal' },
    ): Promise<BrowserWindow | undefined>;
  };
}

export function parseNativeBrowserCommand(text: string): NativeBrowserCommand | undefined {
  const input = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]$/, '')
    .replace(/^(?:can|could|would) you\s+/, '')
    .replace(/^please\s+/, '')
    .trim();
  let match = /^(?:zoom)(?: (?:the |this |current )?(?:page|tab))? (in|out)$/.exec(input);
  if (match) return { kind: 'zoom', value: match[1] as 'in' | 'out' };
  if (
    /^(?:reset zoom|reset (?:the )?(?:page |tab )?zoom|zoom (?:to )?(?:default|normal))$/.test(
      input,
    )
  )
    return { kind: 'zoom', value: 'reset' };
  match = /^zoom(?: (?:the |this |current )?(?:page|tab))? (?:to )?(\d{2,3})\s*(?:%|percent)$/.exec(
    input,
  );
  if (match && Number(match[1]) >= 25 && Number(match[1]) <= 500)
    return { kind: 'zoom', value: Number(match[1]) };
  if (/^(?:enter |go |make (?:the |this )?(?:browser|window) )?full[ -]?screen$/.test(input))
    return { kind: 'window', state: 'fullscreen' };
  if (/^(?:exit|leave) full[ -]?screen$/.test(input)) return { kind: 'window', state: 'normal' };
  match = /^(maximize|minimize)(?: (?:the |this )?(?:browser|window))?$/.exec(input);
  if (match) return { kind: 'window', state: match[1] === 'maximize' ? 'maximized' : 'minimized' };
  if (
    /^(?:unsplit(?: (?:the |this )?(?:tabs|screen|view))?|exit split (?:screen|view))$/.test(input)
  )
    return { kind: 'unsplit' };
  if (/^(?:split(?: (?:the )?screen| tabs)?|split the tabs)$/.test(input))
    return { kind: 'arrange', layout: 'side-by-side' };
  if (/^stack (?:the )?(?:screens|windows)$/.test(input))
    return { kind: 'arrange', layout: 'stacked' };
  if (/^(?:split|arrange|tile)(?: (?:the |these )?(?:two|2))? tabs side[ -]by[ -]side$/.test(input))
    return { kind: 'arrange', layout: 'side-by-side' };
  if (/^(?:stack|arrange|tile)(?: (?:the |these )?(?:two|2))? tabs vertically$/.test(input))
    return { kind: 'arrange', layout: 'stacked' };
  match = /^(pin|unpin|mute|unmute|group|ungroup|reload)(?: (?:the |this |current )?tab)?$/.exec(
    input,
  );
  if (match)
    return {
      kind: 'tab',
      action: match[1] as Extract<NativeBrowserCommand, { kind: 'tab' }>['action'],
    };
  match = /^(?:go |navigate )(back|forward)$/.exec(input);
  if (match) return { kind: 'tab', action: match[1] as 'back' | 'forward' };
  return undefined;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function boundsMatch(window: BrowserWindow, bounds: WorkArea): boolean {
  return (Object.keys(bounds) as Array<keyof WorkArea>).every(
    (key) => typeof window[key] === 'number' && Math.abs(window[key]! - bounds[key]) <= 4,
  );
}
export async function executeNativeBrowserCommand(
  command: NativeBrowserCommand,
  originTabId: number | undefined,
  api: BrowserApi,
  options: {
    signal?: AbortSignal;
    getWorkArea?: (window: BrowserWindow) => Promise<WorkArea> | WorkArea;
  } = {},
): Promise<string> {
  const assertActive = () => options.signal?.throwIfAborted();
  assertActive();
  const tab =
    originTabId === undefined
      ? (await api.tabs.query({ active: true, currentWindow: true }))[0]
      : await api.tabs.get(originTabId);
  check(tab?.id !== undefined && tab.windowId >= 0, 'Open or link a browser tab first.');
  const id = tab.id;
  if (command.kind === 'zoom') {
    const levels = [
      0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
    ];
    assertActive();
    const before = await api.tabs.getZoom(id);
    const factor =
      typeof command.value === 'number'
        ? command.value / 100
        : command.value === 'reset'
          ? 0
          : command.value === 'in'
            ? (levels.find((value) => value > before + 0.001) ?? 5)
            : ([...levels].reverse().find((value) => value < before - 0.001) ?? 0.25);
    assertActive();
    await api.tabs.setZoom(id, factor);
    assertActive();
    const after = await api.tabs.getZoom(id);
    check(
      Number.isFinite(after) && after > 0 && (factor === 0 || Math.abs(after - factor) < 0.01),
      'The browser did not apply the requested zoom.',
    );
    assertActive();
    return `Page zoom is ${Math.round(after * 100)}%.`;
  }
  if (command.kind === 'window') {
    assertActive();
    await api.windows.update(tab.windowId, { state: command.state });
    assertActive();
    check(
      (await api.windows.get(tab.windowId)).state === command.state,
      'The browser did not apply the requested window state.',
    );
    assertActive();
    return `Browser window is ${command.state === 'normal' ? 'out of fullscreen' : command.state}.`;
  }
  if (command.kind === 'unsplit') {
    check(
      api.tabs.unsplit && (tab.splitViewId ?? -1) >= 0,
      'The linked tab is not in an available browser split view.',
    );
    assertActive();
    await api.tabs.unsplit(tab.splitViewId!);
    assertActive();
    check(
      ((await api.tabs.get(id)).splitViewId ?? -1) < 0,
      'The browser did not confirm leaving split view.',
    );
    assertActive();
    return 'The linked browser split view has been separated into tabs.';
  }
  if (command.kind === 'arrange') {
    assertActive();
    const webTabs = (await api.tabs.query({ windowId: tab.windowId })).filter(
      (candidate) => candidate.id !== undefined && /^https?:\/\//i.test(candidate.url ?? ''),
    );
    const highlighted = webTabs.filter((candidate) => candidate.highlighted);
    const tabs =
      highlighted.length === 2 && highlighted.some((candidate) => candidate.id === id)
        ? highlighted
        : webTabs;
    check(
      tabs.length === 2 && tabs.some((candidate) => candidate.id === id),
      'Keep exactly two web tabs in the linked window, or select two including the linked tab, so I know which pair to arrange.',
    );
    const other = tabs.find((candidate) => candidate.id !== id)!;
    const ids: [number, number] = [id, other.id!];
    if (
      command.layout === 'side-by-side' &&
      api.tabs.createSplit &&
      Math.abs(tab.index - other.index) === 1 &&
      tab.pinned === other.pinned &&
      tab.groupId === other.groupId &&
      (tab.splitViewId ?? -1) < 0 &&
      (other.splitViewId ?? -1) < 0
    ) {
      assertActive();
      const splitId = await api.tabs.createSplit(ids);
      assertActive();
      const result = await Promise.all(ids.map((tabId) => api.tabs.get(tabId)));
      check(
        result.every((item) => item.splitViewId === splitId && item.windowId === tab.windowId),
        'The browser did not confirm the split view.',
      );
      assertActive();
      return 'The two tabs are side by side in browser split view.';
    }
    check(
      options.getWorkArea,
      'Available screen dimensions are required to arrange browser windows.',
    );
    assertActive();
    const window = await api.windows.get(tab.windowId);
    assertActive();
    const area = await options.getWorkArea(window);
    check(
      Object.values(area).every(Number.isFinite) && area.width >= 640 && area.height >= 480,
      'The available screen area is too small or invalid.',
    );
    const first = { ...area };
    const second = { ...area };
    if (command.layout === 'side-by-side') {
      first.width = Math.floor(area.width / 2);
      second.left += first.width;
      second.width -= first.width;
    } else {
      first.height = Math.floor(area.height / 2);
      second.top += first.height;
      second.height -= first.height;
    }
    // Create the second window before resizing the first; failures never close a user's tab.
    assertActive();
    const created = await api.windows.create({
      ...second,
      tabId: other.id!,
      type: 'normal',
      state: 'normal',
    });
    check(created?.id !== undefined, 'The browser did not create the second window.');
    assertActive();
    await api.windows.update(tab.windowId, { state: 'normal' });
    assertActive();
    await api.windows.update(tab.windowId, first);
    assertActive();
    const applied = await api.windows.get(tab.windowId);
    // Chrome's minimum window size can depend on its visible side panel. Give
    // the other window the remaining space instead of allowing an overlap.
    if (command.layout === 'stacked' && applied.height && applied.height !== first.height) {
      first.height = applied.height;
      second.top = area.top + applied.height;
      second.height = area.height - applied.height;
      check(second.height >= 100, 'The screen is too short to stack these browser windows.');
      assertActive();
      await api.windows.update(created.id, second);
    } else if (command.layout === 'side-by-side' && applied.width && applied.width !== first.width) {
      first.width = applied.width;
      second.left = area.left + applied.width;
      second.width = area.width - applied.width;
      check(second.width >= 100, 'The screen is too narrow for these browser windows.');
      assertActive();
      await api.windows.update(created.id, second);
    }
    assertActive();
    const [left, right, moved] = await Promise.all([
      api.windows.get(tab.windowId),
      api.windows.get(created.id),
      api.tabs.get(other.id!),
    ]);
    check(
      boundsMatch(left, first) && boundsMatch(right, second) && moved.windowId === created.id,
      'The browser could not confirm the requested layout; the tabs may now be in separate windows.',
    );
    assertActive();
    return command.layout === 'side-by-side'
      ? 'The two tabs are in separate windows side by side.'
      : 'The two tabs are in separate windows stacked vertically.';
  }
  const action = command.action;
  if (action === 'pin' || action === 'unpin' || action === 'mute' || action === 'unmute') {
    const pin = action === 'pin' || action === 'unpin';
    const enabled = action === 'pin' || action === 'mute';
    assertActive();
    await api.tabs.update(id, pin ? { pinned: enabled } : { muted: enabled });
    assertActive();
    const after = await api.tabs.get(id);
    check(
      (pin ? after.pinned : after.mutedInfo?.muted) === enabled,
      'The browser did not apply the tab change.',
    );
    assertActive();
    return `Tab ${pin ? (enabled ? 'pinned' : 'unpinned') : enabled ? 'muted' : 'unmuted'}.`;
  }
  if (action === 'group') {
    check(api.tabs.group, 'Tab grouping is unavailable in this browser.');
    assertActive();
    const groupId = await api.tabs.group({ tabIds: [id] });
    assertActive();
    check(
      (await api.tabs.get(id)).groupId === groupId,
      'The browser did not confirm the tab group.',
    );
    assertActive();
    return 'Tab placed in a group.';
  }
  if (action === 'ungroup') {
    check(api.tabs.ungroup, 'Tab grouping is unavailable in this browser.');
    assertActive();
    await api.tabs.ungroup([id]);
    assertActive();
    check(
      ((await api.tabs.get(id)).groupId ?? -1) < 0,
      'The browser did not remove the tab from its group.',
    );
    assertActive();
    return 'Tab removed from its group.';
  }
  const method = action === 'reload' ? 'reload' : action === 'back' ? 'goBack' : 'goForward';
  check(api.tabs[method], 'This browser action is unavailable.');
  assertActive();
  await api.tabs[method]!(id);
  // Browser acknowledgement confirms dispatch, not page load completion or a changed URL.
  assertActive();
  await api.tabs.get(id);
  assertActive();
  return action === 'reload'
    ? 'The browser accepted the tab reload.'
    : `The browser accepted navigation ${action}.`;
}
