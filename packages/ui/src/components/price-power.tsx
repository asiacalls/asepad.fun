// Renders formatTokenPrice* output with real <sub> digits — the raw Unicode
// superscript glyphs (⁰¹²³…) are missing from many mobile fonts and draw as
// blank boxes. Splitting them into <sub> elements renders everywhere, and the
// below-baseline position can't merge into the trailing digits.
const SUP_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
const SUP_TO_DIGIT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

export function PricePower({ text }: { text: string }) {
  const parts = text.split(SUP_RE);
  const sups = text.match(SUP_RE) ?? [];
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {sups[i] ? (
            <sub className="align-sub text-[0.72em] font-bold leading-none">
              {[...sups[i]].map((c) => SUP_TO_DIGIT[c]).join("")}
            </sub>
          ) : null}
        </span>
      ))}
    </>
  );
}
