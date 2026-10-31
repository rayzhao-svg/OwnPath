"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AccountUser } from "@/lib/account-types";
import { getSession, loginAccount, logoutAccount, registerAccount } from "@/lib/account-client";

export interface AccountContextValue {
  user: AccountUser | null;
  status: "loading" | "authenticated" | "guest";
  error: string | null;
  sessionEpoch: number;
  register: (input: { name: string; email: string; password: string }) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  registerBeforeLogout: (handler: () => Promise<void>) => () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);
const unavailable = async () => { throw new Error("Account services are not ready. Please reload OwnPath."); };
const GUEST_ACCOUNT: AccountContextValue = {
  user: null, status: "guest", error: null, sessionEpoch: 0,
  register: unavailable, login: unavailable, logout: unavailable,
  registerBeforeLogout: () => () => {},
};

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [status, setStatus] = useState<AccountContextValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const userRef = useRef<AccountUser | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const sessionRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const changingAccount = useRef(false);
  const beforeLogout = useRef(new Set<() => Promise<void>>());

  const applyUser = useCallback((next: AccountUser | null) => {
    if (!mounted.current) return;
    if (userRef.current?.id !== next?.id) setSessionEpoch(value => value + 1);
    const previous = userRef.current;
    userRef.current = next;
    if (previous?.id !== next?.id || previous?.name !== next?.name || previous?.email !== next?.email) setUser(next);
    initialized.current = true;
    setStatus(next ? "authenticated" : "guest");
  }, []);

  const invalidateSession = useCallback(() => {
    sequence.current++;
    sessionRequest.current?.abort();
  }, []);

  const refreshSession = useCallback(async () => {
    if (changingAccount.current) return;
    const id = ++sequence.current;
    sessionRequest.current?.abort();
    const controller = new AbortController();
    sessionRequest.current = controller;
    try {
      const next = await getSession(controller.signal);
      if (!mounted.current || controller.signal.aborted || sequence.current !== id) return;
      setError(null);
      applyUser(next);
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted || sequence.current !== id) return;
      setError(cause instanceof Error ? cause.message : "Your account session could not be checked. Please try again.");
      if (!initialized.current) {
        initialized.current = true;
        setStatus("guest");
      }
    } finally { if (sessionRequest.current === controller) sessionRequest.current = null; }
  }, [applyUser]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => { if (active) void refreshSession(); });
    const recheck = () => { void refreshSession(); };
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    return () => {
      active = false;
      mounted.current = false;
      invalidateSession();
      mutation.current?.abort();
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", recheck);
    };
  }, [refreshSession, invalidateSession]);

  const changeAccount = useCallback(async (action: (signal: AbortSignal) => Promise<AccountUser | null>) => {
    if (changingAccount.current) throw new Error("An account change is already in progress. Please wait.");
    changingAccount.current = true;
    invalidateSession();
    const controller = new AbortController();
    mutation.current = controller;
    setError(null);
    try {
      const next = await action(controller.signal);
      if (mounted.current && !controller.signal.aborted) applyUser(next);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Your account could not be updated. Please try again.");
      throw cause;
    } finally {
      changingAccount.current = false;
      if (mutation.current === controller) mutation.current = null;
    }
  }, [applyUser, invalidateSession]);

  const register = useCallback((input: { name: string; email: string; password: string }) =>
    changeAccount(signal => registerAccount(input, signal)), [changeAccount]);
  const login = useCallback((input: { email: string; password: string }) =>
    changeAccount(signal => loginAccount(input, signal)), [changeAccount]);
  const logout = useCallback(() => changeAccount(async signal => {
    // A failed save leaves the current account and unsaved learning work open.
    for (const handler of beforeLogout.current) await handler();
    await logoutAccount(signal, userRef.current?.id);
    return null;
  }), [changeAccount]);
  const registerBeforeLogout = useCallback((handler: () => Promise<void>) => {
    beforeLogout.current.add(handler);
    return () => { beforeLogout.current.delete(handler); };
  }, []);

  return <AccountContext.Provider value={{ user, status, error, sessionEpoch, register, login, logout, registerBeforeLogout }}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useAccount must be used within AccountProvider");
  return context;
}
/** Existing isolated learning components retain their browser-only guest mode. */
export function useOptionalAccount(): AccountContextValue {
  return useContext(AccountContext) ?? GUEST_ACCOUNT;
}
