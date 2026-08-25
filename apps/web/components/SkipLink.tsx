/** The first focusable thing on every page: one Tab, one Enter, and the reader is past the chrome. */
export default function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to main content
    </a>
  );
}
