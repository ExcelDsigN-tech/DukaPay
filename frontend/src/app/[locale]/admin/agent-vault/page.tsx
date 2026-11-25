"use client";

import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import { AgentVaultActions } from "../../../components/agent/AgentVaultActions";

export default function AdminAgentVaultPage() {
  const t = useTranslations("AdminAgentVault");
  const role = useUserStore((state) => state.user?.role);

  if (role && role !== "admin") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </div>
      <AgentVaultActions
        actions={["mint-float"]}
        requireTarget
        titleKey="vaultCashIn"
        descriptionKey="operatorDescription"
      />
    </div>
  );
}
