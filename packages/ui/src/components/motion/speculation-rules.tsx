// Speculation Rules: prerender cross-app links on hover (Chrome/Edge) so
// subdomain hops land instantly; ignored elsewhere. The target apps send
// Supports-Loading-Mode: uncredentialed-prerender via _headers.
export function SpeculationRules() {
  return (
    <script
      type="speculationrules"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          prerender: [
            {
              source: "document",
              where: {
                or: [
                  { href_matches: "https://*.asepad.fun/*" },
                  { href_matches: "https://asepad.fun/*" },
                  { href_matches: "/*", relative_to: "document" }
                ]
              },
              eagerness: "moderate"
            }
          ]
        })
      }}
    />
  );
}
