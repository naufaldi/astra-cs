import { formatRupiah } from "../domain.js";
import { normalizeVisitorText } from "../mcp/published-names.js";

export type ReplyLanguage = "id" | "en";

const englishWords = [
  "what",
  "price",
  "which",
  "highest",
  "lowest",
  "cheapest",
  "cook",
  "cooking",
  "recipe",
  "ignore",
  "rice",
  "chili",
  "chilli",
  "shallot",
  "garlic",
  "sugar",
  "oil",
  "egg",
  "eggs",
  "chicken",
  "beef",
  "here",
  "only",
  "how",
  "previous",
  "average",
  "compare",
];

const indonesianWords = [
  "harga",
  "berapa",
  "gimana",
  "dimasak",
  "dimakan",
  "resep",
  "abaikan",
  "enak",
  "enaknya",
  "sekarang",
  "tertinggi",
  "terendah",
  "masak",
  "beras",
  "cabai",
  "cabe",
  "nasi",
  "cuma",
  "ribu",
  "provinsi",
  "harganya",
];

/**
 * Choose the reply language from a few everyday words.
 * An empty message has no language, so it stays Indonesian.
 */
export function replyLanguage(text: string): ReplyLanguage {
  const normalized = normalizeVisitorText(text);
  const english = countWords(normalized, englishWords);
  const indonesian = countWords(normalized, indonesianWords);
  return english > indonesian ? "en" : "id";
}

/** Fixed visitor replies. Dynamic sentences live in the functions below. */
export const replies = {
  id: {
    offtopic: "Saya hanya menjawab pertanyaan harga dari satu tabel Monitor Pangan.",
    trend: "Pertanyaan tren tidak dijawab dari satu tabel harga.",
    cross: "Perbandingan lintas komoditas tidak dijawab dari satu tabel harga.",
    ambiguous: "Sebutkan satu nama komoditas yang terbit di Monitor Pangan.",
    needProvince: "Sebutkan provinsinya, atau minta yang tertinggi atau terendah.",
    oneOrTwo: "Sebutkan satu atau dua provinsi.",
    empty: "Tulis pertanyaan harga.",
    wording: "Jawaban harga tidak dapat disusun.",
    unread: "Tabel harga tidak dapat dibaca.",
    unpublished: "Tanggal itu tidak memiliki tabel harga.",
    unknown: "Komoditas itu tidak ada pada tabel harga.",
  },
  en: {
    offtopic: "I only answer price questions from one Monitor Pangan table.",
    trend: "A trend question is not answered from one price table.",
    cross: "A cross-commodity comparison is not answered from one price table.",
    ambiguous: "Name one commodity published by Monitor Pangan.",
    needProvince: "Name the province, or ask for the highest or lowest.",
    oneOrTwo: "Name one or two provinces.",
    empty: "Write a price question.",
    wording: "The price answer could not be written.",
    unread: "The price table could not be read.",
    unpublished: "That date has no price table.",
    unknown: "That commodity is not in the price table.",
  },
} as const;

/** The source line is added by code, so a model cannot invent the site or the date. */
export function sourceCitation(language: ReplyLanguage, date: string): string {
  if (language === "en") {
    return `Source: Monitor Pangan (monitor.naufaldi.com), data ${date}`;
  }
  return `Sumber: Monitor Pangan (monitor.naufaldi.com), data ${date}`;
}

/** Ask which published variant, naming only rows that exist on the price table. */
export function ambiguousCommodityReply(
  language: ReplyLanguage,
  names: readonly string[],
  provinces: readonly string[],
): string {
  const list = joinChoices(language, names);
  const where = provinceLead(language, provinces);
  if (language === "en") {
    return where ? `${where}, name one: ${list}.` : `Name one: ${list}.`;
  }
  return where ? `${where}, sebutkan salah satu: ${list}.` : `Sebutkan salah satu: ${list}.`;
}

export function missingProvincePrice(language: ReplyLanguage, commodity: string, date: string): string {
  if (language === "en") {
    return `${commodity} has no price for that province on trading date ${date}.`;
  }
  return `${commodity} tidak memiliki harga untuk provinsi itu pada tanggal perdagangan ${date}.`;
}

export function recordedClaim(language: ReplyLanguage, commodity: string, province: string): string {
  if (language === "en") {
    return `The ${commodity} price claim for ${province} is recorded.`;
  }
  return `Klaim harga ${commodity} di ${province} sudah dicatat.`;
}

/** A claim we stored even though a province (or the commodity) was never named. */
export function reviewClaim(language: ReplyLanguage, commodity: string, amount: number): string {
  const money = formatRupiah(amount);
  if (language === "en") {
    if (commodity === "tidak disebut") {
      return `The price claim of ${money} is recorded. A person will review it because the commodity and province were not named.`;
    }
    return `The ${commodity} price claim of ${money} is recorded. A person will review it because no province was named.`;
  }
  if (commodity === "tidak disebut") {
    return `Klaim harga sebesar ${money} sudah dicatat. Petugas akan meninjaunya karena komoditas dan provinsinya belum disebut.`;
  }
  return `Klaim harga ${commodity} sebesar ${money} sudah dicatat. Petugas akan meninjaunya karena provinsinya belum disebut.`;
}

function joinChoices(language: ReplyLanguage, names: readonly string[]): string {
  const conjunction = language === "en" ? "or" : "atau";
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} ${conjunction} ${names[1]}`;
  }
  const head = names.slice(0, -1).join(", ");
  return `${head}, ${conjunction} ${names[names.length - 1]}`;
}

function provinceLead(language: ReplyLanguage, provinces: readonly string[]): string | null {
  const [first, second] = provinces;
  if (provinces.length === 1 && first) {
    return language === "en" ? `In ${first}` : `Di ${first}`;
  }
  if (provinces.length === 2 && first && second) {
    return language === "en" ? `In ${first} and ${second}` : `Di ${first} dan ${second}`;
  }
  return null;
}

function countWords(text: string, words: readonly string[]): number {
  let count = 0;
  for (const word of words) {
    const pattern = new RegExp(`(?:^|\\s)${word}(?:\\s|$)`);
    if (pattern.test(text)) {
      count += 1;
    }
  }
  return count;
}
