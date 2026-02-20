"use client";

import React, { useEffect, useState } from "react";

// Self-contained placeholder components to avoid missing-import build errors.
function LoadingScreen() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%'}}>
      <div>Loading…</div>
    </div>
  );
}

function AuthRequiredUI({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div style={{padding:20}}>
      <h2>Sign in required</h2>
      <p>You must be signed in to access the editor.</p>
      <button onClick={onSignIn}>Mock Sign In</button>
    </div>
  );
}

function UpgradeModal() { return null }
function SubscriptionCard() { return null }
function UserNav() { return null }

export default function EditorGate({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [effectiveUser, setEffectiveUser] = useState<any>(null);

  // Bypass auth by setting localStorage 'bypassAuth' to '1' (for dev)
  const bypassAuth = typeof window !== 'undefined' && window.localStorage?.getItem('bypassAuth') === '1';

  useEffect(() => {
    // Simulated async auth initialization
    const t = setTimeout(() => {
      setAuthReady(true);
      // try to hydrate user from localStorage (mock)
      try {
        const raw = window.localStorage.getItem('mockUser')
        if (raw) setEffectiveUser(JSON.parse(raw))
      } catch (e) {
        // ignore
      }
    }, 200);
    return () => clearTimeout(t);
  }, []);

  function doMockSignIn() {
    const u = { id: 'dev-user', name: 'Dev User', subscription: 'free' };
    window.localStorage.setItem('mockUser', JSON.stringify(u));
    setEffectiveUser(u);
  }

  if (!authReady && !bypassAuth) {
    return <LoadingScreen />;
  }

  // If bypassAuth is enabled, synthesize an effective user
  if (!effectiveUser && bypassAuth) {
    const u = { id: 'bypass-user', name: 'Bypass User', subscription: 'pro' };
    setEffectiveUser(u);
  }

  if (!effectiveUser) {
    return <AuthRequiredUI onSignIn={doMockSignIn} />;
  }

  // Optional subscription checks could be added here.

  return <>{children}</>;
}
