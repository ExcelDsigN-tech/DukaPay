"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "../../hooks/useApi";
import { useWallet } from "../providers/WalletProvider";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useUserStore, selectUser } from "../../stores/useUserStore";

interface AgentApplication {
  id: number;
  agentPublicKey: string;
  kycRef: string;
  region: string;
  bondStroops: string;
  status: string;
  registrationTxXdr: string | null;
  onChainStatus?: string | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export function AgentApplicationPanel() {
  const t = useTranslations("AgentDashboard");
  const address = useWalletStore(selectWalletAddress);
  const user = useUserStore(selectUser);
  const { signTransaction } = useWallet();
  const [application, setApplication] = useState<AgentApplication | null>(null);
  const [pending, setPending] = useState<AgentApplication[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [kycRef, setKycRef] = useState("");
  const [region, setRegion] = useState("");
  const [bond, setBond] = useState("");
  const [topUpAmounts, setTopUpAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    const [myApplication, status] = await Promise.all([
      apiFetch<ApiResponse<AgentApplication | null>>("/agents/applications/me"),
      apiFetch<ApiResponse<{ status?: string } | null>>("/agents/status"),
    ]);
    setApplication(myApplication.data);
    setAgentStatus(status.data?.status ?? null);
    if (user?.role === "admin") {
      const applications = await apiFetch<ApiResponse<AgentApplication[]>>(
        "/agents/applications/pending",
      );
      setPending(applications.data);
    }
  }, [address, user?.role]);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : t("applicationFailed"));
    });
  }, [refresh, t]);

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/agents/applications", {
        method: "POST",
        body: JSON.stringify({ kycRef, region, bond }),
      });
      setKycRef("");
      setRegion("");
      setBond("");
      await refresh();
      setMessage(t("applicationSubmitted"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("applicationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitSigned(unsignedTxXdr: string) {
    const signedTxXdr = await signTransaction(unsignedTxXdr);
    await apiFetch("/agents/submit", {
      method: "POST",
      body: JSON.stringify({ signedTxXdr }),
    });
    await refresh();
  }

  async function buildRegistration(id: number) {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/agents/applications/${id}/register`, { method: "POST", body: "{}" });
      await refresh();
      setMessage(t("registrationBuilt"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("applicationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function agentAction(path: string, body?: Record<string, string>) {
    setBusy(true);
    setMessage(null);
    try {
      const built = await apiFetch<{ unsignedTxXdr: string }>(path, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      await submitSigned(built.unsignedTxXdr);
      setMessage(t("agentActionSubmitted"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("applicationFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          {t("applicationTitle")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("applicationDescription")}</p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {t("onChainAgentStatus")}: {agentStatus ?? t("notRegistered")}
        </p>
      </div>

      {application ? (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
          <p>
            {t("applicationStatus")}: {application.status}
          </p>
          {application.registrationTxXdr && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (application.registrationTxXdr) void submitSigned(application.registrationTxXdr);
              }}
              className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {t("signRegistration")}
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-3">
          <input
            aria-label={t("applicationKycRef")}
            required
            maxLength={32}
            value={kycRef}
            onChange={(event) => setKycRef(event.target.value)}
            placeholder={t("applicationKycRef")}
            className="rounded border p-2 dark:bg-zinc-900"
          />
          <input
            aria-label={t("applicationRegion")}
            required
            maxLength={16}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            placeholder={t("applicationRegion")}
            className="rounded border p-2 dark:bg-zinc-900"
          />
          <input
            aria-label={t("applicationBond")}
            required
            inputMode="decimal"
            value={bond}
            onChange={(event) => setBond(event.target.value)}
            placeholder={t("applicationBond")}
            className="rounded border p-2 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={busy || !address}
            className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("applyAsAgent")}
          </button>
        </form>
      )}

      {user?.role === "admin" && (
        <div>
          <h3 className="mb-3 font-semibold">{t("pendingAgentsTitle")}</h3>
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("noPendingAgents")}</p>
          ) : (
            <ul className="space-y-3">
              {pending.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <p className="break-all text-sm">{item.agentPublicKey}</p>
                  <p className="text-xs text-zinc-500">
                    {item.region} · {item.kycRef} · {item.status}
                    {item.onChainStatus ? ` · ${item.onChainStatus}` : ""}
                  </p>
                  {item.status === "PENDING" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void buildRegistration(item.id)}
                      className="mt-2 rounded border px-3 py-1 text-sm"
                    >
                      {t("buildRegistration")}
                    </button>
                  )}
                  {item.status === "REGISTERED" && item.onChainStatus === "Pending" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void agentAction(`/agents/${item.agentPublicKey}/activate`)}
                      className="mt-2 rounded border px-3 py-1 text-sm"
                    >
                      {t("activateAgent")}
                    </button>
                  )}
                  {item.status === "REGISTERED" && item.onChainStatus === "Active" && (
                    <div className="mt-2 flex gap-2">
                      <input
                        aria-label={`${t("topUpBond")} ${item.agentPublicKey}`}
                        inputMode="decimal"
                        value={topUpAmounts[item.agentPublicKey] ?? ""}
                        onChange={(event) =>
                          setTopUpAmounts((amounts) => ({
                            ...amounts,
                            [item.agentPublicKey]: event.target.value,
                          }))
                        }
                        placeholder={t("applicationBond")}
                        className="w-32 rounded border p-2 dark:bg-zinc-900"
                      />
                      <button
                        type="button"
                        disabled={busy || !topUpAmounts[item.agentPublicKey]}
                        onClick={() =>
                          void agentAction(`/agents/${item.agentPublicKey}/top-up-bond`, {
                            amount: topUpAmounts[item.agentPublicKey] ?? "",
                          })
                        }
                        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                      >
                        {t("topUpBond")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-zinc-500">
          {message}
        </p>
      )}
    </section>
  );
}
