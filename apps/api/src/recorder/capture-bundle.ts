/**
 * The in-page capture script.
 *
 * Playwright serializes this function with `toString()` and evaluates it inside
 * the page under test, so it has hard constraints that explain its shape:
 *
 *   - **No imports and no closure over module scope.** Anything it references
 *     has to be defined inside it, which is why this is one large function
 *     rather than a tidy set of small modules.
 *   - **It runs in hostile territory.** The page can see and call anything on
 *     `window`, so the payload it emits is parsed against `capturedEventSchema`
 *     on the server rather than trusted.
 *
 * What it captures is the point of the whole project: role, accessible name,
 * visible text, test id, and enclosing landmark — how a *human* would describe
 * the control. Selector candidates come along as fallbacks, ranked by how well
 * each tends to survive a redesign.
 */
export function captureBundle(): void {
  const w = window as unknown as Record<string, unknown>;

  // addInitScript runs on every navigation and every frame; without this guard
  // a single click would be reported once per injection.
  if (w['__agentxCaptureInstalled'] === true) {
    return;
  }
  w['__agentxCaptureInstalled'] = true;

  const INPUT_DEBOUNCE_MS = 400;
  const SCROLL_DEBOUNCE_MS = 300;
  const MAX_TEXT = 120;

  type Payload = {
    type: string;
    url: string;
    timestamp: number;
    value?: string;
    targetRole?: string;
    targetName?: string;
    targetText?: string;
    targetTestId?: string;
    landmark?: string;
    bbox?: { x: number; y: number; width: number; height: number };
    selectorCandidates: { strategy: string; value: string; score: number }[];
    isSecret: boolean;
  };

  function emit(payload: Payload): void {
    const send = w['__agentx_emit'];
    if (typeof send === 'function') {
      try {
        (send as (p: Payload) => void)(payload);
      } catch {
        // A failed emit must never break the page the human is recording in.
      }
    }
  }

  function collapse(text: string | null | undefined): string {
    return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  }

  function isVisible(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** Explicit role, else the implicit one for the tag. */
  function roleOf(el: Element): string | undefined {
    const explicit = el.getAttribute('role');
    if (explicit !== null && explicit !== '') {
      return explicit;
    }

    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') ?? '').toLowerCase();

    if (tag === 'a') return el.hasAttribute('href') ? 'link' : undefined;
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'img') return 'img';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'form') return 'form';
    if (tag === 'dialog') return 'dialog';
    if (tag === 'table') return 'table';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (/^h[1-6]$/.test(tag)) return 'heading';

    if (tag === 'input') {
      if (type === 'button' || type === 'submit' || type === 'reset')
        return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }

    return undefined;
  }

  /**
   * A pragmatic accessible-name computation, in roughly the order the real
   * algorithm uses. Not spec-complete — it does not need to be. It needs to
   * produce the string a human would call the control.
   */
  function accessibleName(el: Element): string | undefined {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy !== null) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => node !== null)
        .map((node) => collapse(node.textContent))
        .join(' ');
      if (text !== '') return text;
    }

    const ariaLabel = collapse(el.getAttribute('aria-label'));
    if (ariaLabel !== '') return ariaLabel;

    const id = el.getAttribute('id');
    if (id !== null && id !== '') {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      const text = collapse(label?.textContent);
      if (text !== '') return text;
    }

    const wrappingLabel = el.closest('label');
    if (wrappingLabel !== null) {
      const text = collapse(wrappingLabel.textContent);
      if (text !== '') return text;
    }

    const placeholder = collapse(el.getAttribute('placeholder'));
    if (placeholder !== '') return placeholder;

    const alt = collapse(el.getAttribute('alt'));
    if (alt !== '') return alt;

    const title = collapse(el.getAttribute('title'));
    if (title !== '') return title;

    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') {
        const value = collapse(el.getAttribute('value'));
        if (value !== '') return value;
      }
    }

    const text = collapse(el.textContent);
    return text === '' ? undefined : text;
  }

  function testIdOf(el: Element): string | undefined {
    const names = ['data-testid', 'data-test-id', 'data-test', 'data-cy'];
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value !== null && value !== '') return value;
    }
    return undefined;
  }

  /**
   * Where on the page this element sits, in words. Separates "the Save in the
   * toolbar" from "the Save in the dialog" — which is exactly the ambiguity
   * that makes a replay click the wrong thing.
   */
  function landmarkOf(el: Element): string | undefined {
    const container = el.closest(
      '[role="dialog"], dialog, [role="navigation"], nav, [role="main"], main, header, footer, form, section, [role="region"]',
    );

    if (container === null) return undefined;

    const label =
      container.getAttribute('aria-label') ??
      collapse(container.querySelector('h1, h2, h3, legend')?.textContent);

    const role = roleOf(container) ?? container.tagName.toLowerCase();
    const name = collapse(label);

    return name === '' ? role : `${role} "${name}"`;
  }

  function looksGenerated(id: string): boolean {
    // Framework-generated ids (`:r3:`, `mui-1234`, long hex) change every build,
    // so they are worse than useless as a selector — they look stable and are not.
    return (
      id.length > 40 ||
      /^[:.]/.test(id) ||
      /\d{4,}/.test(id) ||
      /^[0-9a-f]{8,}$/i.test(id)
    );
  }

  function cssPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;

    while (node !== null && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;

      if (parent !== null) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === node!.tagName,
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }

      parts.unshift(part);
      node = parent;
    }

    return parts.join(' > ');
  }

  function selectorCandidates(
    el: Element,
    role: string | undefined,
    name: string | undefined,
  ): { strategy: string; value: string; score: number }[] {
    const candidates: { strategy: string; value: string; score: number }[] = [];

    const testId = testIdOf(el);
    if (testId !== undefined) {
      candidates.push({
        strategy: 'TEST_ID',
        value: testId,
        // Highest score: a test id exists to be selected on, so it survives
        // redesigns that break everything else here.
        score: 0.95,
      });
    }

    const id = el.getAttribute('id');
    if (id !== null && id !== '' && !looksGenerated(id)) {
      candidates.push({
        strategy: 'CSS',
        value: `#${CSS.escape(id)}`,
        score: 0.85,
      });
    }

    if (role !== undefined && name !== undefined && name.length <= 60) {
      candidates.push({
        strategy: 'ROLE_NAME',
        value: `${role}|${name}`,
        score: 0.8,
      });
    }

    const text = collapse(el.textContent);
    if (text !== '' && text.length <= 40) {
      candidates.push({ strategy: 'TEXT', value: text, score: 0.6 });
    }

    candidates.push({ strategy: 'CSS', value: cssPath(el), score: 0.3 });

    return candidates;
  }

  function describe(el: Element): Partial<Payload> {
    const role = roleOf(el);
    const name = accessibleName(el);
    const rect = el.getBoundingClientRect();

    return {
      targetRole: role,
      targetName: name,
      targetText: collapse(el.textContent) || undefined,
      targetTestId: testIdOf(el),
      landmark: landmarkOf(el),
      bbox: isVisible(el)
        ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        : undefined,
      selectorCandidates: selectorCandidates(el, role, name),
    };
  }

  function base(type: string): Payload {
    return {
      type,
      url: location.href,
      timestamp: Date.now(),
      selectorCandidates: [],
      isSecret: false,
    };
  }

  function isSecretField(el: Element): boolean {
    return (
      el.tagName.toLowerCase() === 'input' &&
      (el.getAttribute('type') ?? '').toLowerCase() === 'password'
    );
  }

  // --- input coalescing -----------------------------------------------------
  // A typed email should be one step, not thirty. Keystrokes collapse into a
  // single INPUT carrying the final value.

  let pendingInput: { element: Element; payload: Payload } | null = null;
  let inputTimer: ReturnType<typeof setTimeout> | null = null;

  function flushInput(): void {
    if (inputTimer !== null) {
      clearTimeout(inputTimer);
      inputTimer = null;
    }
    if (pendingInput !== null) {
      emit(pendingInput.payload);
      pendingInput = null;
    }
  }

  function queueInput(el: Element, value: string): void {
    // Switching fields flushes the previous one, so ordering stays truthful.
    if (pendingInput !== null && pendingInput.element !== el) {
      flushInput();
    }

    const secret = isSecretField(el);
    const payload: Payload = {
      ...base('INPUT'),
      ...describe(el),
      // The value of a password field never leaves the page.
      value: secret ? undefined : value,
      isSecret: secret,
    };

    pendingInput = { element: el, payload };

    if (inputTimer !== null) clearTimeout(inputTimer);
    inputTimer = setTimeout(flushInput, INPUT_DEBOUNCE_MS);
  }

  // --- listeners ------------------------------------------------------------
  // All in the capture phase, so a handler that stops propagation cannot hide
  // the interaction from the recorder.

  document.addEventListener(
    'click',
    (event) => {
      // Programmatic clicks are the application acting, not the human.
      if (!event.isTrusted) return;

      const el = event.target as Element | null;
      if (el === null || el.nodeType !== 1) return;

      flushInput();

      // Attribute the click to the interactive ancestor a human would say they
      // clicked — the label on a button, not the <span> inside it.
      const target =
        el.closest(
          'a, button, [role="button"], [role="link"], input, select, textarea, label, [onclick], [role="menuitem"], [role="tab"], [role="option"]',
        ) ?? el;

      emit({ ...base('CLICK'), ...describe(target) });
    },
    true,
  );

  document.addEventListener(
    'input',
    (event) => {
      if (!event.isTrusted) return;

      const el = event.target as (Element & { value?: string }) | null;
      if (el === null || el.nodeType !== 1) return;
      if (el.tagName.toLowerCase() === 'select') return;

      queueInput(el, typeof el.value === 'string' ? el.value : '');
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      if (!event.isTrusted) return;

      const el = event.target as (Element & { value?: string }) | null;
      if (el === null || el.nodeType !== 1) return;
      if (el.tagName.toLowerCase() !== 'select') return;

      flushInput();

      const select = el as unknown as HTMLSelectElement;
      const option = select.selectedOptions?.[0];

      emit({
        ...base('SELECT'),
        ...describe(el),
        value: collapse(option?.textContent) || select.value,
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return;

      const key = event.key;
      const isCombo = event.ctrlKey || event.metaKey || event.altKey;
      const interesting = [
        'Enter',
        'Tab',
        'Escape',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Backspace',
        'Delete',
      ];

      // Ordinary characters already arrive as INPUT; recording them twice would
      // double every typed field.
      if (!isCombo && !interesting.includes(key)) return;

      const el = event.target as Element | null;

      // Enter usually submits what was just typed, so the value must land first.
      if (key === 'Enter' || key === 'Tab') flushInput();

      const combo = [
        event.ctrlKey ? 'Ctrl' : '',
        event.metaKey ? 'Meta' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
        key,
      ]
        .filter((part) => part !== '')
        .join('+');

      emit({
        ...base('KEY'),
        ...(el !== null && el.nodeType === 1 ? describe(el) : {}),
        value: combo,
      });
    },
    true,
  );

  document.addEventListener(
    'submit',
    (event) => {
      if (!event.isTrusted) return;

      const el = event.target as Element | null;
      flushInput();

      emit({
        ...base('SUBMIT'),
        ...(el !== null && el.nodeType === 1 ? describe(el) : {}),
      });
    },
    true,
  );

  // --- scroll coalescing ----------------------------------------------------
  // One scroll gesture fires dozens of events; only where it landed matters.

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener(
    'scroll',
    () => {
      if (scrollTimer !== null) clearTimeout(scrollTimer);

      scrollTimer = setTimeout(() => {
        emit({
          ...base('SCROLL'),
          value: `${Math.round(window.scrollX)},${Math.round(window.scrollY)}`,
        });
      }, SCROLL_DEBOUNCE_MS);
    },
    true,
  );

  // A pending keystroke must not be lost when the page goes away.
  window.addEventListener('beforeunload', flushInput, true);
  window.addEventListener('pagehide', flushInput, true);
}
