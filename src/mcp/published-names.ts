import type { Commodity, Province } from "../domain.js";

/** Commodities Monitor Pangan prints, in map order. */
export const commodities: readonly Commodity[] = [
  { id: "beras", name: "Beras", unit: "kg" },
  { id: "bawang-merah", name: "Bawang Merah", unit: "kg" },
  { id: "bawang-putih", name: "Bawang Putih", unit: "kg" },
  { id: "cabai-merah", name: "Cabai Merah", unit: "kg" },
  { id: "cabai-rawit", name: "Cabai Rawit", unit: "kg" },
  { id: "daging-ayam", name: "Daging Ayam Ras", unit: "kg" },
  { id: "daging-sapi", name: "Daging Sapi", unit: "kg" },
  { id: "telur-ayam", name: "Telur Ayam Ras", unit: "kg" },
  { id: "gula-pasir", name: "Gula Pasir", unit: "kg" },
  { id: "minyak-goreng", name: "Minyak Goreng", unit: "liter" },
];

/** Provinces Monitor Pangan prints, keyed by the map's region code. */
export const provinces: readonly Province[] = [
  { code: "11", name: "Aceh" },
  { code: "12", name: "Sumatera Utara" },
  { code: "13", name: "Sumatera Barat" },
  { code: "14", name: "Riau" },
  { code: "15", name: "Jambi" },
  { code: "16", name: "Sumatera Selatan" },
  { code: "17", name: "Bengkulu" },
  { code: "18", name: "Lampung" },
  { code: "19", name: "Kepulauan Bangka Belitung" },
  { code: "21", name: "Kepulauan Riau" },
  { code: "31", name: "DKI Jakarta" },
  { code: "32", name: "Jawa Barat" },
  { code: "33", name: "Jawa Tengah" },
  { code: "34", name: "DI Yogyakarta" },
  { code: "35", name: "Jawa Timur" },
  { code: "36", name: "Banten" },
  { code: "51", name: "Bali" },
  { code: "52", name: "Nusa Tenggara Barat" },
  { code: "53", name: "Nusa Tenggara Timur" },
  { code: "61", name: "Kalimantan Barat" },
  { code: "62", name: "Kalimantan Tengah" },
  { code: "63", name: "Kalimantan Selatan" },
  { code: "64", name: "Kalimantan Timur" },
  { code: "65", name: "Kalimantan Utara" },
  { code: "71", name: "Sulawesi Utara" },
  { code: "72", name: "Sulawesi Tengah" },
  { code: "73", name: "Sulawesi Selatan" },
  { code: "74", name: "Sulawesi Tenggara" },
  { code: "75", name: "Gorontalo" },
  { code: "76", name: "Sulawesi Barat" },
  { code: "81", name: "Maluku" },
  { code: "82", name: "Maluku Utara" },
  { code: "91", name: "Papua" },
  { code: "92", name: "Papua Barat" },
  { code: "93", name: "Papua Selatan" },
  { code: "94", name: "Papua Tengah" },
  { code: "95", name: "Papua Pegunungan" },
  { code: "96", name: "Papua Barat Daya" },
];

export type NameHit =
  | { status: "one"; id: string }
  | { status: "many"; reason: "cross" | "ambiguous" }
  | { status: "none" };

type Alias = { phrase: string; id: string; ambiguous?: boolean };

const commodityAliases: readonly Alias[] = [
  { phrase: "bawang merah", id: "bawang-merah" },
  { phrase: "bawang putih", id: "bawang-putih" },
  { phrase: "bawang", id: "", ambiguous: true },
  { phrase: "cabai merah", id: "cabai-merah" },
  { phrase: "cabe merah", id: "cabai-merah" },
  { phrase: "cabai rawit", id: "cabai-rawit" },
  { phrase: "cabe rawit", id: "cabai-rawit" },
  { phrase: "cabai", id: "", ambiguous: true },
  { phrase: "cabe", id: "", ambiguous: true },
  { phrase: "daging ayam", id: "daging-ayam" },
  { phrase: "daging sapi", id: "daging-sapi" },
  { phrase: "telur ayam", id: "telur-ayam" },
  { phrase: "telur", id: "telur-ayam" },
  { phrase: "gula pasir", id: "gula-pasir" },
  { phrase: "gula", id: "gula-pasir" },
  { phrase: "minyak goreng", id: "minyak-goreng" },
  { phrase: "minyak", id: "minyak-goreng" },
  { phrase: "beras", id: "beras" },
  { phrase: "ayam", id: "", ambiguous: true },
  // English names for the same published rows. "chili" alone means Cabai Merah;
  // Indonesian "cabai" without merah or rawit stays ambiguous.
  { phrase: "red chili", id: "cabai-merah" },
  { phrase: "red chilli", id: "cabai-merah" },
  { phrase: "chili", id: "cabai-merah" },
  { phrase: "chilli", id: "cabai-merah" },
  { phrase: "shallot", id: "bawang-merah" },
  { phrase: "shallots", id: "bawang-merah" },
  { phrase: "garlic", id: "bawang-putih" },
  { phrase: "cooking oil", id: "minyak-goreng" },
  { phrase: "sugar", id: "gula-pasir" },
  { phrase: "eggs", id: "telur-ayam" },
  { phrase: "egg", id: "telur-ayam" },
  { phrase: "chicken", id: "daging-ayam" },
  { phrase: "beef", id: "daging-sapi" },
  { phrase: "rice", id: "beras" },
];

const provinceAliases: readonly { phrase: string; name: string }[] = [
  ...provinces.map((province) => ({ phrase: province.name.toLowerCase(), name: province.name })),
  { phrase: "dki jakarta", name: "DKI Jakarta" },
  { phrase: "jakarta", name: "DKI Jakarta" },
  { phrase: "dki", name: "DKI Jakarta" },
  { phrase: "di yogyakarta", name: "DI Yogyakarta" },
  { phrase: "yogyakarta", name: "DI Yogyakarta" },
  { phrase: "jogja", name: "DI Yogyakarta" },
  { phrase: "yogya", name: "DI Yogyakarta" },
  { phrase: "jabar", name: "Jawa Barat" },
  { phrase: "jateng", name: "Jawa Tengah" },
  { phrase: "jatim", name: "Jawa Timur" },
];

/** Collapse visitor text so a published name can be matched. */
export function normalizeVisitorText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedHits(haystack: string, phrase: string): { start: number; end: number }[] {
  const hits: { start: number; end: number }[] = [];
  let from = 0;
  while (from < haystack.length) {
    const start = haystack.indexOf(phrase, from);
    if (start < 0) {
      break;
    }
    const end = start + phrase.length;
    const before = start === 0 || !/\p{L}/u.test(haystack[start - 1] ?? "");
    const after = end === haystack.length || !/\p{L}/u.test(haystack[end] ?? "");
    if (before && after) {
      hits.push({ start, end });
    }
    from = start + 1;
  }
  return hits;
}

/** Map visitor wording to exactly one published commodity, or report that it does not. */
export function matchCommodity(text: string): NameHit {
  const haystack = normalizeVisitorText(text);
  const aliases = [...commodityAliases].sort((left, right) => right.phrase.length - left.phrase.length);
  const specific = new Set<string>();
  let ambiguous = false;
  const occupied: { start: number; end: number }[] = [];
  for (const alias of aliases) {
    for (const hit of boundedHits(haystack, alias.phrase)) {
      const overlaps = occupied.some((span) => !(hit.end <= span.start || hit.start >= span.end));
      if (overlaps) {
        continue;
      }
      occupied.push(hit);
      if (alias.ambiguous) {
        ambiguous = true;
      } else {
        specific.add(alias.id);
      }
    }
  }
  if (specific.size > 1 || (ambiguous && specific.size > 0)) {
    return { status: "many", reason: "cross" };
  }
  if (specific.size === 1) {
    const id = [...specific][0];
    return id ? { status: "one", id } : { status: "none" };
  }
  if (ambiguous) {
    return { status: "many", reason: "ambiguous" };
  }
  return { status: "none" };
}

/** Map visitor wording to published province names, longest phrase first. */
export function matchProvinces(text: string): string[] {
  const haystack = normalizeVisitorText(text);
  const aliases = [...provinceAliases].sort((left, right) => right.phrase.length - left.phrase.length);
  const hits: { start: number; end: number; name: string }[] = [];
  for (const alias of aliases) {
    for (const hit of boundedHits(haystack, alias.phrase)) {
      const overlaps = hits.some((span) => !(hit.end <= span.start || hit.start >= span.end));
      if (overlaps || hits.some((span) => span.name === alias.name)) {
        continue;
      }
      hits.push({ ...hit, name: alias.name });
    }
  }
  return hits.sort((left, right) => left.start - right.start).map((hit) => hit.name);
}

export function commodityById(id: string): Commodity | undefined {
  return commodities.find((commodity) => commodity.id === id);
}

export function commodityIdByName(name: string): string | undefined {
  return commodities.find((commodity) => commodity.name === name)?.id;
}

export function provinceByName(name: string): Province | undefined {
  return provinces.find((province) => province.name === name);
}
