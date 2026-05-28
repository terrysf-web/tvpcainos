importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAzXyQA-BbL_0KsTnukODBfMBkIZINxiNM",
  authDomain: "tvpcainos.firebaseapp.com",
  projectId: "tvpcainos",
  storageBucket: "tvpcainos.firebasestorage.app",
  messagingSenderId: "721441022829",
  appId: "1:721441022829:web:45a0ee8fc152090b09f064",
});

const messaging = firebase.messaging();

// 앱이 백그라운드일 때 FCM 푸시 수신 → 알림 표시
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "TVPC Worship";
  const body  = payload.notification?.body  || "";
  self.registration.showNotification(title, {
    body,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    tag:   "worship-notif",
    data:  payload.data,
  });
});

// 알림 클릭 시 앱 포커스 or 오픈
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url && c.focus);
      if (existing) return existing.focus();
      return clients.openWindow("/");
    })
  );
});
