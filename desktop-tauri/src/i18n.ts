/// <reference types="vite/client" />

export const languageOptions = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "da", label: "Dansk" },
  { code: "ja", label: "日本語" },
  { code: "se", label: "Svenska" },
  { code: "zh", label: "简体中文" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "ko", label: "한국어" },
  { code: "pt", label: "Português" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
] as const;

export type LanguageCode = (typeof languageOptions)[number]["code"];
export type Translate = (source: string) => string;

const languageCodes = new Set<string>(languageOptions.map(({ code }) => code));
const importedCatalogs = import.meta.glob<string>([
  "../../config/languages/openterface_fr.ts",
  "../../config/languages/openterface_de.ts",
  "../../config/languages/openterface_da.ts",
  "../../config/languages/openterface_ja.ts",
  "../../config/languages/openterface_se.ts",
  "../../config/languages/openterface_zh.ts",
  "../../config/languages/openterface_es.ts",
  "../../config/languages/openterface_it.ts",
  "../../config/languages/openterface_ko.ts",
  "../../config/languages/openterface_pt.ts",
  "../../config/languages/openterface_ro.ts",
  "../../config/languages/openterface_ru.ts",
], {
  import: "default",
  query: "?raw",
}) as Record<string, () => Promise<string>>;
const catalogs = new Map<LanguageCode, Map<string, string>>();
const catalogLoaders = new Map<LanguageCode, () => Promise<string>>();
let activeLanguage: LanguageCode = "en";

export function isLanguageCode(value: string): value is LanguageCode {
  return languageCodes.has(value);
}

export function setActiveLanguage(language: LanguageCode) {
  activeLanguage = language;
}

function readCatalog(source: string) {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.querySelector("parsererror")) return new Map<string, string>();

  const messages = new Map<string, string>();
  for (const message of document.querySelectorAll("context > message")) {
    const sourceText = message.querySelector(":scope > source")?.textContent ?? "";
    const translation = message.querySelector(":scope > translation");
    const translatedText = translation?.textContent ?? "";
    const status = translation?.getAttribute("type");
    if (!sourceText || !translatedText || status === "unfinished" || status === "vanished" || status === "obsolete") continue;
    messages.set(sourceText, translatedText);
  }
  return messages;
}

for (const [path, load] of Object.entries(importedCatalogs)) {
  const language = path.match(/openterface_([a-z]+)\.ts$/)?.[1];
  if (language && isLanguageCode(language)) catalogLoaders.set(language, load);
}

export async function loadLanguage(language: LanguageCode) {
  if (language === "en" || catalogs.has(language)) return;
  const load = catalogLoaders.get(language);
  if (!load) return;
  catalogs.set(language, readCatalog(await load()));
}

export const translate: Translate = (source) => {
  if (activeLanguage === "en") return source;
  return catalogs.get(activeLanguage)?.get(source) ?? source;
};
