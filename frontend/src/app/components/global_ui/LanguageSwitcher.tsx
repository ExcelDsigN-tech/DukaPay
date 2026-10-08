"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocaleSwitcher } from "../../hooks/useLocaleSwitcher";
import { LOCALES, LOCALE_LABELS } from "../../lib/locales";

export function LanguageSwitcher() {
  const t = useTranslations("Settings");
  const { locale, switchLocale, isPending } = useLocaleSwitcher();

  return (
    <div className="relative flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-fg transition-colors hover:bg-subtle">
      <Globe className="h-5 w-5" aria-hidden="true" />
      <select
        value={locale}
        disabled={isPending}
        onChange={(event) => switchLocale(event.target.value)}
        aria-label={t("selectLanguage")}
        className="cursor-pointer appearance-none bg-transparent text-sm font-medium text-fg focus:outline-none"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
