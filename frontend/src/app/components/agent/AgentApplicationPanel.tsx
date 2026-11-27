"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "../../hooks/useApi";
import { useWallet } from "../providers/WalletProvider";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useUserStore, selectUser } from "../../stores/useUserStore";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

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

  // An agent already on chain has nothing to apply for; show only its status.
  if (agentStatus && !application && user?.role !== "admin") {
    return (
      <section className="flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-4 text-sm">
        <span className="text-fg-muted">{t("onChainAgentStatus")}</span>
        <span className="font-medium text-fg">{agentStatus}</span>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-surface p-6">
      <div>
        <h2 className="text-sm font-medium text-fg">{t("applicationTitle")}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t("applicationDescription")}</p>
        <p className="mt-2 text-sm text-fg-muted">
          {t("onChainAgentStatus")}:{" "}
          <span className="font-medium text-fg">{agentStatus ?? t("notRegistered")}</span>
        </p>
      </div>

      {application ? (
        <div className="space-y-3 rounded-xl bg-subtle p-4">
          <p className="text-sm text-fg">
            {t("applicationStatus")}: {application.status}
          </p>
          {application.registrationTxXdr && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                if (application.registrationTxXdr) void submitSigned(application.registrationTxXdr);
              }}
            >
              {t("signRegistration")}
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={apply} className="grid items-end gap-4 sm:grid-cols-4">
          <Input
            label={t("applicationKycRef")}
            aria-label={t("applicationKycRef")}
            required
            maxLength={32}
            value={kycRef}
            onChange={(event) => setKycRef(event.target.value)}
          />
          <Input
            label={t("applicationRegion")}
            aria-label={t("applicationRegion")}
            required
            maxLength={16}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
          <Input
            label={t("applicationBond")}
            aria-label={t("applicationBond")}
            required
            inputMode="decimal"
            value={bond}
            onChange={(event) => setBond(event.target.value)}
          />
          <Button type="submit" disabled={busy || !address}>
            {t("applyAsAgent")}
          </Button>
        </form>
      )}

      {user?.role === "admin" && (
        <div>
          <h3 className="mb-3 text-sm font-medium text-fg">{t("pendingAgentsTitle")}</h3>
          {pending.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("noPendingAgents")}</p>
          ) : (
            <ul className="space-y-3">
              {pending.map((item) => (
                <li key={item.id} className="rounded-xl border border-line p-4">
                  <p className="break-all font-mono text-xs text-fg">{item.agentPublicKey}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {item.region} · {item.kycRef} · {item.status}
                    {item.onChainStatus ? ` · ${item.onChainStatus}` : ""}
                  </p>
                  {item.status === "PENDING" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void buildRegistration(item.id)}
                      className="mt-3 h-8 rounded-lg border border-line px-3 text-xs font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-50"
                    >
                      {t("buildRegistration")}
                    </button>
                  )}
                  {item.status === "REGISTERED" && item.onChainStatus === "Pending" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void agentAction(`/agents/${item.agentPublicKey}/activate`)}
                      className="mt-3 h-8 rounded-lg border border-line px-3 text-xs font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-50"
                    >
                      {t("activateAgent")}
                    </button>
                  )}
                  {item.status === "REGISTERED" && item.onChainStatus === "Active" && (
                    <div className="mt-3 flex gap-2">
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
                        className="h-8 w-32 rounded-lg border border-line bg-surface px-2 text-sm tabular-nums text-fg"
                      />
                      <button
                        type="button"
                        disabled={busy || !topUpAmounts[item.agentPublicKey]}
                        onClick={() =>
                          void agentAction(`/agents/${item.agentPublicKey}/top-up-bond`, {
                            amount: topUpAmounts[item.agentPublicKey] ?? "",
                          })
                        }
                        className="h-8 rounded-lg border border-line px-3 text-xs font-medium text-fg transition-colors hover:bg-subtle disabled:opacity-50"
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
        <p role="status" className="text-sm text-fg-muted">
          {message}
        </p>
      )}
    </section>
  );
}
