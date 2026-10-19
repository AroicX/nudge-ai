export function accessibleName(element: Element, document: Document): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    // Resolve ids in the element's own tree (shadow root or frame document).
    const root = element.getRootNode() as Document | ShadowRoot;
    const lookup = (id: string) =>
      (typeof root.getElementById === 'function' ? root.getElementById(id) : null) ??
      document.getElementById(id);
    const label = labelledBy
      .split(/\s+/)
      .map((id) => lookup(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (label) return label;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const labels = Array.from(element.labels ?? [])
      .map((label) => label.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (labels) return labels;
  }

  return (
    element.getAttribute('alt')?.trim() ||
    element.getAttribute('title')?.trim() ||
    element.getAttribute('placeholder')?.trim() ||
    element.textContent?.trim() ||
    ''
  );
}

export function associatedLabel(element: Element): string | undefined {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const label = Array.from(element.labels ?? [])
      .map((candidate) => candidate.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    return label || undefined;
  }
  return undefined;
}
