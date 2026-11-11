/** Tells screen-reader users a link opens a new tab (accessibility review 21). Put it inside the link. */
export default function NewTabNote() {
  return <span className="sr-only"> (opens in a new tab)</span>;
}
