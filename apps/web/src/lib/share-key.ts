// --- Content-addressed share keys ---
// The share key IS the route's canonical content hash: SHA-256 over the
// route name + every track point (lat/lon at 6 decimals ≈ GPS noise floor,
// ele at 2 decimals), truncated to the first 16 hex chars (64 bits — at a
// million distinct routes the prefix-collision odds are ~3e-8).
//
// The worker derives it from the posted GPX itself, so the key never depends
// on client-supplied input. Extraction is regex-based (no XML parser in the
// worker bundle, and cheap enough for the Workers free-plan CPU budget).
// Only VALUES participate: attribute order, namespaces, creator strings, and
// extension data (surface backfill, hr/cad) never split a share — which is
// what makes "share → import → re-share" resolve to the same key even though
// the round-tripped XML bytes differ.

const TRKPT_RE = /<trkpt\b([^>]*?)\/>|<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
const LAT_RE = /(?:^|\s)lat\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const LON_RE = /(?:^|\s)lon\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const ELE_RE = /<ele\b[^>]*>([^<]*)<\/ele>/;
const METADATA_RE = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/;
const NAME_RE = /<name\b[^>]*>([^<]*)<\/name>/;

function attrNumber(attrs: string, re: RegExp): number {
    const m = re.exec(attrs);
    if (!m) return 0;
    const value = parseFloat(m[1] ?? m[2] ?? '');
    return Number.isFinite(value) ? value : 0;
}

function innerEle(inner: string): number {
    const m = ELE_RE.exec(inner);
    if (!m) return 0;
    const value = parseFloat(m[1]!);
    return Number.isFinite(value) ? value : 0;
}

function metadataName(xml: string): string {
    const meta = METADATA_RE.exec(xml);
    if (!meta) return '';
    // entities (&amp; etc.) stay raw — consistently on every extraction, so
    // the hash matches across serialization round-trips
    return (NAME_RE.exec(meta[1]!)?.[1] ?? '').trim();
}

/** Derive the 16-hex content-addressed share key from a GPX XML string. */
export async function deriveShareKey(xml: string): Promise<string> {
    const parts: string[] = [metadataName(xml)];

    TRKPT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TRKPT_RE.exec(xml)) !== null) {
        // alternative 1 = self-closing tag (no <ele> child), alternative 2 = paired
        const attrs = m[1] ?? m[2] ?? '';
        const inner = m[3] ?? '';
        const lat = attrNumber(attrs, LAT_RE);
        const lon = attrNumber(attrs, LON_RE);
        parts.push(`${lat.toFixed(6)},${lon.toFixed(6)},${innerEle(inner).toFixed(2)}`);
    }

    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(parts.join('\n'))
    );
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}
