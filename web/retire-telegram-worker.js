// Retire only the former RQT Mini App cache. Never open or delete IndexedDB.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("requant-telegram-wallet-"))
          await caches.delete(key);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) {
        const path = new URL(client.url).pathname;
        if (
          path.startsWith("/telegram-wallet/") ||
          path === "/wallet/telegram.html"
        ) {
          await client.navigate("/telegram-wallet/");
        }
      }
    })(),
  );
});
