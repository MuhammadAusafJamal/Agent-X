import type { RecordedEvent } from '@agentx/shared';

/**
 * Turns recorded events into the compact text the compiler prompt carries.
 *
 * Compaction is not cosmetic. A forty-event recording with a full accessibility
 * snapshot per event is a six-figure token prompt that is mostly repetition;
 * the model reasons better over the short version, and the call stays affordable
 * enough to run on every recording.
 */

const MAX_VALUE = 120;

export function buildEventLog(events: RecordedEvent[]): string {
  let lastUrl: string | null = null;

  return events
    .map((event) => {
      const parts: string[] = [`#${event.index}`, event.type];

      if (event.url !== lastUrl) {
        parts.push(`url=${event.url}`);
        lastUrl = event.url;
      }

      if (event.targetRole !== null) parts.push(`role=${event.targetRole}`);
      if (event.targetName !== null)
        parts.push(`name=${JSON.stringify(truncate(event.targetName))}`);
      if (event.targetTestId !== null)
        parts.push(`testid=${event.targetTestId}`);
      if (event.landmark !== null)
        parts.push(`in=${JSON.stringify(event.landmark)}`);

      if (event.isSecret) {
        // The value was never captured. Saying so explicitly is what lets the
        // model emit a credential reference instead of inventing a password.
        parts.push('value=<secret>');
      } else if (event.value !== null && event.value !== '') {
        parts.push(`value=${JSON.stringify(truncate(event.value))}`);
      }

      return parts.join(' ');
    })
    .join('\n');
}

/**
 * One snapshot per distinct URL — the last one seen there.
 *
 * Sending every snapshot would repeat the same page dozens of times; sending
 * the final state of each page keeps what the model actually needs, which is
 * what was on screen.
 */
export function selectSnapshots(
  events: RecordedEvent[],
  maxPages = 4,
): { url: string; ref: string }[] {
  const byUrl = new Map<string, string>();

  for (const event of events) {
    if (event.a11yRef !== null) {
      byUrl.set(stripQuery(event.url), event.a11yRef);
    }
  }

  return [...byUrl.entries()]
    .slice(0, maxPages)
    .map(([url, ref]) => ({ url, ref }));
}

export function formatSnapshots(
  snapshots: { url: string; content: string }[],
  maxCharsEach = 3000,
): string {
  if (snapshots.length === 0) {
    return '(none captured)';
  }

  return snapshots
    .map(
      ({ url, content }) =>
        `--- ${url} ---\n${
          content.length > maxCharsEach
            ? `${content.slice(0, maxCharsEach)}\n… (truncated)`
            : content
        }`,
    )
    .join('\n\n');
}

function truncate(value: string): string {
  return value.length <= MAX_VALUE ? value : `${value.slice(0, MAX_VALUE)}…`;
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
