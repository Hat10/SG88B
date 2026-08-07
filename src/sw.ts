/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// injectManifest gives us the raw SW — unlike generateSW, nothing here skips
// the wait automatically. Without this, a newly-installed SW sits in "waiting"
// until every open tab is closed, which is why a plain refresh (or even a hard
// refresh) kept serving the old cached build.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
