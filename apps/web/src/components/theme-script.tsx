/**
 * Applies the saved (or system) theme before first paint.
 *
 * This has to run as a blocking inline script rather than in an effect: React
 * would otherwise render light, then flip to dark after hydration — both a
 * visible flash and a hydration mismatch.
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('agentx-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (stored === null && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
