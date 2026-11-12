// The AseDex app is rendered by the parent asedex/layout.tsx so it survives
// view/pair URL changes; this route only exists to make /asedex/* resolve.
export default function AseDexRoute() {
  return null;
}
