// Web Push subscribe/unsubscribe helpers.
//
// VAPID public key vem do backend Supabase (env BACKEND_VAPID_PUBLIC).
// Após subscribe, o frontend envia o PushSubscription para
// /functions/v1/push-register que persiste em `push_subscriptions`
// (migration adicional necessária — ver TODO no backend/README.md).

import * as backend from '../core/backend.js';

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const b64Clean = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64Clean);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getCurrentSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribe(vapidPublicKey) {
  if (!vapidPublicKey) throw new Error('VAPID public key obrigatória');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Browser não suporta Web Push.');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  if (backend.isConfigured() && backend.isAuthenticated()) {
    await registerWithBackend(sub);
  }
  return sub;
}

export async function unsubscribe() {
  const sub = await getCurrentSubscription();
  if (sub) await sub.unsubscribe();
}

async function registerWithBackend(sub) {
  const cfg = backend.getConfig();
  const session = backend.getSession();
  const payload = sub.toJSON();
  await fetch(`${cfg.url}/functions/v1/push-register`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscription: payload }),
  });
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}
