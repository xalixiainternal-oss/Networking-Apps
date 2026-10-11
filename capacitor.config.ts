import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.pantau.kuota',
  appName: 'Pantau Kuota',
  webDir: 'dist',
  // Tanpa server.url: semua aset dimuat lokal dari APK (app tidak punya izin INTERNET).
  android: { allowMixedContent: false }
};
export default config;
