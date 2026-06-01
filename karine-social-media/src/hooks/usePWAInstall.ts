'use client';

import { useCallback, useEffect, useState } from 'react';

export type DeviceOS = 'ios' | 'android' | 'other';
export type DeviceBrowser =
  | 'safari'
  | 'chrome'
  | 'firefox'
  | 'edge'
  | 'samsung'
  | 'instagram'
  | 'facebook'
  | 'messenger'
  | 'tiktok'
  | 'twitter'
  | 'other';

type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
};

export type PWAInstallState = {
  /** Vrai tant que le hook n'a pas tourné côté client (évite hydration mismatch). */
  ready: boolean;
  /** L'app tourne déjà en mode standalone (déjà installée et lancée depuis l'icône). */
  isStandalone: boolean;
  isMobile: boolean;
  os: DeviceOS;
  browser: DeviceBrowser;
  /** Browser intégré d'une app (Insta, FB, etc.) → PWA install impossible. */
  isInAppBrowser: boolean;
  /** L'event Android Chrome `beforeinstallprompt` a été reçu → on peut déclencher
   *  une vraie prompt native via promptInstall(). */
  canPromptNatively: boolean;
  /** Déclenche la prompt native (Android Chrome). Renvoie 'accepted' / 'dismissed' / null si non dispo. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | null>;
};

const STORAGE_DISMISSED_KEY = 'karine.pwa.install.banner.dismissed';

export function usePWAInstall(): PWAInstallState {
  const [ready, setReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [os, setOs] = useState<DeviceOS>('other');
  const [browser, setBrowser] = useState<DeviceBrowser>('other');
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);
    const resolvedOs: DeviceOS = isIos ? 'ios' : isAndroid ? 'android' : 'other';

    // Detection in-app browsers (priority order : Instagram, FB, Messenger, TikTok, Twitter)
    let resolvedBrowser: DeviceBrowser = 'other';
    let inApp = false;
    if (/instagram/.test(ua)) {
      resolvedBrowser = 'instagram';
      inApp = true;
    } else if (/fbav|fban\/|fb_iab|fbios|fb4a/.test(ua)) {
      resolvedBrowser = 'facebook';
      inApp = true;
    } else if (/messenger/.test(ua)) {
      resolvedBrowser = 'messenger';
      inApp = true;
    } else if (/tiktok/.test(ua)) {
      resolvedBrowser = 'tiktok';
      inApp = true;
    } else if (/twitter|twitterandroid/.test(ua)) {
      resolvedBrowser = 'twitter';
      inApp = true;
    } else if (/edg\//.test(ua)) {
      resolvedBrowser = 'edge';
    } else if (/samsungbrowser/.test(ua)) {
      resolvedBrowser = 'samsung';
    } else if (/firefox|fxios/.test(ua)) {
      resolvedBrowser = 'firefox';
    } else if (/chrome|crios/.test(ua)) {
      resolvedBrowser = 'chrome';
    } else if (/safari/.test(ua)) {
      resolvedBrowser = 'safari';
    }

    setOs(resolvedOs);
    setBrowser(resolvedBrowser);
    setIsInAppBrowser(inApp);

    setIsMobile(
      resolvedOs !== 'other' || /mobi|android/.test(ua) || window.innerWidth < 768,
    );

    // Standalone detection
    // - iOS Safari : navigator.standalone === true
    // - Android Chrome / Edge : matchMedia '(display-mode: standalone)'
    const standaloneIOS =
      typeof (navigator as Navigator & { standalone?: boolean }).standalone ===
        'boolean' &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const standaloneMM = window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standaloneIOS || standaloneMM);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener('appinstalled', onInstalled);

    setReady(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | null
  > => {
    if (!deferredPrompt) return null;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return choice.outcome;
    } catch {
      return null;
    }
  }, [deferredPrompt]);

  return {
    ready,
    isStandalone,
    isMobile,
    os,
    browser,
    isInAppBrowser,
    canPromptNatively: deferredPrompt !== null,
    promptInstall,
  };
}

/** Helpers persistants pour le bandeau (afin de ne pas le réafficher si dismissé). */
export function getBannerDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setBannerDismissed(value: boolean): void {
  try {
    if (value) localStorage.setItem(STORAGE_DISMISSED_KEY, '1');
    else localStorage.removeItem(STORAGE_DISMISSED_KEY);
  } catch {
    /* localStorage indispo */
  }
}
