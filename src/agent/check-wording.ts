import type { PhraseFacts } from "./select.js";

const monthNames: Record<string, [string, string]> = {
  "01": ["januari", "january"],
  "02": ["februari", "february"],
  "03": ["maret", "march"],
  "04": ["april", "april"],
  "05": ["mei", "may"],
  "06": ["juni", "june"],
  "07": ["juli", "july"],
  "08": ["agustus", "august"],
  "09": ["september", "september"],
  "10": ["oktober", "october"],
  "11": ["november", "november"],
  "12": ["desember", "december"],
};

/**
 * True when a model sentence still carries every published price with the Rp prefix and the trading date.
 * A sentence that drops or changes either, or writes a price without Rp, is replaced by the template.
 */
export function wordingKeepsFacts(reply: string, facts: PhraseFacts): boolean {
  const text = reply.toLowerCase().replace(/(?<=\d)[.,](?=\d{3}(?!\d))/g, "");
  return pricesIn(facts).every((price) => new RegExp(`(?<![a-z\\d])rp\\.?\\s?${price}(?!\\d)`).test(text)) && namesDate(text, facts.date);
}

function pricesIn(facts: PhraseFacts): number[] {
  switch (facts.kind) {
    case "province":
    case "rank":
      return [facts.row.harga];
    case "compare":
      return [facts.left.harga, facts.right.harga];
    case "versusAverage":
      return [facts.row.harga, facts.average];
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

function namesDate(text: string, isoDate: string): boolean {
  if (text.includes(isoDate)) {
    return true;
  }
  const [year, month, dayText] = isoDate.split("-");
  const names = month ? monthNames[month] : undefined;
  if (!year || !dayText || !names) {
    return false;
  }
  const day = String(Number(dayText));
  return names.some(
    (name) =>
      new RegExp(`(?<!\\d)0?${day} ${name} ${year}`).test(text) || new RegExp(`${name} 0?${day},? ${year}`).test(text),
  );
}
